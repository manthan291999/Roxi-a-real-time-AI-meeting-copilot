/**
 * Domain errors — typed failures the transport layer maps to protocol
 * messages. Keeping them in the domain lets every layer throw/recognize
 * them without circular imports.
 */

class ChatbotError extends Error {
  constructor(message, code = 'CHATBOT_ERROR') {
    super(message);
    this.name = 'ChatbotError';
    this.code = code;
  }
}

/** A required env var / credential is missing. */
class ConfigError extends ChatbotError {
  constructor(message) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigError';
  }
}

/** The LLM budget hard limit was reached. */
class BudgetExhaustedError extends ChatbotError {
  constructor(message = 'Chat LLM budget exhausted') {
    super(message, 'BUDGET_EXHAUSTED');
    this.name = 'BudgetExhaustedError';
  }
}

/** The meeting database could not be opened/read. */
class StoreError extends ChatbotError {
  constructor(message) {
    super(message, 'STORE_ERROR');
    this.name = 'StoreError';
  }
}

/**
 * A document could not be accepted, parsed or indexed.
 *
 * Carries a specific code so the UI can say something useful — an unsupported
 * type, a scan with no text layer, and a file over the size cap all need
 * different wording.
 */
class DocumentError extends ChatbotError {
  constructor(message, code = 'DOCUMENT_ERROR') {
    super(message, code);
    this.name = 'DocumentError';
  }
}

module.exports = {
  ChatbotError,
  ConfigError,
  BudgetExhaustedError,
  StoreError,
  DocumentError,
};
