//! routing — pure routing decision, no async, no I/O, 100% unit-testable.
//! ChunkGraph calls this after ContextManagerAgent sets state.complexity.
//!
//! NOTE: `run_explanation` is true on every branch, and ChunkGraph relies on that —
//! it starts the explanation agent concurrently with stage 1, before this function
//! is called. If you ever make a route skip explanation, that eager start in
//! ChunkGraph::run has to be made conditional too, or it will do wasted work.

use crate::agents::domain::chunk_state::{ChunkState, Complexity};

pub struct RouteDecision {
    pub run_explanation: bool,
    pub run_technical:   bool,
    pub run_risk:        bool,
    pub run_analyst:     bool,
}

/// Decision table (LLM calls, and how many are on the reply's critical path):
/// Low    → explanation only                         2 calls, 1 hop  (reply skipped)
/// Medium → explanation + risk                       4 calls, 2 hops (risk detached)
/// High   → explanation + technical + risk + analyst 6 calls, 3 hops (risk/analyst detached)
pub fn decide(state: &ChunkState) -> RouteDecision {
    match state.complexity {
        Complexity::Low => RouteDecision {
            run_explanation: true,
            run_technical:   false,
            run_risk:        false,
            run_analyst:     false,
        },
        Complexity::Medium => RouteDecision {
            run_explanation: true,
            run_technical:   false,
            run_risk:        true,
            run_analyst:     false,
        },
        Complexity::High => RouteDecision {
            run_explanation: true,
            run_technical:   true,
            run_risk:        true,
            run_analyst:     true,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::domain::chunk_state::{ChunkState, Complexity};

    #[test]
    fn low_runs_only_explanation() {
        let s = ChunkState { complexity: Complexity::Low, ..Default::default() };
        let r = decide(&s);
        assert!(r.run_explanation);
        assert!(!r.run_technical && !r.run_risk && !r.run_analyst);
    }

    #[test]
    fn medium_runs_explanation_and_risk() {
        let s = ChunkState { complexity: Complexity::Medium, ..Default::default() };
        let r = decide(&s);
        assert!(r.run_explanation && r.run_risk);
        assert!(!r.run_technical && !r.run_analyst);
    }

    #[test]
    fn high_runs_all() {
        let s = ChunkState { complexity: Complexity::High, ..Default::default() };
        let r = decide(&s);
        assert!(r.run_explanation && r.run_technical && r.run_risk && r.run_analyst);
    }

    #[test]
    fn default_complexity_is_medium_safe_fallback() {
        let s = ChunkState::default();   // complexity defaults to Medium
        let r = decide(&s);
        assert!(r.run_explanation && r.run_risk);
        assert!(!r.run_technical);
    }
}
