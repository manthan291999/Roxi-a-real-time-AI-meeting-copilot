//! Streaming PCM sink: buffers resampled PCM16 samples and writes fixed-size
//! chunks to stdout for consumption by a Node.js (or any) process.

use crate::adapters::control_channel::SharedWriter;
use crate::ports::audio_capture::PcmSink;
use anyhow::{Context, Result};
use log::{debug, info, warn};
use std::io::Write;
use std::sync::atomic::{AtomicU64, Ordering};

const MAGIC: [u8; 4] = [0x50, 0x43, 0x4D, 0x31];

/// Audio is sent in 100ms chunks (1600 samples at 16kHz mono).
///
/// This was 250ms, which sat at the front of every transcript as a flat quarter
/// second of latency — audio could not begin being recognised until the chunk
/// holding it was full. The STT provider rejects messages outside 50-1000ms
/// (`Input Duration Error`), so 50ms is the floor; 100ms takes most of the
/// available win while leaving room for the trailing-chunk padding in
/// `finalize` and for any rounding in the resampler's output granularity.
const CHUNK_MS: u32 = 100;
const SAMPLES_PER_CHUNK: usize = 1600;
/// Shortest chunk the STT provider will accept, in samples (50ms at 16kHz).
const MIN_SAMPLES_PER_CHUNK: usize = 800;
const HEADER_SIZE: usize = 8;

pub struct StreamingSink {
    buffer: Vec<i16>,
    /// Shared with the control channel, which writes `CTL1` frames onto the same
    /// pipe. Control frames are rare and tiny, so contention here is negligible.
    writer: SharedWriter,
    chunks_sent: AtomicU64,
    total_samples: u64,
}

impl StreamingSink {
    pub fn new(writer: SharedWriter) -> Self {
        Self {
            buffer: Vec::with_capacity(SAMPLES_PER_CHUNK),
            writer,
            chunks_sent: AtomicU64::new(0),
            total_samples: 0,
        }
    }

    fn emit_chunk(&mut self, samples: &[i16]) -> Result<()> {
        let payload_size = (samples.len() * 2) as u32;

        let mut header = [0u8; HEADER_SIZE];
        header[..4].copy_from_slice(&MAGIC);
        header[4..8].copy_from_slice(&payload_size.to_le_bytes());

        let mut payload = Vec::with_capacity(samples.len() * 2);
        for &sample in samples {
            payload.extend_from_slice(&sample.to_le_bytes());
        }

        {
            // Scoped so the lock is released before the logging below.
            let mut guard = self
                .writer
                .lock()
                .map_err(|_| anyhow::anyhow!("Audio writer mutex poisoned"))?;
            guard.write_all(&header).context("Failed to write chunk header")?;
            guard.write_all(&payload).context("Failed to write chunk payload")?;
            guard.flush().context("Failed to flush writer")?;
        }

        let count = self.chunks_sent.fetch_add(1, Ordering::Relaxed) + 1;
        // Every 100 chunks — still one line per 10s of audio, now that a chunk
        // is 100ms rather than 250ms.
        if count % 100 == 0 {
            debug!("Streaming: {} chunks sent ({:.1}s of audio)", count, count as f64 * CHUNK_MS as f64 / 1000.0);
        }
        Ok(())
    }
}

impl PcmSink for StreamingSink {
    fn write_samples(&mut self, samples: &[i16]) -> Result<()> {
        self.buffer.extend_from_slice(samples);
        self.total_samples += samples.len() as u64;

        while self.buffer.len() >= SAMPLES_PER_CHUNK {
            let chunk: Vec<i16> = self.buffer.drain(..SAMPLES_PER_CHUNK).collect();
            self.emit_chunk(&chunk)?;
        }
        Ok(())
    }

    fn finalize(&mut self) -> Result<()> {
        if !self.buffer.is_empty() {
            let mut remaining: Vec<i16> = self.buffer.drain(..).collect();
            warn!("Streaming: flushing final short chunk ({} samples)", remaining.len());
            // Pad to the provider's 50ms floor rather than sending a chunk it
            // would reject outright with `Input Duration Error`. Silence is the
            // right filler: this is the tail of the meeting, and the padding is
            // at most 50ms of quiet appended to audio that has already stopped.
            if remaining.len() < MIN_SAMPLES_PER_CHUNK {
                remaining.resize(MIN_SAMPLES_PER_CHUNK, 0);
            }
            self.emit_chunk(&remaining)?;
        }

        let total_chunks = self.chunks_sent.load(Ordering::Relaxed);
        info!("Streaming: session complete. {} chunks sent, {} total samples ({:.2}s)", total_chunks, self.total_samples, self.total_samples as f64 / 16000.0);
        Ok(())
    }
}
