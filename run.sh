#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status
set -e

echo "================================================="
echo "   Meeting Interpreter — Full Project Runner     "
echo "================================================="

echo "=> Installing Root Dependencies..."
npm install

echo "=> Installing Gateway Dependencies..."
npm install --prefix gateway

echo "=> Installing Chatbot Dependencies..."
npm install --prefix chatbot

echo "=> Installing Dashboard Dependencies..."
npm install --prefix dashboard

echo "================================================="
echo "   All Dependencies Installed Successfully       "
echo "================================================="
echo ""
echo "=> Starting Tauri Development App..."
echo "Note: If you need to run the Dashboard, open a new terminal and run: npm run dashboard"
echo ""

# Run the Tauri app
npm run tauri dev
