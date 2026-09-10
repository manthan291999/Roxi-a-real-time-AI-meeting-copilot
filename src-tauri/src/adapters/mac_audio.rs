//! Audio capture: BlackHole loopback plus the system microphone, mixed to
//! 16 kHz mono PCM16.
//!
//! macOS is the only target. CoreAudio cannot capture an ordinary output
//! device, so system audio — the other participants in a meeting — is read
//! from BlackHole, a virtual loopback driver the user installs and selects as
//! their output (typically via a Multi-Output Device so they can still hear
//! it). `find_loopback_device` prefers BlackHole for exactly this reason; the
//! header here previously described a Windows WASAPI strategy the platform does
//! not support, which is how that defect stayed hidden.
//!
//! Two `cpal` input streams run concurrently — the BlackHole loopback and the
//! microphone — and a mixer thread sums them into the caller's `PcmSink`. The
//! pipeline is sink-agnostic: callers supply the `PcmSink` (today
//! `StreamingSink`, which frames PCM1 onto the gateway's stdin).

use crate::resample::Resampler;
use anyhow::{anyhow, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, Host, SampleFormat};
use log::{debug, error, info, trace, warn};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use crate::ports::audio_capture::{AudioCapture, PcmSink};

pub struct MacAudioCapture {
    running: Arc<AtomicBool>,
}

impl MacAudioCapture {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl AudioCapture for MacAudioCapture {
    fn start_capture(&self, sink: Box<dyn PcmSink>) -> Result<()> {
        // Pre-flight on the calling thread. Everything below runs on a spawned
        // thread whose only error path is a log line, and this function returns
        // before it runs — so a device failure used to surface as a successful
        // start_capture followed by "Waiting for speech..." forever.
        {
            let host = cpal::default_host();
            let device = find_loopback_device(&host, &None)
                .context("No usable audio capture device found")?;
            device
                .default_output_config()
                .context("Audio device found but its format could not be read")?;
        }

        self.running.store(true, Ordering::SeqCst);
        let running_flag = self.running.clone();
        
        std::thread::spawn(move || {
            let config = CaptureConfig {
                duration_secs: 0,
                device_name: None,
                target_sample_rate: 16_000,
                target_channels: 1,
            };
            
            if let Err(e) = capture_to_sink_internal(config, sink, running_flag) {
                error!("Capture error: {}", e);
            }
        });
        
        Ok(())
    }

    fn stop_capture(&self) -> Result<()> {
        self.running.store(false, Ordering::SeqCst);
        Ok(())
    }
}

/// Configuration for a capture session.
pub struct CaptureConfig {
    pub duration_secs: u64,
    pub device_name: Option<String>,
    pub target_sample_rate: u32,
    pub target_channels: u16,
}

/// Find the target output device for loopback capture.
fn find_device(host: &Host, name_filter: &Option<String>) -> Result<Device> {
    match name_filter {
        Some(filter) => {
            let filter_lower = filter.to_lowercase();
            host.output_devices()
                .context("Failed to enumerate output devices")?
                .find(|d| {
                    d.name()
                        .map(|n| n.to_lowercase().contains(&filter_lower))
                        .unwrap_or(false)
                })
                .ok_or_else(|| anyhow!("No output device matching '{}'", filter))
        }
        None => host
            .default_output_device()
            .ok_or_else(|| anyhow!("No default output device found")),
    }
}

/// Resolve the device the loopback stream is opened on.
///
/// Prefers BlackHole: on macOS, CoreAudio cannot capture an ordinary output
/// device, so BlackHole (a virtual loopback driver) is what actually carries
/// system audio — the other participants in a meeting. Previously this always
/// took the default output device, which is whatever the user has selected
/// (speakers, AirPods), so system audio was never captured and Roxi heard only
/// the microphone.
///
/// Falls back to the default output device when BlackHole is not installed, so
/// such a machine behaves exactly as it did before: loopback fails to build and
/// capture continues with the microphone alone.
fn find_loopback_device(host: &Host, name_filter: &Option<String>) -> Result<Device> {
    if name_filter.is_some() {
        return find_device(host, name_filter);
    }
    find_device(host, &Some("BlackHole".to_string())).or_else(|_| find_device(host, &None))
}

/// Generic capture function: opens the loopback device, resamples to 16kHz mono,
/// and feeds PCM16 samples into the provided sink.
fn capture_to_sink_internal(config: CaptureConfig, sink: Box<dyn PcmSink>, running: Arc<AtomicBool>) -> Result<()> {
    let host = cpal::default_host();
    let device = find_loopback_device(&host, &config.device_name)?;
    let device_name = device.name().unwrap_or_else(|_| "<unknown>".into());
    info!("Capturing from device: {}", device_name);

    // Get the device's default output config — this is the format of the loopback data.
    let supported_config = device
        .default_output_config()
        .context("Failed to get default output config")?;

    let source_sample_rate = supported_config.sample_rate().0;
    let source_channels = supported_config.channels();
    let sample_format = supported_config.sample_format();

    info!(
        "Source format: {}Hz, {}ch, {:?}",
        source_sample_rate, source_channels, sample_format
    );
    info!(
        "Target format: {}Hz, {}ch, PCM16",
        config.target_sample_rate, config.target_channels
    );

    // Set up the resampler if needed.
    let needs_resample = source_sample_rate != config.target_sample_rate;

    let resampler = if needs_resample {
        info!(
            "Resampling: {}Hz → {}Hz (ratio: {:.4})",
            source_sample_rate,
            config.target_sample_rate,
            config.target_sample_rate as f64 / source_sample_rate as f64
        );
        Some(Arc::new(Mutex::new(Resampler::new(
            source_sample_rate,
            config.target_sample_rate,
            source_channels as usize,
        )?)))
    } else {
        None
    };

    // Setup channels for the mixer
    let (loopback_tx, loopback_rx) = mpsc::channel::<Vec<i16>>();
    let (mic_tx, mic_rx) = mpsc::channel::<Vec<i16>>();

    // Wrap the sink in Arc<Mutex> so the mixer thread can access it.
    let sink = Arc::new(Mutex::new(sink));

    // Ctrl+C handler is externalized or omitted because `running` is controlled externally.

    // Track sample count for stats.
    let total_samples = Arc::new(AtomicU64::new(0));

    // Build the input stream.
    let stream_config: cpal::StreamConfig = supported_config.clone().into();
    let target_channels = config.target_channels as usize;
    let source_channels_usize = source_channels as usize;

    let err_callback = |err: cpal::StreamError| {
        error!("Audio stream error: {}", err);
    };

    let stream_result = match sample_format {
        SampleFormat::F32 => {
            let tx = loopback_tx.clone();
            let resampler = resampler.clone();
            let total = total_samples.clone();
            let running = running.clone();
            device.build_input_stream(
                &stream_config,
                move |data: &[f32], _info: &cpal::InputCallbackInfo| {
                    process_and_send(
                        data,
                        &tx,
                        &resampler,
                        &total,
                        source_channels_usize,
                        target_channels,
                        &running,
                    );
                },
                err_callback,
                None,
            )
        }
        SampleFormat::I16 => {
            let tx = loopback_tx.clone();
            let resampler = resampler.clone();
            let total = total_samples.clone();
            let running = running.clone();
            device.build_input_stream(
                &stream_config,
                move |data: &[i16], _info: &cpal::InputCallbackInfo| {
                    let float_data: Vec<f32> =
                        data.iter().map(|&s| s as f32 / i16::MAX as f32).collect();
                    process_and_send(
                        &float_data,
                        &tx,
                        &resampler,
                        &total,
                        source_channels_usize,
                        target_channels,
                        &running,
                    );
                },
                err_callback,
                None,
            )
        }
        SampleFormat::U16 => {
            let tx = loopback_tx.clone();
            let resampler = resampler.clone();
            let total = total_samples.clone();
            let running = running.clone();
            device.build_input_stream(
                &stream_config,
                move |data: &[u16], _info: &cpal::InputCallbackInfo| {
                    let float_data: Vec<f32> = data
                        .iter()
                        .map(|&s| (s as f32 / u16::MAX as f32) * 2.0 - 1.0)
                        .collect();
                    process_and_send(
                        &float_data,
                        &tx,
                        &resampler,
                        &total,
                        source_channels_usize,
                        target_channels,
                        &running,
                    );
                },
                err_callback,
                None,
            )
        }
        format => {
            warn!("Unsupported sample format: {:?}", format);
            Err(cpal::BuildStreamError::StreamConfigNotSupported)
        }
    };

    let loopback_stream = match stream_result {
        Ok(s) => Some(s),
        Err(e) => {
            warn!("Failed to build input (loopback) stream: {}. macOS prevents native output capture. Continuing with mic only.", e);
            None
        }
    };

    // --- PHASE 7: Mic Capture ---
    let mic_stream = setup_mic_stream(
        &host,
        config.target_sample_rate,
        config.target_channels,
        mic_tx,
        running.clone(),
    );
    if mic_stream.is_none() {
        warn!("Failed to setup microphone capture. Continuing with loopback only.");
    }

    // --- Start Mixer Thread ---
    let mixer_running = running.clone();
    let mixer_sink = sink.clone();
    let mixer_handle = std::thread::spawn(move || {
        let mut loopback_buf = VecDeque::new();
        let mut mic_buf = VecDeque::new();
        
        while mixer_running.load(Ordering::SeqCst) {
            // PERF FIX #3: Block on the primary channel with a timeout instead of
            // spinning with sleep(20ms). This removes the 20ms artificial latency
            // floor and eliminates wasteful CPU polling during silence.
            // The 50ms timeout ensures we still check mixer_running regularly and
            // drain the mic channel even when loopback is quiet.
            match loopback_rx.recv_timeout(Duration::from_millis(50)) {
                Ok(chunk) => loopback_buf.extend(chunk),
                Err(_) => {} // timeout or disconnected — just continue
            }
            // Non-blocking drain of any additional loopback chunks that arrived
            while let Ok(chunk) = loopback_rx.try_recv() {
                loopback_buf.extend(chunk);
            }
            // Non-blocking drain of mic channel
            while let Ok(chunk) = mic_rx.try_recv() {
                mic_buf.extend(chunk);
            }
            
            // Mix available samples
            let n = loopback_buf.len().max(mic_buf.len());
            if n > 0 {
                let mut mixed = Vec::with_capacity(n);
                for _ in 0..n {
                    let l = loopback_buf.pop_front().unwrap_or(0);
                    let m = mic_buf.pop_front().unwrap_or(0);
                    
                    // Sum to mono: combine mic + loopback into single channel
                    let sum = (l as i32) + (m as i32);
                    let clamped = sum.clamp(i16::MIN as i32, i16::MAX as i32) as i16;
                    mixed.push(clamped);
                }
                
                if let Ok(mut s) = mixer_sink.lock() {
                    if let Err(e) = s.write_samples(&mixed) {
                        warn!("Sink write error: {}", e);
                        mixer_running.store(false, Ordering::SeqCst);
                    }
                }
            }
        }
    });

    // Start capturing.
    if let Some(ref s) = loopback_stream {
        if let Err(e) = s.play() {
            warn!("Failed to start loopback stream: {}", e);
        }
    }
    if let Some(ref m) = mic_stream {
        let _ = m.play();
    }
    info!("🎙️ Capture started. Press Ctrl+C to stop.");

    let start = Instant::now();
    let duration = if config.duration_secs > 0 {
        Some(Duration::from_secs(config.duration_secs))
    } else {
        None
    };

    // Wait loop: check for timeout or Ctrl+C.
    while running.load(Ordering::SeqCst) {
        std::thread::sleep(Duration::from_millis(100));

        if let Some(dur) = duration {
            if start.elapsed() >= dur {
                info!("Duration reached ({}s), stopping.", config.duration_secs);
                break;
            }
        }

        // Periodic progress log (every 10s to reduce stderr noise in stream mode).
        let elapsed = start.elapsed().as_secs();
        if elapsed > 0 && elapsed % 10 == 0 {
            let samples = total_samples.load(Ordering::Relaxed);
            let approx_seconds = samples as f64 / config.target_sample_rate as f64;
            debug!(
                "Progress: {:.1}s captured ({} samples)",
                approx_seconds, samples
            );
        }
    }

    // Stop streams and finalize sink.
    drop(loopback_stream);
    drop(mic_stream);
    
    // Wait for mixer thread to finish sending remaining chunks
    let _ = mixer_handle.join();

    let total = total_samples.load(Ordering::Relaxed);
    let duration_captured = total as f64 / config.target_sample_rate as f64;

    if let Ok(mut s) = sink.lock() {
        s.finalize().context("Failed to finalize sink")?;
    }

    info!(
        "✅ Captured {} samples ({:.2}s)",
        total, duration_captured
    );

    Ok(())
}

/// Process a batch of f32 samples: downmix → resample → convert to PCM16 → send to mixer.
fn process_and_send(
    data: &[f32],
    tx: &mpsc::Sender<Vec<i16>>,
    resampler: &Option<Arc<Mutex<Resampler>>>,
    total_samples: &Arc<AtomicU64>,
    source_channels: usize,
    _target_channels: usize,
    running: &Arc<AtomicBool>,
) {
    if data.is_empty() {
        return;
    }

    // Shutdown is in progress: the mixer thread has already (or is about to)
    // drop its receivers, so sending here would just log a spurious "channel
    // closed" warning. Skip silently — this is expected, not an anomaly.
    if !running.load(Ordering::Relaxed) {
        return;
    }

    // Step 1: Always downmix to mono before the mixer.
    let mono_data: Vec<f32> = if source_channels > 1 {
        data.chunks(source_channels)
            .map(|frame| frame.iter().sum::<f32>() / source_channels as f32)
            .collect()
    } else {
        data.to_vec()
    };

    // Step 2: Resample if needed.
    let resampled = match resampler {
        Some(r) => match r.lock() {
            Ok(mut resampler) => match resampler.process(&mono_data) {
                Ok(samples) => samples,
                Err(e) => {
                    warn!("Resample error: {}", e);
                    return;
                }
            },
            Err(_) => return,
        },
        None => mono_data,
    };

    // Step 3: Convert f32 → i16 PCM16.
    let pcm16: Vec<i16> = resampled
        .iter()
        .map(|&s| (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)
        .collect();

    // Step 4: Send to mixer channel.
    if let Err(_) = tx.send(pcm16.clone()) {
        trace!("Mixer channel closed (shutdown race — expected)");
    }

    total_samples.fetch_add(pcm16.len() as u64, Ordering::Relaxed);
}

/// Helper to setup the microphone stream gracefully.
fn setup_mic_stream(
    host: &Host,
    target_sample_rate: u32,
    target_channels: u16,
    tx: mpsc::Sender<Vec<i16>>,
    running: Arc<AtomicBool>,
) -> Option<cpal::Stream> {
    let device = host.default_input_device()?;
    let name = device.name().unwrap_or_else(|_| "<mic>".into());
    info!("Found microphone: {}", name);

    let config = device.default_input_config().ok()?;
    let source_sample_rate = config.sample_rate().0;
    let source_channels = config.channels();
    let sample_format = config.sample_format();

    let needs_resample = source_sample_rate != target_sample_rate;
    let resampler = if needs_resample {
        Some(Arc::new(Mutex::new(Resampler::new(
            source_sample_rate,
            target_sample_rate,
            source_channels as usize,
        ).ok()?)))
    } else {
        None
    };

    let stream_config: cpal::StreamConfig = config.clone().into();
    let err_callback = |err: cpal::StreamError| {
        error!("Mic stream error: {}", err);
    };

    let total = Arc::new(AtomicU64::new(0));

    let stream = match sample_format {
        SampleFormat::F32 => {
            let running = running.clone();
            device.build_input_stream(
                &stream_config,
                move |data: &[f32], _| {
                    process_and_send(data, &tx, &resampler, &total, source_channels as usize, target_channels as usize, &running);
                },
                err_callback,
                None,
            ).ok()?
        }
        SampleFormat::I16 => {
            let running = running.clone();
            device.build_input_stream(
                &stream_config,
                move |data: &[i16], _| {
                    let float_data: Vec<f32> = data.iter().map(|&s| s as f32 / i16::MAX as f32).collect();
                    process_and_send(&float_data, &tx, &resampler, &total, source_channels as usize, target_channels as usize, &running);
                },
                err_callback,
                None,
            ).ok()?
        }
        _ => {
            warn!("Unsupported mic sample format: {:?}", sample_format);
            return None;
        }
    };

    Some(stream)
}
