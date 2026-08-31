/**
 * Composition root — the ONLY module that knows concrete implementations.
 * Every other module depends on ports or factories; this wires the object
 * graph (Dependency Injection by hand, no framework needed).
 */

const { loadConfig } = require('../config/envConfig');
const { JsonLineLogger } = require('../infrastructure/logging/JsonLineLogger');
const { SqliteMeetingStore } = require('../infrastructure/persistence/SqliteMeetingStore');
const { FtsIndexBuilder } = require('../infrastructure/persistence/FtsIndexBuilder');
const { FtsRetriever } = require('../infrastructure/persistence/FtsRetriever');
const { CallCountBudgetGuard } = require('../infrastructure/budget/CallCountBudgetGuard');
const { OpenAiLlmGateway } = require('../infrastructure/llm/OpenAiLlmGateway');
const { LangchainLlmGateway } = require('../infrastructure/llm/LangchainLlmGateway');
const { UsageRecorder } = require('../infrastructure/usage/UsageRecorder');

const { createAnalyzeQueryNode } = require('../application/nodes/analyzeQueryNode');
const { createRetrieveNode } = require('../application/nodes/retrieveNode');
const { createGradeDocumentsNode } = require('../application/nodes/gradeDocumentsNode');
const { createRewriteQueryNode } = require('../application/nodes/rewriteQueryNode');
const { createClarifyNode } = require('../application/nodes/clarifyNode');
const { createGenerateNode } = require('../application/nodes/generateNode');
const { createRespondNoDataNode } = require('../application/nodes/respondNoDataNode');
const { buildChatGraph } = require('../application/graph/buildChatGraph');
const { AnswerQuestionUseCase } = require('../application/useCases/AnswerQuestionUseCase');

/**
 * Build the fully-wired chatbot.
 * @param {{skipLlm?: boolean, logLevel?: string}} [overrides]
 *   skipLlm: for index-only tools (rebuild-index) that need no API key.
 * @returns {{
 *   config: Object, logger: Object, store: Object, indexBuilder: Object,
 *   retriever: Object, budget: Object|null, llm: Object|null,
 *   useCase: AnswerQuestionUseCase|null, shutdown: () => void
 * }}
 */
function buildContainer(overrides = {}) {
  const config = loadConfig();
  const logger = new JsonLineLogger({ level: overrides.logLevel || config.logLevel });

  // Persistence (meeting DB read-only; index DB chatbot-owned).
  const store = new SqliteMeetingStore(config.meetingDbPath, logger);
  const indexBuilder = new FtsIndexBuilder(config.indexDbPath, logger);
  const retriever = new FtsRetriever(config.indexDbPath, logger);

  let budget = null;
  let llm = null;
  let useCase = null;
  let usageRecorder = null;

  if (!overrides.skipLlm) {
    budget = new CallCountBudgetGuard({
      softLimit: config.budgetSoft,
      hardLimit: config.budgetHard,
      logger,
    });

    // Persists every chatbot LLM call into the shared usage DB (dashboard/).
    usageRecorder = new UsageRecorder({
      dbPath: config.usageDbPath,
      trackPayloads: config.trackUsagePayloads,
      enabled: config.usageTracking,
      logger,
    });

    const llmOpts = {
      apiKey: config.openAiApiKey,
      model: config.model,
      baseUrl: config.openAiBaseUrl,
      budget,
      logger,
      usageRecorder,
    };
    llm = config.llmAdapter === 'langchain'
      ? new LangchainLlmGateway(llmOpts)
      : new OpenAiLlmGateway(llmOpts);

    const graph = buildChatGraph({
      analyzeQuery: createAnalyzeQueryNode({ llm, logger }),
      retrieve: createRetrieveNode({ retriever, logger }),
      gradeDocuments: createGradeDocumentsNode({ llm, logger }),
      rewriteQuery: createRewriteQueryNode({ llm, logger }),
      clarify: createClarifyNode({ llm, logger }),
      generate: createGenerateNode({ llm, logger }),
      respondNoData: createRespondNoDataNode({ logger, retriever }),
    });

    useCase = new AnswerQuestionUseCase({ graph, logger });
  }

  const shutdown = () => {
    store.close();
    indexBuilder.close();
    retriever.close();
    usageRecorder?.close();
  };

  return { config, logger, store, indexBuilder, retriever, budget, llm, useCase, shutdown };
}

module.exports = { buildContainer };
