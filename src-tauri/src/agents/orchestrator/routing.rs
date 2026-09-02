//! routing — pure routing decision, no async, no I/O, 100% unit-testable.
//! ChunkGraph calls this after ComplexityAnalyzerAgent sets state.complexity.

use crate::agents::domain::chunk_state::{ChunkState, Complexity};

pub struct RouteDecision {
    pub run_explanation: bool,
    pub run_technical:   bool,
    pub run_risk:        bool,
    pub run_analyst:     bool,
}

/// Decision table:
/// Low    → explanation only                        (4 LLM calls total)
/// Medium → explanation + risk in parallel          (5 LLM calls total)
/// High   → explanation + technical + risk + analyst (7 LLM calls total)
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
