//! Streaming PCM sink: buffers resampled PCM16 samples and writes fixed-size
//! chunks to stdout for consumption by a Node.js (or any) process.

use crate::ports::audio_capture::PcmSink;
use anyhow::{Context, Result};
use log::{debug, info, warn};
use std::io::Write;
use std::sync::atomic::{AtomicU64, Ordering};

const MAGIC: [u8; 4] = [0x50, 0x43, 0x4D, 0x31];
const CHUNK_MS: u32 = 250;
const SAMPLES_PER_CHUNK: usize = 4000;
const HEADER_SIZE: usize = 8;

pub struct StreamingSink {
    buffer: Vec<i16>,
    writer: Box<dyn Write + Send>,
    chunks_sent: AtomicU64,
    total_samples: u64,
}

impl StreamingSink {
    pub fn new(writer: Box<dyn Write + Send>) -> Self {
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

        self.writer.write_all(&header).context("Failed to write chunk header")?;
        self.writer.write_all(&payload).context("Failed to write chunk payload")?;
        self.writer.flush().context("Failed to flush writer")?;

        let count = self.chunks_sent.fetch_add(1, Ordering::Relaxed) + 1;
        if count % 40 == 0 {
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
            let remaining: Vec<i16> = self.buffer.drain(..).collect();
            warn!("Streaming: flushing final short chunk ({} samples)", remaining.len());
            self.emit_chunk(&remaining)?;
        }

        let total_chunks = self.chunks_sent.load(Ordering::Relaxed);
        info!("Streaming: session complete. {} chunks sent, {} total samples ({:.2}s)", total_chunks, self.total_samples, self.total_samples as f64 / 16000.0);
        Ok(())
    }
}
