/**
 * Infrastructure: PermissiveCorpusProbe — a CorpusProbe that always finds
 * the term.
 *
 * The null-object counterpart to FtsCorpusProbe (Liskov substitution: a
 * disabled or unavailable feature returns a valid, well-formed answer
 * rather than being special-cased by every caller). With this wired in,
 * gibberish.js's corpus gate always says "found", which means the message
 * can never be classified as gibberish — the shape gate alone is never
 * enough on its own by design (see gibberish.js's header comment: a false
 * positive there is unrecoverable, so the corpus gate is a required veto,
 * not an optional refinement).
 *
 * Composition root usage — swap this in for FtsCorpusProbe wherever
 * "gibberish detection should not actually reject anything" is the
 * intended behaviour: a cold install with no index yet, or any context
 * where fabricating the false-positive risk buys nothing. It is
 * observationally identical to passing no probe at all — see
 * gibberish.js's own isGibberishToken, which treats an absent probe the
 * same way — this class exists so the composition root can express that
 * choice with a named, readable dependency instead of a bare `null`.
 */
class PermissiveCorpusProbe {
  has(_term) {
    return true;
  }
}

module.exports = { PermissiveCorpusProbe };
