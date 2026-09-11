//! `MeterSink` — a [`PcmSink`] decorator that measures the audio passing
//! through it without altering, delaying, or consuming it.
//!
//! It exists so the capture pipeline can drive an amplitude-reactive UI. The
//! alternative — opening a second microphone stream in the webview — would ask
//! for a redundant OS permission, miss the BlackHole loopback entirely, and
//! double the audio the machine has to process.
//!
//! Two properties are load-bearing:
//!
//!   * **Transparent.** `write_samples` forwards to the wrapped sink *first*,
//!     then measures. Metering, and whatever the observer does with a reading,
//!     can therefore never delay the bytes heading for the STT provider.
//!   * **Cheap.** Two one-pole filters and four multiply-adds per sample, no
//!     FFT, no allocation. This runs on the mixer thread for every sample of
//!     every meeting.

use crate::domain::audio_level::AudioLevel;
use crate::ports::audio_capture::PcmSink;
use crate::ports::audio_meter::LevelObserver;
use anyhow::Result;
use std::sync::Arc;

/// 512 samples at the pipeline's fixed 16 kHz is 32 ms, so readings land at
/// ~31 Hz — under one per animation frame, which is the point: the renderer
/// interpolates between readings rather than the meter racing the display.
const WINDOW: usize = 512;

/// One-pole coefficients, `a = 1 - exp(-2*pi*fc/fs)` at fs = 16 kHz.
/// 300 Hz splits the body of a voice from its fundamental; 2 kHz splits
/// sibilance from the body.
const A_LOW: f32 = 0.1111;
const A_HIGH: f32 = 0.5441;

/// How fast the rolling peak forgets a loud moment. 0.995 per 32 ms window is
/// a ~6 s time constant: long enough that a shout does not flatten the next
/// sentence, short enough that the scale re-adapts within one speaking turn.
const DECAY: f32 = 0.995;

/// The quietest peak the normaliser will scale against. Without a floor, a
/// silent room divides by its own noise and renders hiss as a full-scale
/// signal.
const MIN_PEAK: f32 = 0.05;

/// Below this RMS a window is treated as silence rather than a very quiet
/// signal. Room tone on a laptop mic sits under it.
const GATE: f32 = 0.004;

/// Scales an absolute RMS into `0.0..=1.0` against a peak that decays.
struct Rolling {
    peak: f32,
}

impl Rolling {
    fn new() -> Self {
        Self { peak: MIN_PEAK }
    }

    fn normalise(&mut self, rms: f32) -> f32 {
        self.peak = rms.max(self.peak * DECAY).max(MIN_PEAK);
        let span = self.peak - GATE;
        if span <= f32::EPSILON {
            return 0.0;
        }
        ((rms - GATE) / span).clamp(0.0, 1.0)
    }
}

pub struct MeterSink {
    inner: Box<dyn PcmSink>,
    observer: Arc<dyn LevelObserver>,

    /// Samples accumulated into the window in progress.
    n: usize,
    sum_sq: f64,
    sum_low: f64,
    sum_mid: f64,
    sum_high: f64,

    /// One-pole filter state, carried across windows so the bands do not
    /// restart every 32 ms.
    lp_low: f32,
    lp_high: f32,

    peak_rms: Rolling,
    peak_low: Rolling,
    peak_mid: Rolling,
    peak_high: Rolling,
}

impl MeterSink {
    pub fn new(inner: Box<dyn PcmSink>, observer: Arc<dyn LevelObserver>) -> Self {
        Self {
            inner,
            observer,
            n: 0,
            sum_sq: 0.0,
            sum_low: 0.0,
            sum_mid: 0.0,
            sum_high: 0.0,
            lp_low: 0.0,
            lp_high: 0.0,
            peak_rms: Rolling::new(),
            peak_low: Rolling::new(),
            peak_mid: Rolling::new(),
            peak_high: Rolling::new(),
        }
    }

    fn measure(&mut self, samples: &[i16]) {
        for &sample in samples {
            let x = sample as f32 / 32_768.0;

            // Two cascaded one-poles give three bands for the price of two
            // filters: everything under 300 Hz, everything over 2 kHz, and
            // whatever is left between them.
            self.lp_low += A_LOW * (x - self.lp_low);
            self.lp_high += A_HIGH * (x - self.lp_high);
            let low = self.lp_low;
            let mid = self.lp_high - self.lp_low;
            let high = x - self.lp_high;

            self.sum_sq += (x * x) as f64;
            self.sum_low += (low * low) as f64;
            self.sum_mid += (mid * mid) as f64;
            self.sum_high += (high * high) as f64;
            self.n += 1;

            if self.n >= WINDOW {
                self.flush_window();
            }
        }
    }

    fn flush_window(&mut self) {
        let n = self.n as f64;
        if n == 0.0 {
            return;
        }
        let rms = (self.sum_sq / n).sqrt() as f32;
        let low = (self.sum_low / n).sqrt() as f32;
        let mid = (self.sum_mid / n).sqrt() as f32;
        let high = (self.sum_high / n).sqrt() as f32;

        let level = AudioLevel {
            rms: self.peak_rms.normalise(rms),
            low: self.peak_low.normalise(low),
            mid: self.peak_mid.normalise(mid),
            high: self.peak_high.normalise(high),
        };

        self.n = 0;
        self.sum_sq = 0.0;
        self.sum_low = 0.0;
        self.sum_mid = 0.0;
        self.sum_high = 0.0;

        self.observer.observe(level);
    }
}

impl PcmSink for MeterSink {
    fn write_samples(&mut self, samples: &[i16]) -> Result<()> {
        // Forward first, unchanged. The wrapped sink is the one with a
        // deadline; this one only watches.
        self.inner.write_samples(samples)?;
        self.measure(samples);
        Ok(())
    }

    fn finalize(&mut self) -> Result<()> {
        let result = self.inner.finalize();
        // Whatever happened downstream, tell the UI the signal is gone so it
        // settles rather than holding the last syllable on screen.
        self.observer.observe(AudioLevel::SILENT);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    struct SpySink {
        received: Arc<Mutex<Vec<i16>>>,
        finalized: Arc<Mutex<bool>>,
    }

    impl PcmSink for SpySink {
        fn write_samples(&mut self, samples: &[i16]) -> Result<()> {
            self.received.lock().unwrap().extend_from_slice(samples);
            Ok(())
        }
        fn finalize(&mut self) -> Result<()> {
            *self.finalized.lock().unwrap() = true;
            Ok(())
        }
    }

    fn collector() -> (Arc<dyn LevelObserver>, Arc<Mutex<Vec<AudioLevel>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = seen.clone();
        let observer: Arc<dyn LevelObserver> =
            Arc::new(move |level: AudioLevel| sink.lock().unwrap().push(level));
        (observer, seen)
    }

    fn tone(freq: f32, amplitude: f32, samples: usize) -> Vec<i16> {
        (0..samples)
            .map(|i| {
                let t = i as f32 / 16_000.0;
                ((amplitude * (std::f32::consts::TAU * freq * t).sin()) * 32_767.0) as i16
            })
            .collect()
    }

    #[test]
    fn forwards_every_sample_unchanged() {
        let received = Arc::new(Mutex::new(Vec::new()));
        let spy = SpySink {
            received: received.clone(),
            finalized: Arc::new(Mutex::new(false)),
        };
        let (observer, _) = collector();
        let mut meter = MeterSink::new(Box::new(spy), observer);

        let input = tone(440.0, 0.5, 1500);
        meter.write_samples(&input).unwrap();

        assert_eq!(*received.lock().unwrap(), input, "the sink must be transparent");
    }

    #[test]
    fn emits_one_reading_per_window() {
        let (observer, seen) = collector();
        let mut meter = MeterSink::new(Box::new(SpySink::default()), observer);

        // Three full windows plus a partial one, delivered in awkward slices to
        // prove the window boundary does not depend on the caller's chunking.
        let input = tone(440.0, 0.5, WINDOW * 3 + 100);
        for chunk in input.chunks(37) {
            meter.write_samples(chunk).unwrap();
        }

        assert_eq!(seen.lock().unwrap().len(), 3);
    }

    #[test]
    fn silence_reads_as_zero() {
        let (observer, seen) = collector();
        let mut meter = MeterSink::new(Box::new(SpySink::default()), observer);

        meter.write_samples(&vec![0i16; WINDOW * 2]).unwrap();

        for level in seen.lock().unwrap().iter() {
            assert_eq!(level.rms, 0.0, "digital silence must not register");
        }
    }

    #[test]
    fn speech_level_audio_reaches_full_scale() {
        let (observer, seen) = collector();
        let mut meter = MeterSink::new(Box::new(SpySink::default()), observer);

        meter.write_samples(&tone(220.0, 0.5, WINDOW * 2)).unwrap();

        let first = seen.lock().unwrap()[0];
        assert!(
            first.rms > 0.9,
            "a normalised loud tone should fill the range, got {}",
            first.rms
        );
    }

    #[test]
    fn quiet_audio_still_fills_the_range_once_the_peak_adapts() {
        let (observer, seen) = collector();
        let mut meter = MeterSink::new(Box::new(SpySink::default()), observer);

        // 0.03 amplitude is a quiet laptop mic — the case that renders dead
        // without normalisation.
        meter.write_samples(&tone(220.0, 0.03, WINDOW * 2)).unwrap();

        let level = seen.lock().unwrap()[1];
        assert!(
            level.rms > 0.2,
            "quiet speech must still move the meter, got {}",
            level.rms
        );
    }

    #[test]
    fn bands_separate_by_frequency() {
        let (low_obs, low_seen) = collector();
        let mut low_meter = MeterSink::new(Box::new(SpySink::default()), low_obs);
        low_meter.write_samples(&tone(120.0, 0.5, WINDOW * 2)).unwrap();
        let bass = low_seen.lock().unwrap()[1];

        let (high_obs, high_seen) = collector();
        let mut high_meter = MeterSink::new(Box::new(SpySink::default()), high_obs);
        high_meter.write_samples(&tone(6000.0, 0.5, WINDOW * 2)).unwrap();
        let treble = high_seen.lock().unwrap()[1];

        assert!(bass.low > bass.high, "120 Hz belongs in the low band");
        assert!(treble.high > treble.low, "6 kHz belongs in the high band");
    }

    #[test]
    fn finalize_forwards_and_reports_silence() {
        let finalized = Arc::new(Mutex::new(false));
        let spy = SpySink {
            received: Arc::new(Mutex::new(Vec::new())),
            finalized: finalized.clone(),
        };
        let (observer, seen) = collector();
        let mut meter = MeterSink::new(Box::new(spy), observer);

        meter.finalize().unwrap();

        assert!(*finalized.lock().unwrap(), "the wrapped sink must still be finalized");
        assert_eq!(seen.lock().unwrap().last(), Some(&AudioLevel::SILENT));
    }
}
