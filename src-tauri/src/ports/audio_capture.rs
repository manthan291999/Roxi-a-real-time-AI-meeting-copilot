use anyhow::Result;

pub trait PcmSink: Send + 'static {
    fn write_samples(&mut self, samples: &[i16]) -> Result<()>;
    fn finalize(&mut self) -> Result<()>;
}

pub trait AudioCapture: Send + Sync {
    fn start_capture(&self, sink: Box<dyn PcmSink>) -> Result<()>;
    fn stop_capture(&self) -> Result<()>;
}
