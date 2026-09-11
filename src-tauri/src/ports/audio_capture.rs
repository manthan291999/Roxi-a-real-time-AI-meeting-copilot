use anyhow::Result;

pub trait PcmSink: Send + 'static {
    fn write_samples(&mut self, samples: &[i16]) -> Result<()>;
    fn finalize(&mut self) -> Result<()>;
}

pub trait AudioCapture: Send + Sync {
    /// `on_failure` reports an async death of the capture pipeline (device
    /// error, broken sink pipe) after `start_capture` has already returned
    /// `Ok(())` — the only way such a failure can reach the caller, since
    /// capture runs on its own thread.
    fn start_capture(
        &self,
        sink: Box<dyn PcmSink>,
        on_failure: Box<dyn Fn(String) + Send + Sync + 'static>,
    ) -> Result<()>;
    fn stop_capture(&self) -> Result<()>;
}
