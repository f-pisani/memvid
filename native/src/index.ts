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
} from './types';
import { parseNapiError, VecDimensionMismatchError, MemvidError } from './error';

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
      return this.handle.put(validContent, options ?? undefined) as number;
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
      return this.handle.putWithEmbedding(validContent, validEmbedding, options ?? undefined) as number;
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
   * @param options - Search options (topK, uri, scope, excludeFrameIds, excludeUris)
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
   * ```
   */
  find(query: string, options?: SearchOptions | number): SearchResult {
    if (typeof query !== 'string') {
      throw new MemvidError('INVALID_INPUT', 'query must be a string');
    }

    // Support both old signature (query, topK) and new signature (query, options)
    let limit: number | undefined;
    let uri: string | undefined;
    let scope: string | undefined;
    let excludeIds: number[] | undefined;
    let excludeUris: string[] | undefined;

    if (typeof options === 'number') {
      // Old signature: find(query, topK)
      limit = options;
    } else if (options) {
      // New signature: find(query, options)
      limit = options.topK;
      uri = options.uri;
      scope = options.scope;
      excludeIds = options.excludeFrameIds;
      excludeUris = options.excludeUris;
    }

    try {
      // Call native function with individual parameters
      return this.handle.find(query, limit, uri, scope, excludeIds, excludeUris) as SearchResult;
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

    // Support both old signature (embedding, topK) and new signature (embedding, options)
    let limit: number | undefined;
    let uri: string | undefined;
    let scope: string | undefined;
    let excludeIds: number[] | undefined;
    let excludeUris: string[] | undefined;

    if (typeof options === 'number') {
      // Old signature: vecSearch(embedding, topK)
      limit = options;
    } else if (options) {
      // New signature: vecSearch(embedding, options)
      limit = options.topK;
      uri = options.uri;
      scope = options.scope;
      excludeIds = options.excludeFrameIds;
      excludeUris = options.excludeUris;
    }

    try {
      // Call native function with individual parameters
      return this.handle.vecSearch(validEmbedding, limit, uri, scope, excludeIds, excludeUris) as SearchResult;
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
      return this.handle.timeline(options ?? undefined) as TimelineEntry[];
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
      return this.handle.verify(deep ?? undefined) as boolean;
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
