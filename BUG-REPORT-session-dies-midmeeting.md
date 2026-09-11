# Live transcript stops and the session ends itself, ~2.5 minutes in

Root-caused from the 2026-09-11 12:21 session log (meeting 112 / `GEN-055`), reproduced
end to end against the real STT providers, fixed, and re-verified. This is not a theory
about what might have happened — the crash was reproduced on demand and the exact
failing line identified.

**Short version:** the app never crashed. A watchdog inside the gateway sidecar was
measuring *how long nobody had spoken* and interpreting it as *the connection is dead*.
Every ~50 seconds of quiet it tore down a perfectly healthy STT connection and opened a
new one without closing the old one. After three of those, the provider refused the next
connection on the account's concurrency quota — and that refusal arrived on an object
nobody was listening to, which in Node is a thrown exception. The sidecar died, and it
died invisibly, because a logging filter was dropping every sidecar log line below
ERROR.

---

## 1. What the log actually shows

```
12:21:29.3   capture started, BlackHole + mic, AssemblyAI connected
12:21:39     one final transcript stored ("To the Mel Robbins.")   ← the only one
12:21:41     chunk → 3 agents  complexity=MEDIUM  total=5970ms
12:21:42     detached risk → OK
             ... 2 minutes 24 seconds of nothing ...
12:24:06.4   [sidecar] Stdout closed unexpectedly — sidecar process likely died.
12:24:06.4   [capture] session closed, briefs released
12:24:06.6   Capture error: Failed to finalize sink
```

Three things in there are worth reading carefully.

**The Rust side was fine the whole time.** `Stdout closed unexpectedly` is Rust noticing
that its *child* process's pipe went away. The Tauri app kept running and kept logging.
Nothing in the app crashed.

**`Failed to finalize sink` is a symptom, not a cause.** It is the audio thread trying to
flush its last partial chunk into a pipe whose far end is already gone. It happens
*because* the sidecar died 170ms earlier. Chasing it leads nowhere.

**There is not one single `gateway`-tagged line in the entire log.** Not at startup, not
at failover, not at death. The gateway writes structured log lines to stderr constantly
and Rust relays them — so their complete absence is itself a bug, and it is the reason
the real cause was invisible. See §3.

The database agrees with the "died abruptly" reading:

```
meeting 112:  status = 'running'   end_time = (empty)
```

The sidecar's shutdown sequence sets `status` and `end_time`. Neither is set, so that
sequence never ran. This is not a one-off: **34 of 111 meetings are stuck at
`running`** — roughly a third of every session ever recorded ended this way.

---

## 2. The actual failure chain

### 2.1 The trigger — a watchdog that measures silence, not health

`gateway/stt/provider-manager.js` ran a liveness watchdog:

```js
const audioRecentlyFlowing = this.lastAudioAt && now - this.lastAudioAt < WATCHDOG_TIMEOUT_MS;
if (silentForMs > WATCHDOG_TIMEOUT_MS && audioRecentlyFlowing) {
  // assume the socket died silently, fail over
}
```

The intent was sound: *if we are pushing audio and getting nothing back for 45s, the
websocket probably dropped silently behind a NAT timeout.* The code comment even said
"comfortably above a normal in-meeting pause so a quiet room doesn't trigger a false
failover."

It does not do that. `lastAudioAt` is updated on **every** audio chunk, and audio never
stops during a capture — the mixer streams mic + BlackHole loopback continuously whether
or not anyone is speaking. A silent room produces a full-rate stream of near-zero
samples. So `audioRecentlyFlowing` is **permanently true** for the entire meeting, and
the condition collapses to:

> no transcript for 45 seconds → declare the connection dead

STT providers emit nothing during silence. So this fires on any 45-second pause: someone
reading a document, a gap before a demo starts, a meeting where the mic picks up nothing.
It was measuring the room, not the socket.

**Reproduced.** Feeding the real sidecar nothing but digital silence:

```
  1.8s  ProviderStatus assemblyai   active
 51.9s  stt_provider_error  "no transcript activity for 50s while audio is
                             flowing — assuming the connection died silently"
 51.9s  ProviderStatus speechmatics switching
103.4s  (fires again)
154.6s  (fires again)
```

Every ~51 seconds, forever, on a connection that was never broken.

### 2.2 The amplifier — failover detaches but never closes

```js
this.active = null; // detach: further events from it are ignored
```

That is the whole teardown. The old websocket stays open, and its **server-side session
stays alive**, holding one of the account's concurrent-stream slots. Each false failover
leaked one. Three cycles in, the app is holding three live STT sessions and asking for a
fourth.

### 2.3 The kill — an error nobody was listening for

Speechmatics refused the fourth session. That refusal came back as a server message,
which the provider turns into `this.emit('error', ...)`.

Listeners are attached in `ProviderManager.setActive()` — which only runs for a provider
that **successfully connected**. A provider whose `connect()` failed never got listeners,
while its socket was still open and still able to deliver a server error seconds later.

Node's `EventEmitter` turns an `'error'` emission with no registered listener into a
**thrown exception**. In a sidecar with no `uncaughtException` handler, that is instant
death.

The reproduction crashed at **155.9s** — against 147s in the real session:

```
154.6s  watchdog fires a third time → switching
155.9s  Error [ERR_UNHANDLED_ERROR]: Unhandled error.
          ({ message: 'Speechmatics: Concurrent Quota Exceeded', fatal: false })
            at SpeechmaticsProvider.emit (node:events:497:17)
            at SpeechmaticsProvider.handleServerMessage (gateway/providers/speechmatics.js:147:14)
155.9s  [EXIT] code=1
```

and left the meeting row at `status='running'` with no `end_time` — the exact signature
of meeting 112.

### 2.4 What you saw in the UI

`event_router.rs` synthesises an `Error` event when the sidecar's stdout closes, which
becomes `capture_error`, and `useCaptureSession.ts` responds by calling `stopCapture()`
and returning to the idle screen. So from the outside: the transcript stops, then a
while later the app drops itself back to idle. That part worked as designed — it was
correctly reporting a death it had no way to explain.

---

## 3. Why none of this was visible

`src-tauri/src/lib.rs` built its log filter like this:

```rust
EnvFilter::from_default_env().add_directive("tauri_app=info".parse().unwrap())
```

`relay_sidecar_log()` re-emits gateway/chatbot stderr under the targets `gateway` and
`chatbot`. Neither matches `tauri_app`, and a target that matches **no** directive falls
back to `EnvFilter`'s own default level — which is `ERROR`.

Verified directly:

| target | level | before | after |
|---|---|---|---|
| `tauri_app_lib::…` | INFO | printed | printed |
| `gateway` | INFO | **dropped** | printed |
| `gateway` | WARN | **dropped** | printed |
| `gateway` | ERROR | printed | printed |
| `chatbot` | INFO | **dropped** | printed |

The WARN row is the painful one. `relay_sidecar_log` prints any line it can't parse as
JSON — *a Node stack trace* — at WARN. So the sidecar printed a complete, accurate crash
report with the exact file and line, Rust received it, and the filter threw it away.

This single line is why a ~10-minute bug took a full investigation.

---

## 4. What was changed

### `gateway/stt/provider-manager.js`

1. **The watchdog now keys off speech, not audio.** Each chunk's normalised RMS is
   measured; only chunks above `SPEECH_RMS_THRESHOLD` (0.02, ≈ -34 dBFS — above mic room
   tone, below any normal speaking voice) update the liveness timestamp. "No transcript
   for 45s" is only evidence of a dead socket if there was speech to transcribe. The
   gate deliberately under-triggers: a missed dead socket costs one late failover (the
   provider's own `closed`/`error` events still catch the common cases), while a false
   trigger costs the session.
2. **Failover closes the connection it replaces**, so sessions stop leaking.
3. **A provider that fails to connect is closed too** — the Speechmatics client opens its
   socket before `start()` resolves, so a failed connect still held a quota slot.
4. **Every provider gets an `'error'` listener the moment it is created**, not when it
   goes active. A late error from a discarded or detached provider is now reported, never
   thrown.
5. **`sendAudio` is wrapped.** It runs on the stdin `data` handler, where an escaping
   exception is an uncaught exception; a provider throwing from a closing socket must not
   be able to kill the process.

### `gateway/sidecar.js`

`uncaughtException` and `unhandledRejection` handlers that emit a real protocol `Error`
line (so the UI shows the actual reason instead of "ended unexpectedly") and run the
normal shutdown sequence, so the meeting row is closed as `aborted` rather than left at
`running` forever. Installed before the session exists, so there is no unguarded window.

### `src-tauri/src/lib.rs`

Added explicit `gateway=info` and `chatbot=info` directives. Explicit targets rather than
a bare default level, which would also switch on every dependency's logging.

### `gateway/test/provider-manager.test.js` (new, 8 tests)

`ProviderManager` had no tests at all — the gap the previous audit flagged. Covers: a
quiet room never failing over; speech-with-no-transcripts still failing over; a
transcript keeping the connection alive; failover closing the old provider; a failed
connect being closed; a late error from a discarded provider not throwing; a late error
from a detached provider not disturbing the live one; `sendAudio` throwing being
contained.

---

## 5. Verification

Each bug was confirmed present before the change and absent after, using the same probe:

```
=========== BEFORE (committed code) ===========
SILENT ROOM    -> FAILED OVER      (bug present: a quiet room kills the connection)
LATE ERROR     -> THREW ERR_UNHANDLED_ERROR  (bug present: this kills the sidecar)
FAILED CONNECT -> socket LEAKED    (bug present: holds a concurrency slot)

=========== AFTER (fixed code) ===========
SILENT ROOM    -> stayed put       (fixed)
LATE ERROR     -> handled          (fixed)
FAILED CONNECT -> socket closed    (fixed)
```

Suites:

```
Gateway tests:  68 / 68 passing  (60 before + 8 new)
Rust tests:     72 / 72 passing
cargo check:    clean (2 pre-existing dead-code warnings only)
```

And the original crash scenario re-run end to end — the real sidecar, the real providers,
nothing but silence, the exact conditions that produced the crash:

```
   1.6s  ProviderStatus assemblyai  active
 230.0s  (harness time limit; child still healthy)

 failovers: 0     crashes: 0
```

One connection, held for the whole run. Previously this had failed over three times and
died at 155.9s.

Graceful shutdown was checked separately, since the crash handler now routes through it:

```
shutdown_started  reason=sigterm status=ended
shutdown_complete reason=sigterm
[EXIT] code=0
→ meetings row:  status='ended'  end_time='2026-09-11 07:25:40'
```

Worth noting that those two `shutdown_*` lines are gateway-target INFO — exactly the
class of line that was invisible before the filter fix.

---

## 6. Still open

**One question the log cannot answer.** For the watchdog to have fired at all, ~50
seconds had to pass with no transcript. If nobody was speaking, everything above fully
explains the session. If you *were* speaking and nothing came back, there is a second,
separate problem upstream (audio routing, or the mic not actually reaching the mixer)
that these fixes do not address. Now that gateway logs are visible, the next run will
show it plainly: a healthy session prints `Partial`/`Final` activity continuously. If you
speak and see none, that is the other bug.

**34 historical meetings are stuck at `status='running'`.** They are cosmetic —
`adapters/sqlite.rs` does not filter on status, so history renders them fine — and they
are left alone deliberately rather than silently rewriting a third of the meeting
history. A one-line `UPDATE meetings SET status='aborted' WHERE status='running' AND
end_time IS NULL` would tidy them up whenever you want it.

**The deprecation warnings are real but harmless**, and now that gateway logs are
visible you will see them on every start:
`minEndOfTurnSilenceWhenConfident` → `minTurnSilence`, `languageCode` → `languageCodes`
in `gateway/providers/assemblyai.js`.
