//! Token accounting and ranked truncation. Pure — no dependencies at all.
//!
//! Joins `orchestrator::routing` in the pure-decision tier: given identical
//! inputs it produces identical output, which is what makes the brief testable
//! without a database or a network.

/// Per-section token ceilings.
///
/// These are deliberately conservative. A bigger brief is not a better brief:
/// past a few thousand tokens of grounding, answers get vaguer rather than
/// sharper, and the cost of the extra tokens is paid on every call of every
/// chunk. `total_cap` is a safety rail, not a target.
#[derive(Clone, Copy, Debug)]
pub struct Budget {
    pub role: usize,
    pub user_context: usize,
    pub glossary: usize,
    pub roster: usize,
    pub history: usize,
    pub open_items: usize,
    pub documents: usize,
    pub total_cap: usize,
}

impl Default for Budget {
    fn default() -> Self {
        Self {
            role: 400,
            user_context: 250,
            glossary: 800,
            roster: 200,
            history: 1500,
            open_items: 400,
            documents: 2000,
            total_cap: 5600,
        }
    }
}

/// Deliberately crude. What the caller needs is a stable, cheap, monotonic
/// estimate — not an exact tokenizer. Slightly overestimating is the safe
/// direction: it trims a section early rather than blowing the cap.
pub fn estimate_tokens(s: &str) -> usize {
    s.len().div_ceil(4)
}

/// Take items in the caller's rank order until the budget is spent.
///
/// Never emits a partial item. A truncated glossary entry or half a meeting
/// summary reads as complete to the model and produces confidently wrong
/// output, which is strictly worse than the item being absent.
///
/// Returns the kept items and how many were dropped.
pub fn take_within<T, F>(items: &[T], budget: usize, render: F) -> (Vec<&T>, usize)
where
    F: Fn(&T) -> String,
{
    let mut kept = Vec::new();
    let mut used = 0usize;
    for item in items {
        let cost = estimate_tokens(&render(item));
        if used + cost > budget {
            break;
        }
        used += cost;
        kept.push(item);
    }
    let dropped = items.len() - kept.len();
    (kept, dropped)
}

/// Clamp free text to a section budget on a word boundary.
///
/// Used only for the single-blob sections (the user's context, a project
/// charter) where the alternative to trimming is dropping the user's own words
/// entirely. Item lists go through `take_within` instead.
pub fn clamp_to_budget(text: &str, budget: usize) -> &str {
    let max_bytes = budget.saturating_mul(4);
    if text.len() <= max_bytes {
        return text;
    }
    // Walk back to a char boundary first — byte-slicing mid-codepoint panics,
    // and em dashes and curly quotes are routine in pasted context.
    let mut end = max_bytes;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    match text[..end].rfind(char::is_whitespace) {
        Some(space) if space > 0 => &text[..space],
        _ => &text[..end],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estimate_rounds_up_so_short_strings_never_cost_zero() {
        assert_eq!(estimate_tokens(""), 0);
        assert_eq!(estimate_tokens("a"), 1);
        assert_eq!(estimate_tokens("abcd"), 1);
        assert_eq!(estimate_tokens("abcde"), 2);
    }

    #[test]
    fn take_within_keeps_whole_items_in_order() {
        let items = vec!["aaaa", "bbbb", "cccc"]; // 1 token each
        let (kept, dropped) = take_within(&items, 2, |s| s.to_string());
        assert_eq!(kept, vec![&"aaaa", &"bbbb"]);
        assert_eq!(dropped, 1);
    }

    #[test]
    fn take_within_drops_a_single_oversized_item_rather_than_cutting_it() {
        let items = vec!["x".repeat(400)];
        let (kept, dropped) = take_within(&items, 10, |s| s.clone());
        assert!(kept.is_empty());
        assert_eq!(dropped, 1);
    }

    #[test]
    fn clamp_breaks_on_whitespace_and_never_mid_codepoint() {
        let text = "alpha beta gamma delta";
        assert_eq!(clamp_to_budget(text, 100), text);
        assert_eq!(clamp_to_budget(text, 2), "alpha");
        // 4-byte codepoints at the boundary must not panic.
        let emoji = "🙂".repeat(10);
        assert!(emoji.starts_with(clamp_to_budget(&emoji, 2)));
    }
}
