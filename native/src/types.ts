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
