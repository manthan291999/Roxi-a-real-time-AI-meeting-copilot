//! `BriefInputs` -> `CompiledBrief`. Pure: no SQLite, no HTTP, no clock, no RNG.
//!
//! Given identical inputs this returns an identical string. That property is
//! the entire design — OpenAI's prefix cache matches on an exact byte prefix,
//! so a single mutated byte above the closing sentinel means full-price prefill
//! for the rest of the session, silently, with no error anywhere.
//!
//! Consequences enforced here:
//!   * No `SystemTime::now()`, no rendered "now", no counters, no "chunk N of M".
//!     A date that belongs in a prompt goes in the volatile suffix (`compose`).
//!   * Every list is sorted deterministically before rendering. `HashMap`
//!     iteration order differs between runs, which produces a different prefix
//!     on every process restart and a cache that never hits — with nothing
//!     reporting a failure.
//!   * The agent's role contract goes first, inside the frozen block, so each
//!     agent gets its own cache entry. That is correct and expected.

use super::budget::{clamp_to_budget, estimate_tokens, take_within, Budget};
use super::model::{
    BriefInputs, BriefManifest, CompiledBrief, DocExtract, MeetingDigest, OpenItem,
};
use anyhow::{bail, Result};
use sha2::{Digest, Sha256};

pub const SENTINEL_OPEN: &str = "<<<ROXI_BRIEF_V1>>>";
pub const SENTINEL_CLOSE: &str = "<<<END_ROXI_BRIEF_V1>>>";

/// OpenAI engages prefix caching only at or above this many tokens, matched in
/// 128-token increments. Below it nothing is cached — there is no error and no
/// signal other than `cached_tokens` staying at zero.
pub const CACHE_FLOOR_TOKENS: usize = 1024;

/// Compile one agent's frozen prefix.
///
/// `role_contract` is that agent's system prompt — its role and output
/// contract. It is placed first so the prefix is agent-specific.
///
/// Returns `Err` when the assembled prefix exceeds `budget.total_cap`. That is
/// deliberately an error rather than a silent trim: a brief that quietly grew
/// to 30k tokens over six months is exactly the regression nobody notices until
/// answer quality has already degraded.
pub fn compile(
    role_contract: &str,
    inputs: &BriefInputs,
    budget: &Budget,
) -> Result<CompiledBrief> {
    let mut out = String::with_capacity(24_000);
    let mut included = BriefManifest::default();
    let mut dropped = BriefManifest::default();

    out.push_str(SENTINEL_OPEN);
    out.push_str("\n## Your role\n");
    out.push_str(clamp_to_budget(role_contract.trim(), budget.role));

    // --- what the user told us, frozen at capture -----------------------------
    if let Some(ctx) = non_empty(inputs.user_context.as_deref()) {
        out.push_str("\n\n## Meeting context (stated by the user)\n");
        out.push_str(clamp_to_budget(ctx, budget.user_context));
    }
    if let Some(role) = non_empty(inputs.user_role.as_deref()) {
        out.push_str("\nSpeaking as: ");
        out.push_str(role);
    }

    // --- project charter ------------------------------------------------------
    if let Some(project) = &inputs.project {
        out.push_str("\n\n## Project: ");
        out.push_str(&project.name);
        out.push_str(" (");
        out.push_str(&project.code);
        out.push_str(")\n");
        if let Some(description) = non_empty(inputs.project_description.as_deref()) {
            out.push_str(clamp_to_budget(description, budget.user_context));
        }
    }

    // --- glossary: canonical order, then budget --------------------------------
    // Sorted here rather than in SQL because the ordering is part of the prefix
    // contract, and a query's ORDER BY is too far from the invariant to defend.
    let mut glossary = inputs.glossary.clone();
    glossary.sort_by(|a, b| {
        a.term
            .cmp(&b.term)
            .then_with(|| a.definition.cmp(&b.definition))
    });
    glossary.dedup_by(|a, b| a.term == b.term);
    let (kept, cut) = take_within(&glossary, budget.glossary, |t| {
        render_term(&t.term, &t.definition)
    });
    if !kept.is_empty() {
        out.push_str("\n\n## Glossary\n");
        for t in &kept {
            out.push_str(&render_term(&t.term, &t.definition));
        }
    }
    included.glossary_terms = kept.len();
    if cut > 0 {
        dropped.glossary_terms = cut;
        dropped
            .reasons
            .push(format!("{cut} glossary terms: over budget"));
    }

    // --- roster ---------------------------------------------------------------
    // Frozen. A late joiner appended here would mutate the prefix and kill the
    // cache for the rest of the meeting; they belong in `compose`'s suffix.
    let mut roster = inputs.roster.clone();
    roster.sort_by(|a, b| a.name.cmp(&b.name));
    roster.dedup_by(|a, b| a.name == b.name);
    let (kept, cut) = take_within(&roster, budget.roster, |p| {
        render_participant(&p.name, p.role.as_deref())
    });
    if !kept.is_empty() {
        out.push_str("\n## Participants\n");
        for p in &kept {
            out.push_str(&render_participant(&p.name, p.role.as_deref()));
        }
    }
    included.participants = kept.len();
    if cut > 0 {
        dropped.participants = cut;
        dropped
            .reasons
            .push(format!("{cut} participants: over budget"));
    }

    // --- prior meetings (caller-ranked newest first) ---------------------------
    let (kept, cut) = take_within(&inputs.prior_meetings, budget.history, render_digest);
    if !kept.is_empty() {
        out.push_str("\n## Recent history in this project\n");
        for m in &kept {
            out.push_str(&render_digest(m));
            included.prior_meetings.push(m.display_id.clone());
        }
    }
    if cut > 0 {
        dropped
            .reasons
            .push(format!("{cut} older meetings: over budget"));
    }

    // --- open items -----------------------------------------------------------
    let mut open_items = inputs.open_items.clone();
    open_items.sort_by(|a, b| {
        a.kind
            .label()
            .cmp(b.kind.label())
            .then_with(|| a.text.cmp(&b.text))
    });
    let (kept, cut) = take_within(&open_items, budget.open_items, render_open_item);
    if !kept.is_empty() {
        out.push_str("\n## Still open coming into this meeting\n");
        for item in &kept {
            out.push_str(&render_open_item(item));
        }
    }
    included.open_items = kept.len();
    if cut > 0 {
        dropped.open_items = cut;
        dropped
            .reasons
            .push(format!("{cut} open items: over budget"));
    }

    // --- documents (caller-ranked best first) ----------------------------------
    let (kept, cut) = take_within(&inputs.doc_extracts, budget.documents, render_extract);
    if !kept.is_empty() {
        out.push_str("\n## Reference material\n");
        for d in &kept {
            out.push_str(&render_extract(d));
            included.doc_chunks.push(cite(d));
        }
    }
    if cut > 0 {
        dropped
            .reasons
            .push(format!("{cut} document chunks: over budget"));
    }

    out.push('\n');
    out.push_str(SENTINEL_CLOSE);

    let token_estimate = estimate_tokens(&out);
    if token_estimate > budget.total_cap {
        bail!(
            "brief exceeds cap: {token_estimate} > {} tokens",
            budget.total_cap
        );
    }

    let prefix_hash = hash_prefix(&out);
    let above_cache_floor = token_estimate >= CACHE_FLOOR_TOKENS;

    Ok(CompiledBrief::new(
        out,
        prefix_hash,
        token_estimate,
        above_cache_floor,
        included,
        dropped,
    ))
}

/// First 16 hex chars of the sha256. Enough to make a collision irrelevant for
/// "did this prefix change", short enough to read in a log line.
pub fn hash_prefix(prefix: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(prefix.as_bytes());
    hex::encode(hasher.finalize())[..16].to_string()
}

fn non_empty(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|s| !s.is_empty())
}

fn render_term(term: &str, definition: &str) -> String {
    format!("- {}: {}\n", term.trim(), definition.trim())
}

fn render_participant(name: &str, role: Option<&str>) -> String {
    format!(
        "- {} — {}\n",
        name.trim(),
        non_empty(role).unwrap_or("participant")
    )
}

fn render_digest(m: &MeetingDigest) -> String {
    let mut s = format!("### {} — {}\n", m.display_id, m.date);
    if let Some(summary) = non_empty(m.summary.as_deref()) {
        s.push_str(summary);
        s.push('\n');
    }
    if !m.decisions.is_empty() {
        s.push_str("Decisions: ");
        s.push_str(&m.decisions.join("; "));
        s.push('\n');
    }
    s
}

fn render_open_item(item: &OpenItem) -> String {
    match non_empty(item.owner.as_deref()) {
        Some(owner) => format!(
            "- [{}] {} — {}\n",
            item.kind.label(),
            item.text.trim(),
            owner
        ),
        None => format!("- [{}] {}\n", item.kind.label(), item.text.trim()),
    }
}

fn render_extract(d: &DocExtract) -> String {
    format!("[{}] {}\n", cite(d), d.text.trim())
}

fn cite(d: &DocExtract) -> String {
    match d.page {
        Some(page) => format!("{} p{}", d.file_name, page),
        None => d.file_name.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::super::compose::{compose, LIVE_SESSION_MARKER};
    use super::super::model::{
        DocExtract, GlossaryTerm, MeetingDigest, OpenItem, OpenItemKind, Participant,
    };
    use super::*;
    use crate::domain::project::{ProjectId, ProjectRef};

    const ROLE: &str = "You are the Explanation Agent. Return JSON: { \"explanation\": \"...\" }";

    fn fixture_inputs() -> BriefInputs {
        BriefInputs {
            project: Some(ProjectRef {
                id: ProjectId::new(1),
                code: "ROXI".into(),
                name: "Project Roxi".into(),
            }),
            project_description: Some("A desktop meeting copilot.".into()),
            user_context: Some("Weekly sync with the client about the SOW.".into()),
            user_role: Some("Technical Lead".into()),
            glossary: vec![
                GlossaryTerm {
                    term: "SOW".into(),
                    definition: "Statement of Work".into(),
                },
                GlossaryTerm {
                    term: "BlackHole".into(),
                    definition: "macOS loopback driver".into(),
                },
                GlossaryTerm {
                    term: "DER".into(),
                    definition: "Diarization Error Rate".into(),
                },
            ],
            roster: vec![
                Participant {
                    name: "Priya".into(),
                    role: Some("Client PM".into()),
                },
                Participant {
                    name: "Alex".into(),
                    role: None,
                },
            ],
            prior_meetings: vec![
                MeetingDigest {
                    display_id: "ROXI-002".into(),
                    date: "2026-09-01".into(),
                    summary: Some("Agreed the STT provider chain.".into()),
                    decisions: vec!["AssemblyAI stays primary".into()],
                },
                MeetingDigest {
                    display_id: "ROXI-001".into(),
                    date: "2026-08-24".into(),
                    summary: Some("Kickoff.".into()),
                    decisions: vec![],
                },
            ],
            open_items: vec![
                OpenItem {
                    kind: OpenItemKind::Risk,
                    text: "Diarization accuracy unproven".into(),
                    owner: None,
                },
                OpenItem {
                    kind: OpenItemKind::Action,
                    text: "Send the revised SOW".into(),
                    owner: Some("Priya".into()),
                },
            ],
            doc_extracts: vec![DocExtract {
                file_name: "sow.pdf".into(),
                page: Some(4),
                text: "The vendor shall deliver a macOS build.".into(),
                score: 0.81,
            }],
        }
    }

    fn fixture_with_glossary_terms(n: usize) -> BriefInputs {
        let mut inputs = fixture_inputs();
        inputs.glossary = (0..n)
            .map(|i| GlossaryTerm {
                term: format!("TERM{i:05}"),
                definition: "a definition long enough to cost real tokens".into(),
            })
            .collect();
        inputs
    }

    // The property the whole design rests on.
    #[test]
    fn prefix_is_byte_stable_across_compiles() {
        let inputs = fixture_inputs();
        let a = compile(ROLE, &inputs, &Budget::default()).unwrap();
        let b = compile(ROLE, &inputs, &Budget::default()).unwrap();
        assert_eq!(a.prefix(), b.prefix());
        assert_eq!(a.prefix_hash, b.prefix_hash);
    }

    // The test that catches the real bug: an unordered collection anywhere in
    // the input path produces a different prefix on every process start, the
    // cache never hits, and nothing reports an error.
    #[test]
    fn input_order_does_not_change_output() {
        let mut shuffled = fixture_inputs();
        shuffled.glossary.reverse();
        shuffled.roster.reverse();
        shuffled.open_items.reverse();
        assert_eq!(
            compile(ROLE, &fixture_inputs(), &Budget::default())
                .unwrap()
                .prefix_hash,
            compile(ROLE, &shuffled, &Budget::default())
                .unwrap()
                .prefix_hash
        );
    }

    #[test]
    fn over_budget_is_an_error_not_a_trim() {
        let huge = fixture_with_glossary_terms(5000);
        let result = compile(
            ROLE,
            &huge,
            &Budget {
                total_cap: 1000,
                glossary: 100_000,
                ..Default::default()
            },
        );
        assert!(result.is_err(), "an oversized brief must fail loudly");
    }

    #[test]
    fn a_section_over_its_own_budget_is_trimmed_and_reported() {
        let many = fixture_with_glossary_terms(400);
        let brief = compile(ROLE, &many, &Budget::default()).unwrap();
        assert!(brief.included.glossary_terms < 400);
        assert!(brief.dropped.glossary_terms > 0);
        assert!(brief
            .dropped
            .reasons
            .iter()
            .any(|r| r.contains("glossary terms")));
    }

    #[test]
    fn composed_prompt_never_puts_volatile_above_the_sentinel() {
        let brief = compile(ROLE, &fixture_inputs(), &Budget::default()).unwrap();
        let prompt = compose(ROLE, Some(&brief), "VOLATILE_MARKER", "the current turn");
        let combined = prompt.as_single_string();

        let close = combined.find(SENTINEL_CLOSE).expect("sentinel present");
        let marker = combined.find("VOLATILE_MARKER").expect("marker present");
        assert!(
            marker > close,
            "volatile content appeared above the closing sentinel"
        );
        assert!(combined.find(LIVE_SESSION_MARKER).unwrap() > close);
    }

    // Structurally stronger than the assertion above: the frozen half is its
    // own string, so volatile content cannot reach it at all.
    #[test]
    fn the_frozen_half_is_exactly_the_brief_prefix() {
        let brief = compile(ROLE, &fixture_inputs(), &Budget::default()).unwrap();
        let prompt = compose(ROLE, Some(&brief), "window", "turn");
        assert_eq!(prompt.system, brief.prefix());
        assert!(!prompt.system.contains(LIVE_SESSION_MARKER));
    }

    // The feature flag and the A/B mechanism: no brief degrades to the plain
    // role contract rather than failing.
    #[test]
    fn a_missing_brief_degrades_to_the_bare_role_contract() {
        let prompt = compose(ROLE, None, "window", "turn");
        assert_eq!(prompt.system, ROLE);
        assert!(!prompt.system.contains(SENTINEL_OPEN));
    }

    #[test]
    fn no_project_omits_the_project_section_rather_than_rendering_a_blank() {
        let mut inputs = fixture_inputs();
        inputs.project = None;
        inputs.project_description = None;
        let brief = compile(ROLE, &inputs, &Budget::default()).unwrap();
        assert!(!brief.prefix().contains("## Project:"));
    }

    #[test]
    fn a_tiny_brief_is_flagged_below_the_cache_floor() {
        let brief = compile(ROLE, &BriefInputs::default(), &Budget::default()).unwrap();
        assert!(
            !brief.above_cache_floor,
            "an empty project's brief cannot reach 1024 tokens"
        );
        assert!(brief.token_estimate < CACHE_FLOOR_TOKENS);
    }

    #[test]
    fn different_agents_get_different_prefixes() {
        let inputs = fixture_inputs();
        let a = compile(
            "You are the Explanation Agent.",
            &inputs,
            &Budget::default(),
        )
        .unwrap();
        let b = compile(
            "You are the Risk Detector Agent.",
            &inputs,
            &Budget::default(),
        )
        .unwrap();
        assert_ne!(a.prefix_hash, b.prefix_hash);
    }
}
