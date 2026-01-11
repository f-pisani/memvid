/**
 * TypeScript type definitions for memvid-node
 */

/** Options for storing a document */
export interface PutOptions {
  /** Document title */
  title?: string;
  /** Document URI (unique identifier) */
  uri?: string;
  /** Document kind/type */
  kind?: string;
  /** Labels for categorization */
  labels?: string[];
}

/** Options for timeline queries */
export interface TimelineOptions {
  /** Maximum number of entries to return */
  limit?: number;
  /** Only return entries after this timestamp (Unix ms) */
  since?: number;
  /** Only return entries before this timestamp (Unix ms) */
  until?: number;
  /** Reverse order (newest first) */
  reverse?: boolean;
}

/** A timeline entry */
export interface TimelineEntry {
  /** Frame ID */
  frameId: number;
  /** Frame timestamp (Unix ms) */
  timestamp: number;
  /** Preview text */
  preview: string;
  /** Frame URI */
  uri?: string;
}

/** Frame metadata */
export interface FrameInfo {
  /** Frame ID */
  id: number;
  /** Frame timestamp (Unix ms) */
  timestamp: number;
  /** Frame URI */
  uri?: string;
  /** Frame title */
  title?: string;
  /** Frame kind/type */
  kind?: string;
  /** Payload length in bytes */
  payloadLength: number;
}

/** A single search hit */
export interface SearchHit {
  /** Frame ID */
  frameId: number;
  /** Relevance score */
  score?: number;
  /** Matched text snippet */
  text: string;
  /** Byte range start in original content */
  rangeStart: number;
  /** Byte range end in original content */
  rangeEnd: number;
  /** Frame title */
  title?: string;
  /** Frame URI */
  uri?: string;
}

/** Search response */
export interface SearchResult {
  /** Total hits found */
  totalHits: number;
  /** Hits returned (may be limited) */
  hits: SearchHit[];
  /** Search engine used */
  engine: string;
  /** Cursor for pagination */
  cursor?: string;
}

/**
 * Memory kind for filtering memory cards
 */
export type MemoryKind = 'Fact' | 'Preference' | 'Event' | 'Profile' | 'Relationship' | 'Goal' | 'Other';

/**
 * Filter for Memory Cards to restrict search to frames matching criteria.
 *
 * Multiple filters in an array are ORed together - frames matching ANY filter are included.
 * Within a single filter, all specified criteria are ANDed together.
 *
 * **Empty filter behavior**: An empty filter `{}` (all fields undefined) matches ALL memory cards.
 * This is useful when you want to find only frames that have at least one memory card attached,
 * regardless of content.
 *
 * @example
 * ```typescript
 * // Filter by entity
 * const filter1: MemoryFilter = { entity: 'alice' };
 *
 * // Filter by slot and value
 * const filter2: MemoryFilter = { slot: 'employer', valueContains: 'Anthropic' };
 *
 * // Filter by kind (case-insensitive: 'fact', 'Fact', 'FACT' all work)
 * const filter3: MemoryFilter = { kind: 'Fact' };
 *
 * // Combined filter (all must match)
 * const filter4: MemoryFilter = {
 *   entity: 'alice',
 *   slot: 'employer',
 *   valueContains: 'Inc',
 *   kind: 'Fact'
 * };
 *
 * // Empty filter - matches frames with ANY memory card
 * const allWithCards: MemoryFilter = {};
 *
 * // Use in search (OR across filters)
 * const results = mem.find('work history', {
 *   memoryFilters: [filter1, filter2]  // Frames matching filter1 OR filter2
 * });
 * ```
 */
export interface MemoryFilter {
  /** Entity name (case-insensitive, "*" matches all entities) */
  entity?: string;
  /** Slot/attribute name (case-insensitive) */
  slot?: string;
  /** Substring to match in value (case-insensitive) */
  valueContains?: string;
  /** Memory kind to match (case-insensitive: 'Fact', 'fact', 'FACT' all work) */
  kind?: MemoryKind;
}

/** Options for search filtering */
export interface SearchOptions {
  /** Maximum number of results to return (default: 10) */
  topK?: number;
  /** Restrict search to a specific URI */
  uri?: string;
  /** Restrict search to a scope (URI prefix) */
  scope?: string;
  /** Exclude specific frame IDs from results */
  excludeFrameIds?: number[];
  /** Exclude frames matching these URIs from results */
  excludeUris?: string[];
  /**
   * Filter by Memory Cards - only return frames that have matching memory cards.
   * Multiple filters are ORed together.
   * Applied at query-time BEFORE search ranking for efficient filtering.
   */
  memoryFilters?: MemoryFilter[];
}

/** Statistics about a memvid file */
export interface Stats {
  /** Total number of frames */
  frameCount: number;
  /** File size in bytes */
  sizeBytes: number;
  /** Whether lex (text) index is enabled */
  hasLexIndex: boolean;
  /** Whether vec (vector) index is enabled */
  hasVecIndex: boolean;
  /** Whether CLIP index is enabled */
  hasClipIndex: boolean;
  /** Whether time index is enabled */
  hasTimeIndex: boolean;
  /** Number of active (non-deleted) frames */
  activeFrameCount: number;
  /** Total payload bytes */
  payloadBytes: number;
  /** Total logical bytes (before compression) */
  logicalBytes: number;
  /** Bytes saved by compression */
  savedBytes: number;
  /** Compression ratio as percentage */
  compressionRatioPercent: number;
  /** Savings as percentage */
  savingsPercent: number;
  /** Average payload bytes per frame */
  averageFramePayloadBytes: number;
  /** Average logical bytes per frame */
  averageFrameLogicalBytes: number;
  /** Vector count in index */
  vectorCount: number;
}

/** Embedding provider interface */
export interface EmbeddingProvider {
  /** Generate embedding for a single text */
  embedQuery(text: string): Promise<number[]>;
  /** Generate embeddings for multiple texts */
  embedDocuments(texts: string[]): Promise<number[][]>;
  /** Get the embedding dimension */
  dimension: number;
}

/** Configuration for OpenAI embeddings */
export interface OpenAIEmbeddingsConfig {
  /** OpenAI API key */
  apiKey: string;
  /** Model to use (default: text-embedding-3-small) */
  model?: string;
  /** Base URL for API (default: https://api.openai.com/v1) */
  baseUrl?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
}

/** Configuration for Cohere embeddings */
export interface CohereEmbeddingsConfig {
  /** Cohere API key */
  apiKey: string;
  /** Model to use (default: embed-english-v3.0) */
  model?: string;
  /** Base URL for API (default: https://api.cohere.ai/v1) */
  baseUrl?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
}

/** Configuration for Voyage embeddings */
export interface VoyageEmbeddingsConfig {
  /** Voyage API key */
  apiKey: string;
  /** Model to use (default: voyage-2) */
  model?: string;
  /** Base URL for API (default: https://api.voyageai.com/v1) */
  baseUrl?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
}

/** Result of a single document in putMany */
export interface PutManyItemResult {
  /** Index of the document in the input array */
  index: number;
  /** Frame ID if successful */
  frameId?: number;
  /** Error if failed */
  error?: Error;
  /** Whether this document was successfully stored */
  success: boolean;
}

/** Result of putMany operation */
export interface PutManyResult {
  /** Results for each document */
  results: PutManyItemResult[];
  /** Number of successfully stored documents */
  successCount: number;
  /** Number of failed documents */
  failureCount: number;
  /** Frame IDs of successfully stored documents (for convenience) */
  frameIds: number[];
}

/** A single CLIP visual search hit */
export interface ClipSearchHit {
  /** Frame ID */
  frameId: number;
  /** Page number (1-indexed, for PDFs) */
  page?: number;
  /** L2 distance to query (lower is more similar) */
  distance: number;
}

// ============================================================================
// Whisper Audio Transcription Types
// ============================================================================

/**
 * A segment of transcription with timestamps
 */
export interface TranscriptionSegment {
  /** Start time in seconds */
  start: number;
  /** End time in seconds */
  end: number;
  /** Transcribed text for this segment */
  text: string;
}

/**
 * Result of audio transcription
 */
export interface TranscriptionResult {
  /** The transcribed text */
  text: string;
  /** Language detected or specified */
  language: string;
  /** Duration of audio in seconds */
  durationSecs: number;
  /** Segments with timestamps */
  segments: TranscriptionSegment[];
}

/**
 * Options for configuring the Whisper transcriber
 */
export interface WhisperOptions {
  /**
   * Model name to use for transcription.
   * Available models: "whisper-small-en" (default), "whisper-small", "whisper-base-en", etc.
   */
  modelName?: string;
  /**
   * Directory where models are cached.
   * Default: ~/.memvid/models or MEMVID_MODELS_DIR env var
   */
  modelsDir?: string;
  /**
   * Whether to run in offline mode (no model downloads).
   * Default: false (from MEMVID_OFFLINE env var)
   */
  offline?: boolean;
}

// ============================================================================
// Enrichment Pipeline Types
// ============================================================================

/**
 * Statistics about enrichment state.
 */
export interface EnrichmentStats {
  /** Total active frames */
  totalFrames: number;
  /** Frames that have been fully enriched */
  enrichedFrames: number;
  /** Frames pending enrichment */
  pendingFrames: number;
  /** Frames that are searchable but not enriched (skimmed) */
  skimmedFrames: number;
}

/**
 * An enrichment task in the queue.
 */
export interface EnrichmentTask {
  /** Frame ID to enrich */
  frameId: number;
  /** Timestamp when task was created (Unix epoch seconds) */
  createdAt: number;
  /** Number of chunks already processed */
  chunksDone: number;
  /** Total chunks to process */
  chunksTotal: number;
}

/**
 * Result of processing an enrichment batch.
 */
export interface ProcessBatchResult {
  /** Number of tasks processed */
  tasksProcessed: number;
  /** Number of tasks that succeeded */
  tasksSucceeded: number;
  /** Number of tasks that failed */
  tasksFailed: number;
  /** Frame IDs that were enriched */
  enrichedFrameIds: number[];
  /** Errors encountered (if any) */
  errors: string[];
}

// ============================================================================
// Optimization Types
// ============================================================================

/**
 * Result of a vacuum operation.
 *
 * Vacuum reclaims space from deleted frames and rebuilds indexes.
 */
export interface VacuumResult {
  /** Number of bytes reclaimed by vacuum */
  bytesReclaimed: number;
  /** Number of active frames retained after vacuum */
  framesRetained: number;
  /** File size before vacuum (bytes) */
  sizeBefore: number;
  /** File size after vacuum (bytes) */
  sizeAfter: number;
}

/**
 * Result of a WAL compaction operation.
 *
 * WAL compaction commits pending changes and cleans up the write-ahead log.
 */
export interface CompactWalResult {
  /** Number of WAL records compacted */
  recordsCompacted: number;
  /** WAL size before compaction (bytes) */
  walSizeBefore: number;
  /** WAL size after compaction (bytes) */
  walSizeAfter: number;
  /** Number of pending records before compaction */
  pendingBefore: number;
  /** Number of pending records after compaction (should be 0) */
  pendingAfter: number;
}

/**
 * A chunk embedding for document ingestion.
 */
export interface ChunkEmbedding {
  /** Optional text content of the chunk */
  text?: string;
  /** Embedding vector for the chunk */
  embedding: number[];
}

// ============================================================================
// Ask (RAG) Types
// ============================================================================

/**
 * Request options for ask (RAG Q&A).
 */
export interface AskRequest {
  /** The question to ask */
  question: string;
  /** Maximum number of context chunks to retrieve (default: 5) */
  topK?: number;
  /** Maximum characters per snippet (default: 500) */
  snippetChars?: number;
  /** Filter to specific URI */
  uri?: string;
  /** Filter to URI scope (prefix match) */
  scope?: string;
  /** Pagination cursor */
  cursor?: string;
  /** Start timestamp filter (Unix epoch seconds) */
  start?: number;
  /** End timestamp filter (Unix epoch seconds) */
  end?: number;
  /** If true, only return context without synthesized answer */
  contextOnly?: boolean;
  /** Retrieval mode: "lex", "sem", or "hybrid" (default: "lex" for NAPI) */
  mode?: string;
  /** Replay: Filter to frames with id <= asOfFrame (time-travel view) */
  asOfFrame?: number;
  /** Replay: Filter to frames with timestamp <= asOfTs (time-travel view) */
  asOfTs?: number;
}

/**
 * Citation pointing back into the memory.
 */
export interface AskCitation {
  /** 1-based citation index */
  index: number;
  /** Frame ID of the source */
  frameId: number;
  /** URI of the source frame */
  uri?: string;
  /** Start character position in source */
  startChar?: number;
  /** End character position in source */
  endChar?: number;
}

/**
 * A context fragment retrieved for the question.
 */
export interface AskContextFragment {
  /** Frame ID of the source */
  frameId: number;
  /** Text snippet from the frame */
  text: string;
  /** Relevance score */
  score: number;
  /** URI of the source frame */
  uri?: string;
  /** Title of the source frame */
  title?: string;
}

/**
 * Statistics about the ask operation.
 */
export interface AskStats {
  /** Time spent retrieving context in milliseconds */
  retrievalMs: number;
  /** Time spent synthesizing the answer in milliseconds */
  synthesisMs: number;
  /** End-to-end latency in milliseconds */
  latencyMs: number;
}

/**
 * Response from ask (RAG Q&A).
 */
export interface AskResponse {
  /** The original question */
  question: string;
  /** Retrieval mode used: "lex", "sem", or "hybrid" */
  mode: string;
  /** Retriever used: "lex", "semantic", "hybrid", "lex_fallback", or "timeline_fallback" */
  retriever: string;
  /** Whether context-only mode was used */
  contextOnly: boolean;
  /** Generated answer (null if contextOnly: true) */
  answer?: string;
  /** Concatenated context text for LLM consumption */
  context: string;
  /** Retrieved context fragments */
  contextFragments: AskContextFragment[];
  /** Citations for answer (empty if contextOnly: true) */
  citations: AskCitation[];
  /** Total hits found */
  totalHits: number;
  /** Operation statistics */
  stats: AskStats;
}
