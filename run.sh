#!/usr/bin/env bash
# =============================================================================
#  run.sh — Roxi AI  |  Full Project Launcher
#  Starts: Dashboard (background) → Tauri App (foreground)
#  Cleans up all background processes on Ctrl+C / exit
# =============================================================================

set -eo pipefail

# ─── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

# ─── Tracked background PIDs (for clean teardown) ─────────────────────────────
BACKGROUND_PIDS=()

# ─── Cleanup: kill all background children on exit ────────────────────────────
cleanup() {
  echo ""
  echo -e "${YELLOW}⏹  Shutting down all services...${RESET}"
  if [ ${#BACKGROUND_PIDS[@]} -gt 0 ]; then
    for pid in "${BACKGROUND_PIDS[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null && echo -e "   ${RED}✗${RESET} Stopped PID $pid"
      fi
    done
  fi
  echo -e "${GREEN}✔  All services stopped. Goodbye.${RESET}"
}
trap cleanup EXIT INT TERM

# ─── Helpers ──────────────────────────────────────────────────────────────────
step()    { echo -e "\n${BOLD}${BLUE}▶ $1${RESET}"; }
ok()      { echo -e "  ${GREEN}✔${RESET}  $1"; }
warn()    { echo -e "  ${YELLOW}⚠${RESET}  $1"; }
fatal()   { echo -e "  ${RED}✗  FATAL: $1${RESET}"; exit 1; }

# ─── Banner ───────────────────────────────────────────────────────────────────
echo -e "${BOLD}${CYAN}"
echo "  ╔══════════════════════════════════════════════════╗"
echo "  ║          🎙  Roxi AI — Project Launcher          ║"
echo "  ║      Meeting Intelligence Platform · v0.1        ║"
echo "  ╚══════════════════════════════════════════════════╝"
echo -e "${RESET}"

# ─── 1. Prerequisite checks ───────────────────────────────────────────────────
step "Checking prerequisites"

command -v node  >/dev/null 2>&1 || fatal "node is not installed. Install Node.js >= 18."
command -v npm   >/dev/null 2>&1 || fatal "npm is not installed."
command -v cargo >/dev/null 2>&1 || fatal "cargo is not installed. Install Rust via rustup."
ok "node  $(node --version)"
ok "npm   $(npm --version)"
ok "cargo $(cargo --version | awk '{print $2}')"

# ─── 2. .env validation ───────────────────────────────────────────────────────
step "Validating environment variables"

ENV_FILE=".env"
if [ ! -f "$ENV_FILE" ]; then
  fatal ".env file not found at project root. Copy .env.example → .env and fill in your keys."
fi

source_env() {
  # Export every KEY=VALUE line from the .env file.
  # Strips comments, blank lines, and handles quoted values + special chars in values.
  while IFS= read -r line || [[ -n "$line" ]]; do
    # Skip blank lines and comment lines
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    # Only process lines that look like KEY=VALUE
    if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      export "$line"
    fi
  done < "$ENV_FILE"
}
source_env

MISSING_KEYS=()
[[ -z "${OPENAI_API_KEY:-}" ]]       && MISSING_KEYS+=("OPENAI_API_KEY")
[[ -z "${ASSEMBLYAI_API_KEY:-}" && -z "${SPEECHMATICS_API_KEY:-}" ]] \
                                     && MISSING_KEYS+=("ASSEMBLYAI_API_KEY or SPEECHMATICS_API_KEY")

if [ ${#MISSING_KEYS[@]} -gt 0 ]; then
  echo -e "  ${RED}✗  Missing required keys in .env:${RESET}"
  for k in "${MISSING_KEYS[@]}"; do echo "     • $k"; done
  fatal "Cannot start without required API keys."
fi
ok "All required environment keys are present"

# ─── 3. Install dependencies ──────────────────────────────────────────────────
step "Installing Node.js dependencies"

install_if_needed() {
  local dir="$1"
  local label="$2"
  if [ ! -d "$dir/node_modules" ]; then
    echo -e "  ${CYAN}↓${RESET}  Installing $label..."
    npm install --prefix "$dir" --silent
    ok "$label dependencies installed"
  else
    ok "$label node_modules already present — skipping"
  fi
}

install_if_needed "."         "Root"
install_if_needed "gateway"   "Gateway (STT sidecar)"
install_if_needed "chatbot"   "Chatbot (Roxi AI)"
install_if_needed "dashboard" "LLM Usage Dashboard"

# ─── 4. Rust / Tauri dependency check ────────────────────────────────────────
step "Verifying Rust crates (cargo check)"
(cd src-tauri && cargo check --quiet 2>&1) \
  && ok "Rust crates OK" \
  || fatal "Rust cargo check failed. Run 'cargo build' in src-tauri/ to see errors."

# ─── 5. Start LLM Usage Dashboard (background) ───────────────────────────────
step "Starting LLM Usage Dashboard"

DASHBOARD_PORT="${DASHBOARD_PORT:-3001}"
DASHBOARD_LOG="/tmp/roxi_dashboard.log"

# Check if port is already in use
if lsof -ti tcp:"$DASHBOARD_PORT" >/dev/null 2>&1; then
  warn "Dashboard port $DASHBOARD_PORT is already in use — skipping dashboard start."
  warn "Open http://localhost:$DASHBOARD_PORT in your browser if it's already running."
else
  npm --prefix dashboard start > "$DASHBOARD_LOG" 2>&1 &
  DASHBOARD_PID=$!
  BACKGROUND_PIDS+=("$DASHBOARD_PID")

  # Wait up to 5s for dashboard to become ready
  READY=0
  for i in {1..10}; do
    sleep 0.5
    if curl -sf "http://localhost:$DASHBOARD_PORT" >/dev/null 2>&1; then
      READY=1; break
    fi
  done

  if [ "$READY" -eq 1 ]; then
    ok "Dashboard running  →  http://localhost:${DASHBOARD_PORT}  (PID: $DASHBOARD_PID)"
    ok "Dashboard logs     →  $DASHBOARD_LOG"
  else
    warn "Dashboard did not respond within 5s. Check $DASHBOARD_LOG for errors."
    warn "Continuing anyway — dashboard is optional."
  fi
fi

# ─── 6. Summary before launch ─────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}  ╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${CYAN}  ║              🚀  Launching Roxi AI               ║${RESET}"
echo -e "${BOLD}${CYAN}  ╚══════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  ${BOLD}Services:${RESET}"
echo -e "   ${GREEN}●${RESET}  LLM Dashboard   →  http://localhost:${DASHBOARD_PORT}"
echo -e "   ${GREEN}●${RESET}  Tauri App       →  starting now (foreground)"
echo -e "   ${CYAN}ℹ${RESET}  Gateway sidecar is launched by the Tauri app on session start"
echo -e "   ${CYAN}ℹ${RESET}  Chatbot sidecar is launched by the Tauri app on chat open"
echo ""
echo -e "  ${YELLOW}Press Ctrl+C to stop all services.${RESET}"
echo ""

# ─── 7. Launch Tauri App (foreground — blocks until user quits) ───────────────
step "Starting Tauri Development App"
npm run tauri dev
