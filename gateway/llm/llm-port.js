/**
 * LLM Port — interface contract for all LLM adapters.
 * @typedef {Object} LLMCallOptions
 * @property {Array<{role:string,content:string}>} messages
 * @property {boolean}  [expectJson=false]
 * @property {number}   [timeoutMs=15000]
 * @property {number}   [maxTokens=512]
 * @property {number}   [temperature=0.1]
 * @property {string}   [tag]
 *
 * @typedef {Object} LLMCallResult
 * @property {*}      data
 * @property {{prompt_tokens:number,completion_tokens:number}} usage
 * @property {number} latencyMs
 * @property {number} attempts
 * @property {string} model
 */
module.exports = {};
