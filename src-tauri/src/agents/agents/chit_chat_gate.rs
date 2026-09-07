//! chit_chat_gate — zero-LLM filter for filler speech.
//! PERF FIX #5: The more filler we catch here, the fewer LLM calls we make.
//! Every phrase caught here saves ~2-8s of pipeline latency and real API cost.

pub fn is_filler(text: &str) -> bool {
    let lower = text.to_lowercase();
    let trimmed = lower.trim();

    // Very short utterances (≤ 15 chars, ≤ 3 words) are almost always filler.
    // Guard against empty strings first.
    if trimmed.is_empty() {
        return true;
    }

    // Exact-match filler phrases — order by frequency for early exit
    let fill_exact = [
        // Acknowledgements
        "yeah", "yes", "no", "yep", "nope", "yup", "nah",
        // Fillers
        "uh", "um", "hmm", "hm", "uh huh", "mm hmm", "mm",
        // Simple agreement
        "okay", "ok", "ok.", "okay.", "right", "right.", "sure", "sure.",
        // Short affirmations
        "i see", "got it", "i think so", "makes sense", "exactly",
        "cool", "great", "nice", "perfect", "agreed", "sounds good",
        "absolutely", "definitely", "totally", "fair enough", "of course",
        "no problem", "no worries", "understood", "copy that", "roger",
        "for sure", "for real", "true", "true.", "correct",
        // Transition fillers
        "so", "well", "anyway", "anyhow", "alright", "alright.",
        "let me think", "give me a second", "one second", "one sec",
        // Thanks
        "thanks", "thank you", "cheers",
    ];

    // Short utterance check: ≤ 3 words → try exact match
    let word_count = trimmed.split_whitespace().count();
    if word_count <= 3 {
        for phrase in &fill_exact {
            if trimmed == *phrase {
                return true;
            }
        }
    }

    // Prefix check for slightly longer filler: "yeah exactly right", "ok so moving on"
    let fill_prefixes = [
        "yeah ", "yes ", "ok ", "okay ", "right ", "sure ", "uh ", "um ",
        "hmm ", "hm ", "so ", "well ", "anyway ", "alright ",
    ];
    if word_count <= 5 {
        for prefix in &fill_prefixes {
            if let Some(rest) = trimmed.strip_prefix(prefix) {
                // Only filler when what follows the filler word is itself
                // filler. The previous rule gated any short utterance opening
                // with one of these, so "ok let's ship friday" — a decision —
                // was dropped before it reached a single agent.
                let rest = rest.trim();
                if rest.is_empty() || fill_exact.contains(&rest) {
                    return true;
                }
            }
        }
    }

    false
}

