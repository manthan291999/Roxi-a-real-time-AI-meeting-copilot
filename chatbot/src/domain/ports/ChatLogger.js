/**
 * Port: ChatLogger — structured logging contract.
 *
 * IMPORTANT: in sidecar mode stdout is reserved for the JSON protocol, so
 * implementations must write to stderr (or a file), never stdout.
 *
 * @interface ChatLogger
 * @method info  @param {string} scope @param {string} event @param {Object} [meta]
 * @method warn  @param {string} scope @param {string} event @param {Object} [meta]
 * @method error @param {string} scope @param {string} event @param {Object} [meta]
 */
module.exports = {};
