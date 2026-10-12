//! Resampling module: converts audio from the source sample rate to 16 kHz
//! using the `rubato` crate's high-quality sinc interpolation.
//!
//! Rubato operates on `Vec<Vec<f64>>` (channels × samples), so we handle the
//! f32 ↔ f64 conversion and channel packing/unpacking here.

use anyhow::{Context, Result};
use rubato::{FftFixedIn, Resampler as RubatoResampler};

/// Wraps rubato's FFT-based resampler with buffering for partial input chunks.
pub struct Resampler {
    resampler: FftFixedIn<f64>,
    /// Internal buffer to accumulate samples until we have enough for a full
    /// resampler input block.
    buffer: Vec<f64>,
    /// Number of input frames the resampler expects per call.
    chunk_size: usize,
}

impl Resampler {
    /// Create a new resampler.
    ///
    /// - `source_rate`: e.g. 48000
    /// - `target_rate`: e.g. 16000
    /// - `channels`: number of source channels (we process mono after downmix,
    ///   so this is typically 1)
    pub fn new(source_rate: u32, target_rate: u32, _channels: usize) -> Result<Self> {
        // We work with mono (post-downmix), so always 1 channel for rubato.
        let num_channels = 1;

        // FftFixedIn: fixed input size, variable output size.
        // chunk_size = 1024 frames is a good balance between latency and efficiency.
        let chunk_size = 1024;

        let resampler = FftFixedIn::new(
            source_rate as usize,
            target_rate as usize,
            chunk_size,
            2, // sub_chunks — controls the quality/latency tradeoff
            num_channels,
        )
        .context("Failed to create rubato resampler")?;

        Ok(Self {
            resampler,
            buffer: Vec::with_capacity(chunk_size * 2),
            chunk_size,
        })
    }

    /// Process a chunk of mono f32 samples. Returns resampled f32 samples.
    ///
    /// Because rubato requires fixed-size input blocks, this method buffers
    /// incoming data and only produces output when enough samples have
    /// accumulated. This means output may be empty for small inputs.
    pub fn process(&mut self, input: &[f32]) -> Result<Vec<f32>> {
        // Append to internal buffer (convert f32 → f64).
        self.buffer.extend(input.iter().map(|&s| s as f64));

        let mut output = Vec::new();

        // Process as many full chunks as we have buffered.
        while self.buffer.len() >= self.chunk_size {
            // Take exactly chunk_size samples.
            let chunk: Vec<f64> = self.buffer.drain(..self.chunk_size).collect();

            // Rubato expects Vec<Vec<f64>> — one inner vec per channel.
            let input_frames = vec![chunk];

            let resampled = self
                .resampler
                .process(&input_frames, None)
                .context("Rubato resample failed")?;

            // Convert output f64 → f32 and append.
            if let Some(channel_data) = resampled.first() {
                output.extend(channel_data.iter().map(|&s| s as f32));
            }
        }

        Ok(output)
    }

    /// Flush any remaining buffered samples. Call this at the end of a capture
    /// session to avoid losing the tail.
    /// Drain the resampler's internal buffer. Unused today: the capture loop
    /// stops on a flag rather than draining. Kept for the mixer drain-on-stop
    /// work (deferred item A-2).
    #[allow(dead_code)]
    pub fn flush(&mut self) -> Result<Vec<f32>> {
        if self.buffer.is_empty() {
            return Ok(Vec::new());
        }

        // Pad the buffer to chunk_size with silence.
        let remaining = self.buffer.len();
        self.buffer.resize(self.chunk_size, 0.0);

        let input_frames = vec![self.buffer.drain(..).collect::<Vec<f64>>()];
        let resampled = self
            .resampler
            .process(&input_frames, None)
            .context("Rubato resample flush failed")?;

        let mut output = Vec::new();
        if let Some(channel_data) = resampled.first() {
            // Only take the proportional amount of output (not the padded silence).
            let ratio = self.resampler.output_frames_max() as f64 / self.chunk_size as f64;
            let valid_samples = (remaining as f64 * ratio).ceil() as usize;
            output.extend(channel_data.iter().take(valid_samples).map(|&s| s as f32));
        }

        Ok(output)
    }
}
