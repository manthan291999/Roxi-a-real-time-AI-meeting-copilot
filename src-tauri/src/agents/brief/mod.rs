//! The "small brain" — a capture-scoped, cached prompt prefix.
//!
//! Everything knowable at `start_capture` is compiled once into a frozen block
//! that sits above every agent's prompt for the life of the session: the
//! project charter, the glossary, the roster, prior meeting digests, still-open
//! items, and a one-shot document extract. Everything that can change
//! mid-meeting stays in the volatile suffix.
//!
//! ## What this buys, in order of size
//!
//! 1. **Grounding.** Every agent sees the glossary, the roster and prior
//!    decisions. This is the product improvement.
//! 2. **Cost.** ~5k prefix × ~6 calls/chunk × ~40 chunks is over a million
//!    input tokens a meeting. Provider prefix caching bills a hit at a fraction
//!    of the input rate, which is what makes carrying the grounding affordable.
//! 3. **Latency.** Real but modest, and it comes mostly from *deleting the
//!    per-chunk retrieval round trip* — an embedding call plus a vector scan,
//!    100–300 ms on every chunk — not from prefill savings. At ~5k tokens the
//!    caching TTFT win is single-digit percent. Do not claim otherwise.
//!
//! ## Layers
//!
//! * `model` — plain data.
//! * `budget` — pure token accounting and ranked truncation.
//! * `compiler` — pure `BriefInputs` -> `CompiledBrief`. No I/O, no clock.
//! * `compose` — pure prompt assembly. The only place a prompt is built.
//! * `store` — the compiled briefs for a live capture.
//!
//! Gathering the inputs is a use case (`application::brief_usecase`) reading
//! through ports, never an agent's job: an agent that reached into SQLite and
//! the embedding gateway to build its own brief would be untestable, and every
//! other agent would need the same wiring.

pub mod budget;
pub mod compiler;
pub mod compose;
pub mod model;
pub mod store;
