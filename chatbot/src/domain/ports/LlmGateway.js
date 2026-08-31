/**
 * Port: LlmGateway — chat completion contract for every graph node.
 *
 * Two interchangeable implementations exist (Liskov):
 *  - OpenAiLlmGateway      (direct SDK; required for models with parameter
 *                           quirks, e.g. gpt-5.6-luna rejecting temperature)
 *  - LangchainLlmGateway   (ChatOpenAI; for standard OpenAI-compatible models)
 *
 * @typedef {Object} LlmMessage
 * @property {'system'|'user'|'assistant'} role
 * @property {string} content
 *
 * @typedef {Object} LlmCallOptions
 * @property {LlmMessage[]} messages
 * @property {boolean}  [expectJson=false]  request + parse a JSON object
 * @property {number}   [maxTokens=1024]
 * @property {number}   [timeoutMs=30000]
 * @property {string}   [tag='call']        label for logs/metrics
 *
 * @typedef {Object} LlmResult
 * @property {*}      data       parsed object when expectJson, else string
 * @property {number} latencyMs
 * @property {string} model
 *
 * @interface LlmGateway
 * @method complete  @param {LlmCallOptions} opts  @returns {Promise<LlmResult>}
 * @method model     @returns {string} model id in use
 */
module.exports = {};
