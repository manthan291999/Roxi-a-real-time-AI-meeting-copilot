//! One meter reading taken over a short window of captured audio.

/// A normalised loudness snapshot of the capture mix.
///
/// Every field is `0.0..=1.0`, normalised against a rolling peak rather than
/// being an absolute dBFS figure: the consumer is a visualisation, and raw RMS
/// off a laptop microphone sits around 0.02–0.08, which would leave any
/// amplitude-driven UI visually dead. The rolling peak is what makes a quiet
/// speaker fill the same range as a loud one.
///
/// `low`/`mid`/`high` are band energies split at 300 Hz and 2 kHz — enough to
/// distinguish the body of a voice from sibilance without paying for an FFT.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct AudioLevel {
    pub rms: f32,
    pub low: f32,
    pub mid: f32,
    pub high: f32,
}

impl AudioLevel {
    /// The reading that means "nothing is being captured". Emitted once when a
    /// session finalises so the UI settles instead of freezing on the last
    /// syllable.
    pub const SILENT: Self = Self {
        rms: 0.0,
        low: 0.0,
        mid: 0.0,
        high: 0.0,
    };
}
