//! WAV file sink: writes PCM16 samples to a WAV file.
//! Preserves Phase 1 functionality via the PcmSink trait.

use crate::ports::audio_capture::PcmSink;
use anyhow::{Context, Result};
use hound::{SampleFormat, WavSpec, WavWriter};
use log::info;
use std::io::BufWriter;
use std::path::{Path, PathBuf};

pub struct WavSink {
    writer: Option<WavWriter<BufWriter<std::fs::File>>>,
    path: PathBuf,
    samples_written: u64,
}

impl WavSink {
    pub fn new(path: &Path, sample_rate: u32, channels: u16) -> Result<Self> {
        let spec = WavSpec {
            channels,
            sample_rate,
            bits_per_sample: 16,
            sample_format: SampleFormat::Int,
        };
        let writer = WavWriter::create(path, spec)
            .with_context(|| format!("Failed to create WAV file: {}", path.display()))?;

        Ok(Self {
            writer: Some(writer),
            path: path.to_path_buf(),
            samples_written: 0,
        })
    }
}

impl PcmSink for WavSink {
    fn write_samples(&mut self, samples: &[i16]) -> Result<()> {
        if let Some(ref mut w) = self.writer {
            for &sample in samples {
                w.write_sample(sample)
                    .context("Failed to write sample to WAV")?;
            }
            self.samples_written += samples.len() as u64;
        }
        Ok(())
    }

    fn finalize(&mut self) -> Result<()> {
        if let Some(writer) = self.writer.take() {
            writer.finalize().context("Failed to finalize WAV file")?;
            info!(
                "WAV: wrote {} samples to {}",
                self.samples_written,
                self.path.display()
            );
        }
        Ok(())
    }
}
