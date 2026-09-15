/**
 * Port: WebSearchGateway — one model call that MAY use a hosted web-search
 * tool, where the DECISION to search belongs to the model.
 *
 * Deliberately NOT a method on LlmGateway, for the two reasons that port's
 * own doc comment already cares about:
 *   - Liskov: LangchainLlmGateway (ChatOpenAI) cannot honour a hosted-tool
 *     call, so widening LlmGateway would leave one implementation unable to
 *     satisfy the contract.
 *   - Interface Segregation: every graph node depends on LlmGateway, and
 *     almost none of them may reach a web tool. A second, narrower port is
 *     the same move EvidenceSource made beside Retriever.
 *
 * @typedef {Object} WebAnswerRequest
 * @property {import('./LlmGateway').LlmMessage[]} messages
 *   System messages become the Responses API's `instructions`; the rest
 *   become `input` turns.
 * @property {'auto'|'required'} [toolChoice='auto']  'required' forces a search
 * @property {number} [maxTokens=1800]
 * @property {number} [timeoutMs=60000]
 * @property {string} [tag='web_call']  label for logs/metrics/usage rows
 *
 * @typedef {Object} WebCitation
 * @property {string} title
 * @property {string} url
 * @property {number} startIndex  index into `answer`
 * @property {number} endIndex    index into `answer`
 *
 * @typedef {Object} WebAnswerResult
 * @property {string} answer      PLAIN TEXT, never JSON — citation offsets
 *   address this string, so a JSON envelope would make them meaningless.
 * @property {WebCitation[]} citations
 * @property {boolean} usedWebSearch  the model actually searched
 * @property {number} searchCalls     how many times
 * @property {number} latencyMs
 * @property {string} model
 * @property {{prompt_tokens: number|null, completion_tokens: number|null}} usage
 *
 * Implementations MUST reject on failure rather than resolving with an empty
 * answer: the calling node owns the degradation policy, and it has to tell
 * "searched, found nothing" apart from "could not search at all".
 *
 * @interface WebSearchGateway
 * @method answer  @param {WebAnswerRequest} req @returns {Promise<WebAnswerResult>}
 * @method model   @returns {string} model id in use
 */
module.exports = {};
