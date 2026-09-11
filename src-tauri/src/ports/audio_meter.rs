//! Where meter readings go once the capture pipeline has produced them.

use crate::domain::audio_level::AudioLevel;

/// The sink for [`AudioLevel`] readings.
///
/// Deliberately not a Tauri `AppHandle`: the meter lives on the audio path and
/// has no business knowing what a window is. The composition root decides that
/// a reading becomes a `audio_level` event, a log line, or nothing at all.
pub trait LevelObserver: Send + Sync + 'static {
    fn observe(&self, level: AudioLevel);
}

/// Any closure of the right shape is an observer, so call sites can pass one
/// inline instead of declaring a type whose only job is to forward a value.
impl<F> LevelObserver for F
where
    F: Fn(AudioLevel) + Send + Sync + 'static,
{
    fn observe(&self, level: AudioLevel) {
        self(level)
    }
}
