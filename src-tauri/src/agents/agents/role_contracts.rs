//! The one enumeration of (agent tag -> role contract).
//!
//! The brief use case compiles one prefix per entry here, from a single round of
//! I/O. Each contract stays next to its agent — the prompt belongs with the code
//! that parses its output — and this module only lists them.
//!
//! ## Adding an agent
//!
//! Add its `(name, ROLE_CONTRACT)` pair. If you forget, that agent still works:
//! it finds no brief, falls back to its bare contract, and behaves exactly as it
//! did before the brain existed. `assert_every_agent_has_a_contract` in
//! `chunk_graph` is what turns that silent degradation into a dev-build failure.
//!
//! The tag must be byte-identical to the agent's `Agent::name()` — it is the
//! store key, the usage-row tag, and half the prompt cache key.

use super::{analyst, context_manager, explanation, response_agent, risk_detector, technical};

/// Every agent that gets a compiled brief.
///
/// `complexity_analyzer` is deliberately absent: nothing constructs it (its
/// classification is folded into `context_manager`), so compiling a brief for
/// it would pay for a prefix nobody sends.
pub const ALL: &[(&'static str, &'static str)] = &[
    ("context_manager", context_manager::ROLE_CONTRACT),
    ("explanation", explanation::ROLE_CONTRACT),
    ("technical", technical::ROLE_CONTRACT),
    ("analyst", analyst::ROLE_CONTRACT),
    ("risk_detector", risk_detector::ROLE_CONTRACT),
    ("response_agent", response_agent::ROLE_CONTRACT),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tags_are_unique() {
        let mut tags: Vec<&str> = ALL.iter().map(|(tag, _)| *tag).collect();
        tags.sort_unstable();
        let count = tags.len();
        tags.dedup();
        assert_eq!(count, tags.len(), "two agents share a tag");
    }

    #[test]
    fn every_contract_is_non_trivial() {
        for (tag, contract) in ALL {
            assert!(
                contract.len() > 40,
                "{tag}'s role contract is suspiciously short"
            );
        }
    }
}
