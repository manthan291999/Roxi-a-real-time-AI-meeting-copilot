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
const { OpenAiResponsesGateway } = require('../infrastructure/llm/OpenAiResponsesGateway');
const { UsageRecorder } = require('../infrastructure/usage/UsageRecorder');
const { OpenAiEmbeddingGateway } = require('../infrastructure/embedding/OpenAiEmbeddingGateway');
const { SqliteChunkStore } = require('../infrastructure/persistence/SqliteChunkStore');
const { QdrantVectorIndex } = require('../infrastructure/vectorstore/QdrantVectorIndex');
const { EpisodicMemoryEvidenceSource } = require('../infrastructure/vectorstore/EpisodicMemoryEvidenceSource');
const { SemanticMemoryEvidenceSource } = require('../infrastructure/vectorstore/SemanticMemoryEvidenceSource');
const { SyncStateStore } = require('../infrastructure/sync/SyncStateStore');
const { SyncEpisodicMemoryUseCase } = require('../application/useCases/SyncEpisodicMemoryUseCase');
const { SyncSemanticMemoryUseCase } = require('../application/useCases/SyncSemanticMemoryUseCase');
const { PurgeEpisodicMemoryUseCase } = require('../application/useCases/PurgeEpisodicMemoryUseCase');
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
const { createDirectAnswerNode } = require('../application/nodes/directAnswerNode');
const { createWebAnswerNode } = require('../application/nodes/webAnswerNode');
const { createGenerateWebNode } = require('../application/nodes/generateWebNode');
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
  let chunkStore = null;
  let vectorIndex = null;
  let syncState = null;
  let syncEpisodicMemory = null;
  let syncSemanticMemory = null;
  let semanticVectorIndex = null;
  let purgeEpisodicMemory = null;
  let webGateway = null;
  let webBudget = null;

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

    // Web search gets its own budget, for the same reason embeddings do: one
    // research-mode question must not consume the call allowance belonging to
    // the conversation it was asked in. Soft equals hard — unlike chat, there
    // is no useful degraded web call to allow through.
    webBudget = new CallCountBudgetGuard({
      softLimit: config.webBudgetHard,
      hardLimit: config.webBudgetHard,
      logger,
    });
    webGateway = new OpenAiResponsesGateway({
      apiKey: config.openAiApiKey,
      // Empty config means "use the chat model" — the override exists so the
      // web path can differ without moving any other node.
      model: config.webSearchModel || config.model,
      baseUrl: config.openAiBaseUrl,
      toolType: config.webSearchToolType,
      contextSize: config.webSearchContextSize,
      maxToolCalls: config.webMaxToolCalls,
      userLocation: buildUserLocation(config),
      timeoutMs: config.webTimeoutMs,
      budget: webBudget,
      logger,
      usageRecorder,
    });

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

    // Meeting Semantic Memory: Phase 2 built the backfill (bin/sync-
    // vectors.js); Phase 3 reads it back via EpisodicMemoryEvidenceSource
    // below, registered into the same evidence array as everything else.
    chunkStore = new SqliteChunkStore(config.meetingDbPath, logger);
    vectorIndex = new QdrantVectorIndex({
      baseUrl: config.qdrantUrl,
      collection: config.qdrantEpisodicCollection,
      logger,
    });
    syncState = new SyncStateStore(config.indexDbPath);
    syncEpisodicMemory = new SyncEpisodicMemoryUseCase({
      chunkStore,
      embeddings,
      vectorIndex,
      syncState,
      logger,
    });
    purgeEpisodicMemory = new PurgeEpisodicMemoryUseCase({
      vectorIndex,
      retentionDays: config.episodicRetentionDays,
      logger,
    });

    semanticVectorIndex = new QdrantVectorIndex({
      baseUrl: config.qdrantUrl,
      collection: config.qdrantSemanticCollection,
      logger,
    });
    syncSemanticMemory = new SyncSemanticMemoryUseCase({
      meetingStore: store,
      embeddings,
      vectorIndex: semanticVectorIndex,
      logger,
    });

    // retrieveNode gets one EvidenceSource and cannot tell how many corpora
    // are behind it. Adding a source is one more entry in this array.
    const evidenceSource = new CompositeEvidenceSource({
      sources: [
        new FtsEvidenceSource(retriever, logger),
        new DocumentEvidenceSource({ documents, embeddings, logger }),
        new LiveTranscriptEvidenceSource(),
        new EpisodicMemoryEvidenceSource({
          vectorIndex,
          embeddings,
          chunkStore,
          logger,
          scoring: {
            wRelevance: config.episodicWeightRelevance,
            wImportance: config.episodicWeightImportance,
            wRecency: config.episodicWeightRecency,
            recencyHalflifeDays: config.episodicRecencyHalflifeDays,
          },
        }),
        new SemanticMemoryEvidenceSource({
          vectorIndex: semanticVectorIndex,
          embeddings,
          logger,
        }),
      ],
      logger,
    });

    // Built before the graph because the two web nodes are handed their
    // non-web twin as a fallback: when the web is unreachable, web_answer
    // delegates to direct_answer and generate_web to generate (or to
    // respond_no_data when there was no evidence either). Injected rather
    // than imported, so neither web node learns what it falls back to and
    // the graph needs no extra edge.
    const directAnswer = createDirectAnswerNode({ llm, logger });
    const generate = createGenerateNode({ llm, logger, store });
    const respondNoData = createRespondNoDataNode({ logger, retriever });

    const graph = buildChatGraph({
      analyzeQuery: createAnalyzeQueryNode({ llm, logger }),
      retrieve: createRetrieveNode({ evidenceSource, logger }),
      gradeDocuments: createGradeDocumentsNode({ llm, logger }),
      rewriteQuery: createRewriteQueryNode({ llm, logger }),
      clarify: createClarifyNode({ llm, logger }),
      generate,
      respondNoData,
      // Knowledge switch OFF: no evidence source injected, by design.
      directAnswer,
      // Web switch ON. Both offer the tool and let the MODEL decide whether
      // the question needs it — there is no classifier call anywhere here.
      webAnswer: createWebAnswerNode({
        web: webGateway, logger, fallback: directAnswer,
      }),
      generateWeb: createGenerateWebNode({
        web: webGateway, logger, store,
        fallback: generate, noDataFallback: respondNoData,
      }),
    });

    useCase = new AnswerQuestionUseCase({
      graph,
      logger,
      // The PRODUCT default, applied to any turn that does not specify one.
      // The graph's own default is 'never' (see state.js) so that a caller
      // which knows nothing about web search is unaffected; this is where
      // 'auto' actually enters the system.
      defaultWebMode: config.webSearchMode,
    });

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
    chunkStore?.close();
    syncState?.close();
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
    webBudget,
    llm,
    webGateway,
    useCase,
    parsers,
    indexDocument,
    manageDocuments,
    chunkStore,
    vectorIndex,
    semanticVectorIndex,
    syncState,
    syncEpisodicMemory,
    syncSemanticMemory,
    purgeEpisodicMemory,
    shutdown,
  };
}

/**
 * The search tool's optional locality. Returns null unless something was
 * configured — an absent user_location is different from an empty one.
 */
function buildUserLocation(config) {
  const country = config.webUserCountry;
  const city = config.webUserCity;
  const region = config.webUserRegion;
  if (!country && !city && !region) return null;
  return {
    type: 'approximate',
    ...(country ? { country } : {}),
    ...(city ? { city } : {}),
    ...(region ? { region } : {}),
  };
}

module.exports = { buildContainer };
