pub fn is_filler(text: &str) -> bool {
    let lower = text.to_lowercase();
    let trimmed = lower.trim();

    let fill_phrases = [
        "yeah", "yes", "no", "okay", "ok", "right", "uh", "um", "hmm", "hm",
        "i see", "exactly", "makes sense", "cool", "got it", "i think so",
    ];

    // Simple length heuristic and exact match check for filler words
    if trimmed.split_whitespace().count() <= 3 {
        for phrase in fill_phrases {
            if trimmed == phrase {
                return true;
            }
        }
    }
    
    false
}
