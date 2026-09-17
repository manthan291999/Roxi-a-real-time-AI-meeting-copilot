/**
 * Port: CorpusProbe — one synchronous yes/no membership test: does this term
 * appear anywhere in the user's own corpus?
 *
 * Backs the gibberish gate in application/guardrail/gibberish.js (see the
 * pre-router plan §06/§07). Deliberately NOT a method on EvidenceSource or
 * Retriever, for the same Interface Segregation reason WebSearchGateway is
 * not a method on LlmGateway: EvidenceSource.search() is asynchronous and
 * returns ranked, scored hits with provenance — a shape built for grading
 * and citation, not for a synchronous single-term shape check. Widening
 * either port would force FtsRetriever to accept an argument it does not
 * want, and force every vector source (EpisodicMemoryEvidenceSource,
 * DocumentEvidenceSource) to implement a lexical membership test they
 * cannot answer without an embedding call — which would defeat the entire
 * point of a check meant to cost a fraction of a millisecond.
 *
 * SYNCHRONOUS ON PURPOSE: gibberish.js is called from triage(), a pure
 * function invoked from decideEntry on every turn — an async corpus probe
 * there would mean decideEntry itself becomes async, which LangGraph's
 * conditional-edge signature does not require and this design does not need.
 * better-sqlite3 (the one implementation today, FtsCorpusProbe) is
 * synchronous natively; this is not a limitation imposed on it.
 *
 * FAIL OPEN IS PART OF THE CONTRACT, not an implementation detail an
 * adapter may skip: has() MUST resolve every failure — a missing index, a
 * corrupt file, a locked database, anything — to `true` (found), never
 * `false` (not found) and never a thrown error. gibberish.js trusts this
 * completely; it does not wrap calls to has() in its own try/catch. See
 * FtsCorpusProbe's own header comment for why a false positive here
 * (telling a user their real question is nonsense) is unrecoverable, while
 * treating a read failure as "found" only costs one turn that skips the
 * gibberish check — the same asymmetry gibberish.js's own header comment
 * argues from.
 *
 * @interface CorpusProbe
 * @method has
 *   @param {string} term a single word, already tokenized by the caller
 *   @returns {boolean} true when the term is found OR the probe could not
 *     run at all; false only on a genuine, successful "not found"
 */
module.exports = {};
