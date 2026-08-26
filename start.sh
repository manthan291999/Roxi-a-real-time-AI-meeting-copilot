#!/bin/bash

# Ensure Rust/Cargo is in the PATH so Tauri can find it
export PATH="$HOME/.cargo/bin:$PATH"

echo "Starting Meeting Interpreter (Tauri + Node.js Sidecar)..."
npm run tauri dev
