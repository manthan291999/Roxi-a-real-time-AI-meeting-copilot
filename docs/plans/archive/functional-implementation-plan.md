# Functional Implementation Plan

## Goal Description
This plan addresses two critical functional issues you reported:
1. **Headphones / Audio Capture Issue**: When you use headphones, standard audio capture cannot record the audio going to your headphones because it's an output device. To capture system audio on a Mac, you need a virtual audio driver like **BlackHole**, which allows you to set up a Multi-Output device. We will detect if BlackHole is installed and guide the user to install it via a modal if it's missing.
2. **AssemblyAI Hallucinations**: Sometimes background noise is incorrectly interpreted as foreign words or random speech. We will enforce strict English translation and filter out confidence thresholds.

## User Review Required
> [!IMPORTANT]
> Since installing BlackHole requires downloading a PKG file or using Homebrew, we can either:
> **Option A**: Give the user a button that runs `brew install blackhole-2ch` automatically (if they have Homebrew).
> **Option B**: Give the user a direct link to download the BlackHole installer.
> *I have planned for a UI that provides both options.*

## Proposed Changes

---

### Rust Backend (Device Detection)

We need to accurately detect if the BlackHole virtual driver is present in the system's CoreAudio devices.

#### [MODIFY] `src-tauri/src/commands/audio_devices.rs`
- Add a new function using the `cpal` library to iterate over all input devices and check if any device's name contains `"BlackHole"`.
- Expose this check as a Tauri command `check_blackhole_installed`.

---

### React Frontend (UI & Guidance)

If the driver isn't installed, we need to show the user a modal explaining *why* they need it for headphones and how to install it.

#### [MODIFY] `src/components/BlackHoleModal.tsx`
- Redesign the modal to clearly explain: "To capture meeting audio while using headphones, macOS requires a virtual audio driver."
- Add instructions for creating a "Multi-Output Device" in Audio MIDI Setup.
- Add an "Install via Homebrew" button (which will trigger a Tauri command) and a "Download Installer" link.

#### [MODIFY] `src/App.tsx`
- On mount, invoke `check_blackhole_installed`. If `false`, automatically show the `BlackHoleModal`.

---

### Node.js Gateway (AssemblyAI Hallucinations)

AssemblyAI can sometimes "hallucinate" words from static noise or misinterpret non-speech sounds as random words (often in other languages). 

#### [MODIFY] `gateway/providers/assemblyai.js`
- I have already added `languageCode: 'en'` which forces AssemblyAI to stick to English.
- We will further add `speech_threshold` config or a filter in the `onMessage` handler to drop words with very low confidence (`confidence < 0.50`) to discard static noise hallucinations.

## Verification Plan

### Automated Tests
- Compile React app with `npm run build`.
- Compile Rust backend with `cargo check`.

### Manual Verification
- I will ask you to open the app. If you don't have BlackHole installed, the modal should appear.
- I will ask you to verify if the AssemblyAI transcripts ignore background static better.
