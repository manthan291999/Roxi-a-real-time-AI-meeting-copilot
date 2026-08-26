/**
 * @interface ITranscriptCleaner
 * @property {function(string): Promise<{action: 'keep'|'drop'|'translate', text: string, reason?: string}>} clean
 */
module.exports = {};
