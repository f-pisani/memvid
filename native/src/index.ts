/**
 * memvid-node - Node.js bindings for memvid-core
 *
 * A single-file memory layer for AI agents. Packages documents, embeddings,
 * search indices, and metadata into a portable .mv2 file.
 *
 * @example
 * ```typescript
 * import { create, open, OpenAIEmbeddings } from 'memvid-node';
 *
 * // Create a new memvid file
 * const mem = create('/path/to/memory.mv2');
 * mem.enableLex();
 *
 * // Store documents
 * mem.put(Buffer.from('Hello world'), { title: 'Greeting' });
 * mem.commit();
 *
 * // Search
 * const results = mem.find('hello');
 * console.log(results.hits);
 * ```
 *
 * @packageDocumentation
 */

// Load native bindings
import * as native from '../index.js';

// Re-export types
export * from './types';
export * from './error';
export * from './embeddings';

import type {
  PutOptions,
  TimelineOptions,
  TimelineEntry,
  FrameInfo,
  SearchResult,
  SearchOptions,
  Stats,
  EmbeddingProvider,
  PutManyResult,
  PutManyItemResult,
  MemoryFilter,
  ClipSearchHit,
  ClipSearchOptions,
  HybridSearchOptions,
  GraphSearchOptions,
  GraphSearchHit,
  GraphSearchResult,
  EnrichmentStats,
  EnrichmentTask,
  ProcessBatchResult,
  VacuumResult,
  CompactWalResult,
  ChunkEmbedding,
  AskRequest,
  AskResponse,
} from './types';
import { parseNapiError, MemvidError } from './error';

// ============================================================================
// Input Validation
// ============================================================================

/**
 * Validate embedding vector
 */
function validateEmbedding(embedding: unknown, label: string = 'embedding'): number[] {
  if (!Array.isArray(embedding)) {
    throw new MemvidError('INVALID_INPUT', `${label} must be an array`);
  }
  if (embedding.length === 0) {
    throw new MemvidError('INVALID_INPUT', `${label} cannot be empty`);
  }
  for (let i = 0; i < embedding.length; i++) {
    if (typeof embedding[i] !== 'number' || !Number.isFinite(embedding[i])) {
      throw new MemvidError('INVALID_INPUT', `${label}[${i}] must be a finite number`);
    }
  }
  return embedding;
}

/**
 * Validate positive integer
 */
function validatePositiveInt(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) {
    throw new MemvidError('INVALID_INPUT', `${name} must be a non-negative integer`);
  }
  return num;
}

/**
 * Parse search options from either a number (legacy topK) or SearchOptions object
 */
interface ParsedSearchOptions {
  limit: number | undefined;
  uri: string | undefined;
  scope: string | undefined;
  excludeIds: number[] | undefined;
  excludeUris: string[] | undefined;
  memoryFilters: MemoryFilter[] | undefined;
  includeCards: boolean | undefined;
}

function parseSearchOptions(options?: SearchOptions | number): ParsedSearchOptions {
  if (typeof options === 'number') {
    return {
      limit: options,
      uri: undefined,
      scope: undefined,
      excludeIds: undefined,
      excludeUris: undefined,
      memoryFilters: undefined,
      includeCards: undefined,
    };
  }
  if (options) {
    return {
      limit: options.topK,
      uri: options.uri,
      scope: options.scope,
      excludeIds: options.excludeFrameIds,
      excludeUris: options.excludeUris,
      memoryFilters: options.memoryFilters,
      includeCards: options.includeCards,
    };
  }
  return {
    limit: undefined,
    uri: undefined,
    scope: undefined,
    excludeIds: undefined,
    excludeUris: undefined,
    memoryFilters: undefined,
    includeCards: undefined,
  };
}

/**
 * Validate content buffer
 */
function validateContent(content: unknown): Buffer {
  if (Buffer.isBuffer(content)) {
    return content;
  }
  throw new MemvidError('INVALID_INPUT', 'content must be a Buffer');
}

/**
 * Native handle wrapper type
 */
type NativeHandle = ReturnType<typeof native.create>;

/**
 * Memvid class - main interface for working with .mv2 files
 *
 * Thread-safe wrapper around the Rust memvid-core library.
 * All operations are synchronous for simplicity.
 */
export class Memvid {
  private handle: NativeHandle;
  private filePath: string;

  private constructor(handle: NativeHandle, path: string) {
    this.handle = handle;
    this.filePath = path;
  }

  /**
   * Create a new memvid file
   *
   * @param path - Path to the .mv2 file to create
   * @returns A new Memvid instance
   *
   * @example
   * ```typescript
   * const mem = Memvid.create('/tmp/test.mv2');
   * ```
   */
  static create(path: string): Memvid {
    try {
      const handle = native.create(path);
      return new Memvid(handle, path);
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  /**
   * Open an existing memvid file
   *
   * @param path - Path to the .mv2 file to open
   * @returns A Memvid instance for the existing file
   *
   * @example
   * ```typescript
   * const mem = Memvid.open('/tmp/existing.mv2');
   * ```
   */
  static open(path: string): Memvid {
    try {
      const handle = native.open(path);
      return new Memvid(handle, path);
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  /** Get the file path */
  get path(): string {
    return this.filePath;
  }

  /**
   * Check if handle is closed
   */
  get isClosed(): boolean {
    // Native binding exposes this as a method, not a getter
    return (this.handle as any).isClosed();
  }

  /**
   * Close the handle and release resources
   *
   * After closing, all operations on this handle will fail.
   * It's safe to call close() multiple times.
   *
   * @example
   * ```typescript
   * const mem = Memvid.create('/tmp/test.mv2');
   * // ... use mem ...
   * mem.close(); // Release resources
   * ```
   */
  close(): void {
    try {
      this.handle.close();
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  /**
   * Get file statistics
   *
   * @returns Statistics about the memvid file
   */
  stats(): Stats {
    try {
      return this.handle.stats() as Stats;
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  /**
   * Store a document
   *
   * @param content - Document content as a Buffer
   * @param options - Optional metadata (title, uri, kind, labels)
   * @returns The frame ID of the stored document
   *
   * @example
   * ```typescript
   * const frameId = mem.put(Buffer.from('Hello world'), {
   *   title: 'Greeting',
   *   uri: 'doc://greeting/1'
   * });
   * ```
   */
  put(content: Buffer, options?: PutOptions): number {
    const validContent = validateContent(content);
    try {
      return this.handle.put(validContent, options) as number;
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  /**
   * Store a document with a pre-computed embedding
   *
   * Use this when you generate embeddings externally (e.g., via OpenAI API).
   *
   * @param content - Document content as a Buffer
   * @param embedding - Pre-computed embedding vector
   * @param options - Optional metadata
   * @returns The frame ID of the stored document
   *
   * @example
   * ```typescript
   * const embedder = new OpenAIEmbeddings({ apiKey: '...' });
   * const embedding = await embedder.embedQuery('Hello world');
   * const frameId = mem.putWithEmbedding(
   *   Buffer.from('Hello world'),
   *   embedding,
   *   { title: 'Greeting' }
   * );
   * ```
   */
  putWithEmbedding(content: Buffer, embedding: number[], options?: PutOptions): number {
    const validContent = validateContent(content);
    const validEmbedding = validateEmbedding(embedding, 'embedding');
    try {
      return this.handle.putWithEmbedding(validContent, validEmbedding, options) as number;
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  /**
   * Store multiple documents with auto-embedding
   *
   * Convenience method that generates embeddings and stores documents.
   * Handles partial failures gracefully - if some documents fail to store,
   * the method continues with remaining documents and reports results.
   *
   * @param documents - Array of documents with content and options
   * @param embedder - Embedding provider to use (optional)
   * @returns Result object with success/failure details for each document
   *
   * @example
   * ```typescript
   * const result = await mem.putMany(documents, embedder);
   * console.log(`Stored ${result.successCount}/${documents.length} documents`);
   * if (result.failureCount > 0) {
   *   result.results.filter(r => !r.success).forEach(r => {
   *     console.error(`Document ${r.index} failed:`, r.error);
   *   });
   * }
   * ```
   */
  async putMany(
    documents: Array<{ content: string | Buffer; options?: PutOptions }>,
    embedder?: EmbeddingProvider
  ): Promise<PutManyResult> {
    const results: PutManyItemResult[] = [];
    const frameIds: number[] = [];
    let embeddings: number[][] | null = null;

    // Generate embeddings first if embedder is provided
    if (embedder && documents.length > 0) {
      try {
        const texts = documents.map((doc) =>
          typeof doc.content === 'string' ? doc.content : doc.content.toString('utf-8')
        );
        embeddings = await embedder.embedDocuments(texts);
      } catch (error) {
        // If embedding generation fails, mark all documents as failed
        for (let i = 0; i < documents.length; i++) {
          results.push({
            index: i,
            success: false,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
        return {
          results,
          successCount: 0,
          failureCount: documents.length,
          frameIds: [],
        };
      }
    }

    // Store documents one by one, tracking successes and failures
    for (let i = 0; i < documents.length; i++) {
      try {
        const content =
          typeof documents[i].content === 'string'
            ? Buffer.from(documents[i].content)
            : documents[i].content;

        let frameId: number;
        if (embeddings) {
          frameId = this.putWithEmbedding(
            content as Buffer,
            embeddings[i],
            documents[i].options
          );
        } else {
          frameId = this.put(content as Buffer, documents[i].options);
        }

        results.push({
          index: i,
          frameId,
          success: true,
        });
        frameIds.push(frameId);
      } catch (error) {
        results.push({
          index: i,
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }

    return {
      results,
      successCount: frameIds.length,
      failureCount: documents.length - frameIds.length,
      frameIds,
    };
  }

  /**
   * Commit changes to disk
   *
   * Persists all pending changes to the .mv2 file.
   */
  commit(): void {
    try {
      this.handle.commit();
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  /**
   * Search for documents using text search
   *
   * @param query - Search query string
   * @param options - Search options (topK, uri, scope, excludeFrameIds, excludeUris, memoryFilters)
   * @returns Search results with hits and metadata
   *
   * @example
   * ```typescript
   * // Basic search
   * const results = mem.find('artificial intelligence');
   *
   * // With options
   * const filtered = mem.find('AI', {
   *   topK: 5,
   *   scope: 'doc://articles/',
   *   excludeFrameIds: [0, 1],
   * });
   *
   * // With memory filters (filter by entity's memories)
   * const personResults = mem.find('work history', {
   *   topK: 10,
   *   memoryFilters: [{ entity: 'alice', slot: 'employer' }]
   * });
   * ```
   */
  find(query: string, options?: SearchOptions | number): SearchResult {
    if (typeof query !== 'string') {
      throw new MemvidError('INVALID_INPUT', 'query must be a string');
    }

    const { limit, uri, scope, excludeIds, excludeUris, memoryFilters, includeCards } = parseSearchOptions(options);

    try {
      return this.handle.find(query, limit, uri, scope, excludeIds, excludeUris, memoryFilters, includeCards) as SearchResult;
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  /**
   * Ask a question using RAG (Retrieval-Augmented Generation)
   *
   * Retrieves relevant context from the memory and optionally generates an answer.
   * By default, only retrieves context (context_only: true) for use with your own LLM.
   *
   * @param request - Ask request options
   * @returns Ask response with context and optional answer
   *
   * @example
   * ```typescript
   * // Get context for your own LLM
   * const result = mem.ask({
   *   question: 'What is the project about?',
   *   topK: 5
   * });
   * console.log('Context:', result.context);
   *
   * // Use context with your LLM
   * const answer = await myLLM.complete({
   *   prompt: `Given this context:\n${result.context.map(c => c.text).join('\n')}\n\nQuestion: ${result.question}`
   * });
   * ```
   */
  ask(request: AskRequest): AskResponse {
    try {
      return this.handle.ask(request) as AskResponse;
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  /**
   * Search for documents using vector similarity
   *
   * @param queryEmbedding - Query embedding vector
   * @param options - Search options (topK, uri, scope, excludeFrameIds, excludeUris)
   * @returns Search results ranked by similarity
   *
   * @example
   * ```typescript
   * const embedder = new OpenAIEmbeddings({ apiKey: '...' });
   * const queryEmbedding = await embedder.embedQuery('What is AI?');
   *
   * // Basic search
   * const results = mem.vecSearch(queryEmbedding, { topK: 5 });
   *
   * // Exclude specific frames
   * const filtered = mem.vecSearch(queryEmbedding, {
   *   topK: 10,
   *   excludeFrameIds: [0, 1, 2],
   * });
   * ```
   */
  vecSearch(queryEmbedding: number[], options?: SearchOptions | number): SearchResult {
    const validEmbedding = validateEmbedding(queryEmbedding, 'queryEmbedding');
    const { limit, uri, scope, excludeIds, excludeUris, memoryFilters, includeCards } =
      parseSearchOptions(options);

    try {
      return this.handle.vecSearch(
        validEmbedding,
        limit,
        uri,
        scope,
        excludeIds,
        excludeUris,
        memoryFilters,
        includeCards,
      ) as SearchResult;
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  /**
   * Enable lexical (text) search index
   *
   * Must be called before using find() for text search.
   */
  enableLex(): void {
    try {
      this.handle.enableLex();
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  /**
   * Enable vector (embedding) search index
   *
   * Must be called before using vecSearch() or putWithEmbedding().
   * Note: Requires the 'vec' feature in memvid-core.
   */
  enableVec(): void {
    try {
      this.handle.enableVec();
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  // ==========================================================================
  // CLIP Visual Search
  // ==========================================================================

  /**
   * Enable CLIP visual embeddings index.
   *
   * CLIP allows semantic search across images using natural language queries.
   * Unlike text vec embeddings (384/768/1536 dims), CLIP embeddings have
   * fixed 512 dimensions (MobileCLIP-S2) and are stored in a separate index.
   *
   * Must be called before using addClipEmbedding() or clipSearch().
   *
   * @example
   * ```typescript
   * const mem = create('/tmp/visual.mv2');
   * mem.enableClip();
   *
   * // Add image with CLIP embedding
   * const frameId = mem.put(imageBuffer, { title: 'Cat photo' });
   * mem.addClipEmbedding(frameId, clipEmbedding);
   * mem.commit();
   *
   * // Search by text
   * const hits = mem.clipSearch(textQueryEmbedding);
   * ```
   */
  enableClip(): void {
    try {
      this.handle.enableClip();
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  /**
   * Add a CLIP embedding for a frame.
   *
   * This adds the visual embedding to the CLIP index for later semantic search.
   * The frame must already exist. Generate embeddings using an external CLIP model
   * (e.g., via Transformers.js, ONNX runtime, or a CLIP API).
   *
   * @param frameId - The frame ID to attach the embedding to
   * @param embedding - The CLIP embedding vector (typically 512 dimensions for MobileCLIP-S2)
   *
   * @example
   * ```typescript
   * // Store an image
   * const frameId = mem.put(imageBuffer, { title: 'Beach sunset' });
   *
   * // Generate CLIP embedding externally (e.g., with Transformers.js)
   * const embedding = await clipModel.encode(imageBuffer);
   *
   * // Add to CLIP index
   * mem.addClipEmbedding(frameId, embedding);
   * ```
   */
  addClipEmbedding(frameId: number, embedding: number[]): void {
    const validEmbedding = validateEmbedding(embedding, 'embedding');
    try {
      this.handle.addClipEmbedding(frameId, validEmbedding);
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  /**
   * Add a CLIP embedding for a frame with page number.
   *
   * This adds the visual embedding to the CLIP index with page information.
   * Useful for PDF pages where you want to track the source page.
   *
   * @param frameId - The frame ID to attach the embedding to
   * @param page - The page number (1-indexed)
   * @param embedding - The CLIP embedding vector
   *
   * @example
   * ```typescript
   * // Process a PDF document
   * const pdfFrameId = mem.putDocument(pdfBuffer, 'report.pdf');
   *
   * // Generate CLIP embeddings for each page image
   * for (let page = 1; page <= pageCount; page++) {
   *   const pageImage = renderPdfPage(pdfBuffer, page);
   *   const embedding = await clipModel.encode(pageImage);
   *   mem.addClipEmbeddingWithPage(pdfFrameId, page, embedding);
   * }
   * ```
   */
  addClipEmbeddingWithPage(frameId: number, page: number, embedding: number[]): void {
    const validEmbedding = validateEmbedding(embedding, 'embedding');
    try {
      this.handle.addClipEmbeddingWithPage(frameId, page, validEmbedding);
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  /**
   * Search CLIP index with a pre-computed query embedding.
   *
   * Use an external CLIP model to generate the query embedding from text or image bytes.
   * Returns hits sorted by distance (lower is more similar).
   *
   * @param queryEmbedding - The query embedding (from CLIP text or image encoder)
   * @param options - Search options (topK, memoryFilters) or just a number for topK
   * @returns Array of CLIP search hits with frame IDs, optional page numbers, and distances
   *
   * @example
   * ```typescript
   * // Search by text description
   * const textEmbedding = await clipModel.encodeText('a photo of a sunset');
   * const hits = mem.clipSearch(textEmbedding, { topK: 5 });
   *
   * for (const hit of hits) {
   *   console.log(`Frame ${hit.frameId}${hit.page ? ` page ${hit.page}` : ''}: distance ${hit.distance}`);
   * }
   *
   * // Search with memory filters
   * const hits = mem.clipSearch(textEmbedding, {
   *   topK: 10,
   *   memoryFilters: [{ slot: 'cat:verification' }]
   * });
   *
   * // Legacy: pass just a number for topK
   * const similar = mem.clipSearch(imageEmbedding, 10);
   * ```
   */
  clipSearch(queryEmbedding: number[], options?: ClipSearchOptions | number): ClipSearchHit[] {
    const validEmbedding = validateEmbedding(queryEmbedding, 'queryEmbedding');

    // Parse options - support legacy number for backwards compatibility
    const parsedOptions: ClipSearchOptions =
      typeof options === 'number'
        ? { topK: options }
        : options || {};

    try {
      return this.handle.clipSearch(validEmbedding, parsedOptions) as ClipSearchHit[];
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  /**
   * Hybrid search using both text query and vector embedding.
   *
   * Performs vector similarity search using the pre-computed embedding.
   * The query string is used for snippet generation and ranking.
   * Requires vec index to be enabled.
   *
   * @param query - Text query for lexical matching and snippet generation
   * @param queryEmbedding - Pre-computed embedding vector (384-1536 dimensions)
   * @param options - Search options including topK, memoryFilters, includeCards
   * @returns Search results with hits
   *
   * @example
   * ```typescript
   * const embedding = await embedder.embedQuery('machine learning');
   * const results = mem.hybridSearch('machine learning', embedding, {
   *   topK: 10,
   *   memoryFilters: [{ slot: 'category', valueContains: 'tech' }],
   *   includeCards: true
   * });
   * ```
   */
  hybridSearch(
    query: string,
    queryEmbedding: number[],
    options?: HybridSearchOptions & { topK?: number }
  ): SearchResult {
    const validEmbedding = validateEmbedding(queryEmbedding, 'queryEmbedding');
    const topK = options?.topK ?? 10;

    try {
      return this.handle.hybridSearch(query, validEmbedding, topK, options) as SearchResult;
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  /**
   * Graph search combining memory cards with vector/lexical search.
   *
   * Uses QueryPlanner to analyze the query and determine the best execution strategy:
   * - For simple queries: vector-only search (falls back to lexical)
   * - For queries referencing entities: hybrid search combining memory cards and lexical search
   *
   * @param query - Natural language query (can include entity references)
   * @param options - Search options including topK, memoryFilters, includeCards
   * @returns Graph search results with hits and execution plan info
   *
   * @example
   * ```typescript
   * // Simple query
   * const results = mem.graphSearch('machine learning algorithms');
   *
   * // Query with entity reference (triggers graph matching)
   * const results = mem.graphSearch('where does Alice work?', {
   *   topK: 5,
   *   includeCards: true
   * });
   *
   * // With memory filters
   * const results = mem.graphSearch('projects', {
   *   memoryFilters: [{ entity: 'user' }]
   * });
   * ```
   */
  graphSearch(query: string, options?: GraphSearchOptions): GraphSearchResult {
    try {
      return this.handle.graphSearch(query, options) as GraphSearchResult;
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  /**
   * Get timeline entries (chronological view of frames)
   *
   * @param options - Timeline query options
   * @returns Array of timeline entries
   *
   * @example
   * ```typescript
   * const entries = mem.timeline({ limit: 10, reverse: true });
   * for (const entry of entries) {
   *   console.log(entry.timestamp, entry.preview);
   * }
   * ```
   */
  timeline(options?: TimelineOptions): TimelineEntry[] {
    try {
      return this.handle.timeline(options) as TimelineEntry[];
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  /**
   * Get frame content by ID
   *
   * @param frameId - The frame ID to retrieve
   * @returns The frame's text content
   */
  view(frameId: number): string {
    try {
      return this.handle.view(frameId) as string;
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  /**
   * Get frame metadata by ID
   *
   * @param frameId - The frame ID to retrieve
   * @returns Frame metadata (id, timestamp, uri, title, kind, payloadLength)
   */
  frame(frameId: number): FrameInfo {
    try {
      return this.handle.frame(frameId) as FrameInfo;
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  /**
   * Delete a frame (soft delete)
   *
   * @param frameId - The frame ID to delete
   * @returns The deleted frame's ID
   */
  delete(frameId: number): number {
    try {
      return this.handle.delete(frameId) as number;
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  /**
   * Verify file integrity
   *
   * @param deep - Perform deep verification (default: false)
   * @returns true if file is valid, false otherwise
   */
  verify(deep?: boolean): boolean {
    try {
      return this.handle.verify(deep) as boolean;
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  // ==========================================================================
  // Optimization Operations
  // ==========================================================================

  /**
   * Vacuum the file to reclaim space from deleted frames
   *
   * This operation:
   * - Commits any pending changes
   * - Removes deleted frames and their payloads
   * - Rebuilds indexes with only active frames
   *
   * @returns Statistics about the vacuum operation
   *
   * @example
   * ```typescript
   * // Delete some frames
   * mem.delete(frameId1);
   * mem.delete(frameId2);
   * mem.commit();
   *
   * // Reclaim space
   * const result = mem.vacuum();
   * console.log(`Reclaimed ${result.bytesReclaimed} bytes`);
   * console.log(`Retained ${result.framesRetained} active frames`);
   * ```
   */
  vacuum(): VacuumResult {
    try {
      return this.handle.vacuum() as VacuumResult;
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  /**
   * Compact the write-ahead log
   *
   * This operation commits pending changes and compacts the WAL.
   * In memvid, the WAL is embedded in the file with a fixed size,
   * so compaction just commits pending changes.
   *
   * @returns Statistics about the compaction operation
   *
   * @example
   * ```typescript
   * // Add some documents
   * mem.put(Buffer.from('Document 1'));
   * mem.put(Buffer.from('Document 2'));
   *
   * // Compact WAL (commits and clears pending)
   * const result = mem.compactWal();
   * console.log(`Pending after: ${result.pendingAfter}`); // 0
   * ```
   */
  compactWal(): CompactWalResult {
    try {
      return this.handle.compactWal() as CompactWalResult;
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  /**
   * Preview how a document would be chunked without storing it
   *
   * Returns null if the document is too small to be chunked (< 2400 chars after normalization).
   * Use this to generate embeddings for each chunk before calling putWithChunkEmbeddings().
   *
   * @param content - Document content as a Buffer
   * @returns Array of chunk strings, or null if document is too small to chunk
   *
   * @example
   * ```typescript
   * const chunks = mem.previewChunks(largeDocument);
   * if (chunks) {
   *   // Generate embeddings for each chunk
   *   const chunkEmbeddings = await Promise.all(
   *     chunks.map(async (text) => ({
   *       text,
   *       embedding: await embedder.embedQuery(text),
   *     }))
   *   );
   *   mem.putWithChunkEmbeddings(largeDocument, undefined, chunkEmbeddings);
   * } else {
   *   // Document is small, use regular put
   *   mem.put(largeDocument);
   * }
   * ```
   */
  previewChunks(content: Buffer): string[] | null {
    const validContent = validateContent(content);
    try {
      return this.handle.previewChunks(validContent) as string[] | null;
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  /**
   * Store a document with pre-computed chunk embeddings
   *
   * Use this when you generate embeddings externally for each chunk.
   * Call previewChunks() first to get the chunks, then generate embeddings
   * for each chunk, then call this method.
   *
   * @param content - Document content as a Buffer
   * @param parentEmbedding - Optional parent document embedding
   * @param chunkEmbeddings - Array of chunk embeddings (with optional text)
   * @param options - Optional metadata (title, uri, kind, labels)
   * @returns The frame ID of the stored document
   *
   * @example
   * ```typescript
   * const chunks = mem.previewChunks(content);
   * if (chunks) {
   *   const chunkEmbeddings = await Promise.all(
   *     chunks.map(async (text) => ({
   *       text,
   *       embedding: await embedder.embedQuery(text),
   *     }))
   *   );
   *   const frameId = mem.putWithChunkEmbeddings(content, undefined, chunkEmbeddings, {
   *     title: 'Large Document',
   *   });
   *   mem.commit();
   * }
   * ```
   */
  putWithChunkEmbeddings(
    content: Buffer,
    parentEmbedding: number[] | undefined,
    chunkEmbeddings: ChunkEmbedding[],
    options?: PutOptions
  ): number {
    const validContent = validateContent(content);

    // Validate parent embedding if provided
    if (parentEmbedding !== undefined) {
      validateEmbedding(parentEmbedding, 'parentEmbedding');
    }

    // Validate chunk embeddings
    for (let i = 0; i < chunkEmbeddings.length; i++) {
      validateEmbedding(chunkEmbeddings[i].embedding, `chunkEmbeddings[${i}].embedding`);
    }

    try {
      return this.handle.putWithChunkEmbeddings(
        validContent,
        parentEmbedding,
        chunkEmbeddings,
        options
      ) as number;
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  // ==========================================================================
  // Enrichment Pipeline
  // ==========================================================================

  /**
   * Get enrichment statistics
   *
   * Returns statistics about the enrichment state of frames:
   * - totalFrames: Total active frames
   * - enrichedFrames: Frames that have been fully enriched
   * - pendingFrames: Frames in the enrichment queue
   * - skimmedFrames: Frames that are searchable but not enriched
   *
   * @returns Enrichment statistics
   *
   * @example
   * ```typescript
   * const stats = mem.enrichmentStats();
   * console.log(`Enriched: ${stats.enrichedFrames}/${stats.totalFrames}`);
   * ```
   */
  enrichmentStats(): EnrichmentStats {
    try {
      const result = this.handle.enrichmentStats();
      return {
        totalFrames: result.totalFrames,
        enrichedFrames: result.enrichedFrames,
        pendingFrames: result.pendingFrames,
        skimmedFrames: result.skimmedFrames,
      };
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  /**
   * Get the enrichment queue
   *
   * Returns all pending enrichment tasks.
   *
   * @returns Array of enrichment tasks
   *
   * @example
   * ```typescript
   * const queue = mem.enrichmentQueue();
   * console.log(`${queue.length} frames pending enrichment`);
   * ```
   */
  enrichmentQueue(): EnrichmentTask[] {
    try {
      const tasks = this.handle.enrichmentQueue();
      return tasks.map((task: any) => ({
        frameId: task.frameId,
        createdAt: task.createdAt,
        chunksDone: task.chunksDone,
        chunksTotal: task.chunksTotal,
      }));
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  /**
   * Get the length of the enrichment queue
   *
   * @returns Number of pending enrichment tasks
   *
   * @example
   * ```typescript
   * if (mem.enrichmentQueueLength() > 0) {
   *   mem.processAllEnrichment();
   * }
   * ```
   */
  enrichmentQueueLength(): number {
    try {
      return this.handle.enrichmentQueueLen() as number;
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  /**
   * Check if there are pending enrichment tasks
   *
   * @returns true if there are pending tasks, false otherwise
   *
   * @example
   * ```typescript
   * while (mem.hasPendingEnrichment()) {
   *   mem.processEnrichmentBatch(10);
   * }
   * ```
   */
  hasPendingEnrichment(): boolean {
    try {
      return this.handle.hasPendingEnrichment() as boolean;
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  /**
   * Process all pending enrichment tasks
   *
   * Processes all frames in the enrichment queue:
   * - Re-extracts full text for skim frames
   * - Updates search indexes with enriched content
   * - Marks frames as enriched when complete
   *
   * @returns Number of tasks processed
   *
   * @example
   * ```typescript
   * const count = mem.processAllEnrichment();
   * console.log(`Processed ${count} enrichment tasks`);
   * ```
   */
  processAllEnrichment(): number {
    try {
      return this.handle.processAllEnrichment() as number;
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  /**
   * Process a batch of enrichment tasks
   *
   * Processes up to batchSize tasks from the enrichment queue.
   *
   * @param batchSize - Maximum number of tasks to process
   * @returns Result with details about what was processed
   *
   * @example
   * ```typescript
   * const result = mem.processEnrichmentBatch(10);
   * console.log(`Processed ${result.tasksProcessed} tasks`);
   * if (result.errors.length > 0) {
   *   console.error('Errors:', result.errors);
   * }
   * ```
   */
  processEnrichmentBatch(batchSize: number): ProcessBatchResult {
    // Validate batchSize
    if (!Number.isInteger(batchSize)) {
      throw new MemvidError('INVALID_INPUT', 'batchSize must be an integer');
    }
    if (batchSize < 0) {
      throw new MemvidError('INVALID_INPUT', 'batchSize must be non-negative');
    }

    try {
      const result = this.handle.processEnrichmentBatch(batchSize);
      return {
        tasksProcessed: result.tasksProcessed,
        tasksSucceeded: result.tasksSucceeded,
        tasksFailed: result.tasksFailed,
        enrichedFrameIds: result.enrichedFrameIds,
        errors: result.errors,
      };
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  /**
   * Mark a specific frame as enriched
   *
   * Updates the frame's enrichment state to indicate it has been fully processed.
   * This is useful for manual enrichment workflows.
   *
   * @param frameId - The frame ID to mark as enriched
   *
   * @example
   * ```typescript
   * mem.markFrameEnriched(frameId);
   * ```
   */
  markFrameEnriched(frameId: number): void {
    try {
      this.handle.markFrameEnriched(frameId);
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }

  /**
   * Get all entities that have a specific slot
   *
   * Useful for pre-filtering search by slot presence.
   * Returns a sorted list of unique entity names.
   *
   * @param slot - The slot/attribute to search for
   * @param value - Optional value to filter by (exact match)
   * @returns Array of entity names that have the specified slot
   *
   * @example
   * ```typescript
   * // Get all entities with a 'verification' slot
   * const entities = mem.getEntitiesBySlot('cat:verification');
   * // Returns: ['thread:123', 'thread:456', ...]
   *
   * // Get entities with a specific slot value
   * const learnable = mem.getEntitiesBySlot('learnable', '1');
   * ```
   */
  getEntitiesBySlot(slot: string, value?: string): string[] {
    try {
      return this.handle.getEntitiesBySlot(slot, value) as string[];
    } catch (error) {
      throw parseNapiError(error as Error);
    }
  }
}

/**
 * Create a new memvid file
 *
 * Convenience function that wraps Memvid.create()
 *
 * @param path - Path to the .mv2 file to create
 * @returns A new Memvid instance
 */
export function create(path: string): Memvid {
  return Memvid.create(path);
}

/**
 * Open an existing memvid file
 *
 * Convenience function that wraps Memvid.open()
 *
 * @param path - Path to the .mv2 file to open
 * @returns A Memvid instance for the existing file
 */
export function open(path: string): Memvid {
  return Memvid.open(path);
}

/**
 * Get the version of memvid-node
 *
 * @returns Version string
 */
export function version(): string {
  return native.version();
}

/**
 * Encrypt a memvid file with a password.
 * Creates an encrypted copy with .mv2e extension.
 *
 * @param path - Path to the .mv2 file to encrypt
 * @param password - Password for encryption (must not be empty)
 * @returns Path to the encrypted file (.mv2e)
 *
 * @example
 * ```typescript
 * const encryptedPath = lock('./data.mv2', 'my-secure-password');
 * console.log('Encrypted file:', encryptedPath); // './data.mv2e'
 * ```
 */
export function lock(path: string, password: string): string {
  try {
    return native.lock(path, password);
  } catch (error) {
    throw parseNapiError(error as Error);
  }
}

/**
 * Decrypt an encrypted memvid file.
 * Creates a decrypted copy with .mv2 extension.
 *
 * @param path - Path to the .mv2e file to decrypt
 * @param password - Password used for encryption
 * @returns Path to the decrypted file (.mv2)
 *
 * @example
 * ```typescript
 * const decryptedPath = unlock('./data.mv2e', 'my-secure-password');
 * console.log('Decrypted file:', decryptedPath); // './data.mv2'
 * ```
 */
export function unlock(path: string, password: string): string {
  try {
    return native.unlock(path, password);
  } catch (error) {
    throw parseNapiError(error as Error);
  }
}

/**
 * Result from running the doctor diagnostic/repair tool
 */
export interface DoctorResult {
  /** Number of issues found during diagnosis */
  issuesFound: number;
  /** Number of issues fixed during repair (0 if fix=false) */
  issuesFixed: number;
  /** Descriptions of actions taken */
  actions: string[];
}

/**
 * Run diagnostic checks on a memvid file and optionally repair issues.
 *
 * @param path - Path to the .mv2 file to check
 * @param fix - If true, attempt to repair issues found (default: false)
 * @returns Diagnostic results
 *
 * @example
 * ```typescript
 * // Diagnosis only (read-only)
 * const result = doctor('./data.mv2');
 * if (result.issuesFound > 0) {
 *   console.log('Issues found:', result.issuesFound);
 *   console.log('Actions:', result.actions);
 * }
 *
 * // Diagnosis with repair
 * const repairResult = doctor('./data.mv2', true);
 * console.log('Issues fixed:', repairResult.issuesFixed);
 * ```
 */
export function doctor(path: string, fix?: boolean): DoctorResult {
  try {
    return native.doctor(path, fix);
  } catch (error) {
    throw parseNapiError(error as Error);
  }
}

/**
 * Mask PII (Personally Identifiable Information) in text.
 *
 * Detects and replaces common PII patterns with placeholder tokens:
 * - Email addresses → `[EMAIL]`
 * - US Social Security Numbers → `[SSN]`
 * - Phone numbers (various formats) → `[PHONE]`
 * - Credit card numbers → `[CREDIT_CARD]`
 * - IPv4 addresses → `[IP_ADDRESS]`
 * - API keys/tokens (common patterns) → `[API_KEY]`
 *
 * The original data in the .mv2 file remains unchanged and fully searchable.
 * This is useful for sanitizing text before sending to LLMs or external services.
 *
 * @param text - The text to mask
 * @returns Text with PII replaced by placeholders
 *
 * @example
 * ```typescript
 * const masked = maskPii('Contact john@example.com or call 555-123-4567');
 * // "Contact [EMAIL] or call [PHONE]"
 * ```
 */
export function maskPii(text: string): string {
  return native.maskPii(text);
}

/**
 * Check if text contains any detectable PII.
 *
 * @param text - The text to check
 * @returns true if any PII pattern is found, false otherwise
 *
 * @example
 * ```typescript
 * if (containsPii(userInput)) {
 *   const safe = maskPii(userInput);
 *   // send safe version to LLM
 * }
 * ```
 */
export function containsPii(text: string): boolean {
  return native.containsPii(text);
}

// ============================================================================
// Whisper Audio Transcription
// ============================================================================

import type { TranscriptionResult, WhisperOptions } from './types';

/**
 * Handle to a Whisper transcriber model.
 *
 * Use this when you need to transcribe multiple audio files efficiently.
 * The model is loaded once and reused for all transcriptions.
 *
 * Note: Whisper features require the "whisper" feature flag to be enabled
 * when building the native module. Without it, these functions will throw.
 *
 * @example
 * ```typescript
 * const whisper = createWhisper();
 * const result1 = whisper.transcribe('./audio1.mp3');
 * const result2 = whisper.transcribe('./audio2.wav');
 * console.log(result1.text);
 * ```
 */
export interface WhisperHandle {
  /**
   * Transcribe an audio file.
   *
   * Supports MP3, WAV, FLAC, OGG, and other common audio formats.
   * Audio is automatically resampled to 16kHz mono.
   *
   * @param path - Path to the audio file
   * @returns Transcription result with text, segments, and duration
   */
  transcribe(path: string): TranscriptionResult;

  /**
   * Transcribe audio from a buffer.
   *
   * The buffer should contain audio data in a supported format
   * (MP3, WAV, FLAC, OGG, etc.). Audio is automatically decoded
   * and resampled to 16kHz mono.
   *
   * @param buffer - Audio data buffer
   * @returns Transcription result with text, segments, and duration
   */
  transcribeBuffer(buffer: Buffer): TranscriptionResult;
}

/**
 * Create a new Whisper transcriber.
 *
 * Downloads and loads the Whisper model. This may take some time on first run
 * as the model needs to be downloaded from HuggingFace Hub (~500MB for small models).
 *
 * Note: Requires the "whisper" feature flag to be enabled when building.
 * If not enabled, this function will throw an error.
 *
 * @param options - Optional configuration (model name, models directory, offline mode)
 * @returns A WhisperHandle for transcribing audio
 *
 * @example
 * ```typescript
 * // Default model (whisper-small-en)
 * const whisper = createWhisper();
 *
 * // Custom model
 * const whisperMultilang = createWhisper({
 *   modelName: 'whisper-small',  // Multilingual model
 *   modelsDir: '/custom/models/path',
 * });
 * ```
 */
export function createWhisper(options?: WhisperOptions): WhisperHandle {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nativeAny = native as any;
    if (typeof nativeAny.createWhisper !== 'function') {
      throw new MemvidError(
        'WHISPER_NOT_AVAILABLE',
        'Whisper features are not available. The native module was built without the "whisper" feature flag.'
      );
    }
    return nativeAny.createWhisper(options) as WhisperHandle;
  } catch (error) {
    throw parseNapiError(error as Error);
  }
}

/**
 * Transcribe an audio file directly (one-shot).
 *
 * This is a convenience function that creates a Whisper transcriber,
 * transcribes the audio, and discards the model. For multiple transcriptions,
 * use `createWhisper()` to reuse the model and avoid repeated loading.
 *
 * Note: Requires the "whisper" feature flag to be enabled when building.
 *
 * @param path - Path to the audio file (MP3, WAV, FLAC, OGG, etc.)
 * @param options - Optional Whisper configuration
 * @returns Transcription result with text, segments, and duration
 *
 * @example
 * ```typescript
 * const result = transcribeAudio('./meeting.mp3');
 * console.log('Transcription:', result.text);
 * console.log('Duration:', result.durationSecs, 'seconds');
 *
 * // With timestamps
 * for (const segment of result.segments) {
 *   console.log(`[${segment.start}s - ${segment.end}s]: ${segment.text}`);
 * }
 * ```
 */
export function transcribeAudio(path: string, options?: WhisperOptions): TranscriptionResult {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nativeAny = native as any;
    if (typeof nativeAny.transcribeAudio !== 'function') {
      throw new MemvidError(
        'WHISPER_NOT_AVAILABLE',
        'Whisper features are not available. The native module was built without the "whisper" feature flag.'
      );
    }
    return nativeAny.transcribeAudio(path, options) as TranscriptionResult;
  } catch (error) {
    throw parseNapiError(error as Error);
  }
}

/**
 * Transcribe audio from a buffer directly (one-shot).
 *
 * This is a convenience function that creates a Whisper transcriber,
 * transcribes the audio buffer, and discards the model.
 *
 * Note: Requires the "whisper" feature flag to be enabled when building.
 *
 * @param buffer - Audio data buffer (MP3, WAV, FLAC, OGG, etc.)
 * @param options - Optional Whisper configuration
 * @returns Transcription result with text, segments, and duration
 *
 * @example
 * ```typescript
 * import * as fs from 'fs';
 *
 * const audioData = fs.readFileSync('./recording.mp3');
 * const result = transcribeAudioBuffer(audioData);
 * console.log('Transcription:', result.text);
 * ```
 */
export function transcribeAudioBuffer(buffer: Buffer, options?: WhisperOptions): TranscriptionResult {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nativeAny = native as any;
    if (typeof nativeAny.transcribeAudioBuffer !== 'function') {
      throw new MemvidError(
        'WHISPER_NOT_AVAILABLE',
        'Whisper features are not available. The native module was built without the "whisper" feature flag.'
      );
    }
    return nativeAny.transcribeAudioBuffer(buffer, options) as TranscriptionResult;
  } catch (error) {
    throw parseNapiError(error as Error);
  }
}
