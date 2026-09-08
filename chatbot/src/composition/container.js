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
const { OpenAiEmbeddingGateway } = require('../infrastructure/embedding/OpenAiEmbeddingGateway');
const { DocumentRepositorySqlite } = require('../infrastructure/documents/DocumentRepositorySqlite');
const { DocumentEvidenceSource } = require('../infrastructure/documents/DocumentEvidenceSource');
const { FtsEvidenceSource } = require('../infrastructure/persistence/FtsEvidenceSource');
const { CompositeEvidenceSource } = require('../application/retrieval/CompositeEvidenceSource');
const { LiveTranscriptEvidenceSource } = require('../application/retrieval/LiveTranscriptEvidenceSource');
const { createParserRegistry } = require('../infrastructure/documents/parsers/parserRegistry');

const { createAnalyzeQueryNode } = require('../application/nodes/analyzeQueryNode');
const { createRetrieveNode } = require('../application/nodes/retrieveNode');
const { createGradeDocumentsNode } = require('../application/nodes/gradeDocumentsNode');
const { createRewriteQueryNode } = require('../application/nodes/rewriteQueryNode');
const { createClarifyNode } = require('../application/nodes/clarifyNode');
const { createGenerateNode } = require('../application/nodes/generateNode');
const { createRespondNoDataNode } = require('../application/nodes/respondNoDataNode');
const { buildChatGraph } = require('../application/graph/buildChatGraph');
const { AnswerQuestionUseCase } = require('../application/useCases/AnswerQuestionUseCase');
const { IndexDocumentUseCase } = require('../application/useCases/IndexDocumentUseCase');
const { ManageDocumentsUseCase } = require('../application/useCases/ManageDocumentsUseCase');

/**
 * Build the fully-wired chatbot.
 * @param {{skipLlm?: boolean, logLevel?: string}} [overrides]
 *   skipLlm: for index-only tools (rebuild-index) that need no API key.
 * @returns {{
 *   config: Object, logger: Object, store: Object, indexBuilder: Object,
 *   retriever: Object, budget: Object|null, llm: Object|null,
 *   useCase: AnswerQuestionUseCase|null, indexDocument: IndexDocumentUseCase|null,
 *   manageDocuments: ManageDocumentsUseCase|null, shutdown: () => void
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
  let documents = null;
  let embeddings = null;
  let embedBudget = null;
  let parsers = null;
  let indexDocument = null;
  let manageDocuments = null;

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

    // Embeddings get their own budget: one large upload must not consume the
    // call allowance belonging to the conversation it was uploaded for.
    embedBudget = new CallCountBudgetGuard({
      softLimit: config.embedBudgetHard,
      hardLimit: config.embedBudgetHard,
      logger,
    });
    embeddings = new OpenAiEmbeddingGateway({
      apiKey: config.openAiApiKey,
      model: config.embedModel,
      baseUrl: config.openAiBaseUrl,
      budget: embedBudget,
      logger,
      usageRecorder,
    });
    documents = new DocumentRepositorySqlite(config.docStorePath, logger);

    // retrieveNode gets one EvidenceSource and cannot tell how many corpora
    // are behind it. Adding a source is one more entry in this array.
    const evidenceSource = new CompositeEvidenceSource({
      sources: [
        new FtsEvidenceSource(retriever, logger),
        new DocumentEvidenceSource({ documents, embeddings, logger }),
        new LiveTranscriptEvidenceSource(),
      ],
      logger,
    });

    const graph = buildChatGraph({
      analyzeQuery: createAnalyzeQueryNode({ llm, logger }),
      retrieve: createRetrieveNode({ evidenceSource, logger }),
      gradeDocuments: createGradeDocumentsNode({ llm, logger }),
      rewriteQuery: createRewriteQueryNode({ llm, logger }),
      clarify: createClarifyNode({ llm, logger }),
      generate: createGenerateNode({ llm, logger }),
      respondNoData: createRespondNoDataNode({ logger, retriever }),
    });

    useCase = new AnswerQuestionUseCase({ graph, logger });

    // Upload/list/delete. Deliberately built from the SAME documents
    // repository the evidence source reads, so a document is searchable the
    // moment indexing marks it ready — no second store, no sync step.
    parsers = createParserRegistry();
    indexDocument = new IndexDocumentUseCase({
      documents,
      embeddings,
      parsers,
      logger,
      limits: {
        maxDocumentBytes: config.maxDocumentBytes,
        maxLibraryBytes: config.maxLibraryBytes,
        maxDocuments: config.maxDocuments,
      },
    });
    manageDocuments = new ManageDocumentsUseCase({ documents, logger });
  }

  const shutdown = () => {
    store.close();
    indexBuilder.close();
    retriever.close();
    documents?.close();
    usageRecorder?.close();
  };

  return {
    config,
    logger,
    store,
    indexBuilder,
    retriever,
    documents,
    embeddings,
    budget,
    embedBudget,
    llm,
    useCase,
    parsers,
    indexDocument,
    manageDocuments,
    shutdown,
  };
}

module.exports = { buildContainer };
