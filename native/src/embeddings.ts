/**
 * Embedding providers for memvid-node
 *
 * These providers generate vector embeddings from text using various AI services.
 * All providers implement the EmbeddingProvider interface.
 */

import type {
  EmbeddingProvider,
  OpenAIEmbeddingsConfig,
  CohereEmbeddingsConfig,
  VoyageEmbeddingsConfig,
} from './types';
import { EmbeddingError } from './error';

/** Default timeout for API requests (30 seconds) */
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Validate baseUrl to prevent URL injection attacks
 *
 * Ensures the URL:
 * - Is a valid URL
 * - Uses https (or http for localhost)
 * - Does not contain query strings or fragments
 */
function validateBaseUrl(baseUrl: string, providerName: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new EmbeddingError(providerName, `Invalid baseUrl: ${baseUrl}`);
  }

  // Only allow https, or http for localhost (testing)
  const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalhost)) {
    throw new EmbeddingError(
      providerName,
      `baseUrl must use HTTPS (got ${parsed.protocol})`
    );
  }

  // Reject URLs with query strings or fragments (could be used for injection)
  if (parsed.search || parsed.hash) {
    throw new EmbeddingError(
      providerName,
      'baseUrl cannot contain query string or fragment'
    );
  }

  // Return normalized URL without trailing slash
  return parsed.origin + parsed.pathname.replace(/\/$/, '');
}

/**
 * Fetch with timeout support
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/** Model dimensions for common embedding models */
const MODEL_DIMENSIONS: Record<string, number> = {
  // OpenAI
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
  // Cohere
  'embed-english-v3.0': 1024,
  'embed-multilingual-v3.0': 1024,
  'embed-english-light-v3.0': 384,
  'embed-multilingual-light-v3.0': 384,
  // Voyage
  'voyage-2': 1024,
  'voyage-large-2': 1536,
  'voyage-code-2': 1536,
};

/**
 * OpenAI Embeddings Provider
 *
 * Generates embeddings using OpenAI's text-embedding models.
 *
 * @example
 * ```typescript
 * const embedder = new OpenAIEmbeddings({
 *   apiKey: process.env.OPENAI_API_KEY!,
 *   model: 'text-embedding-3-small'
 * });
 * const embedding = await embedder.embedQuery('Hello world');
 * ```
 */
export class OpenAIEmbeddings implements EmbeddingProvider {
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private timeoutMs: number;
  dimension: number;

  constructor(config: OpenAIEmbeddingsConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'text-embedding-3-small';
    this.baseUrl = validateBaseUrl(
      config.baseUrl ?? 'https://api.openai.com/v1',
      'OpenAI'
    );
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.dimension = MODEL_DIMENSIONS[this.model] ?? 1536;
  }

  async embedQuery(text: string): Promise<number[]> {
    const embeddings = await this.embedDocuments([text]);
    return embeddings[0];
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    // Handle empty input - avoid unnecessary API call
    if (texts.length === 0) {
      return [];
    }

    const response = await fetchWithTimeout(
      `${this.baseUrl}/embeddings`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          input: texts,
        }),
      },
      this.timeoutMs
    );

    if (!response.ok) {
      // Sanitize error - don't expose full response which may contain sensitive data
      let errorMessage = `HTTP ${response.status}`;
      try {
        const errorData = await response.json() as { error?: { message?: string } };
        if (errorData.error?.message) {
          errorMessage = errorData.error.message;
        }
      } catch {
        // Ignore JSON parse errors, use status code only
      }
      throw new EmbeddingError('OpenAI', errorMessage);
    }

    const data = await response.json() as {
      data?: Array<{ embedding?: number[]; index?: number }>;
    };

    // Validate response structure
    if (!data || !Array.isArray(data.data)) {
      throw new EmbeddingError('OpenAI', 'Invalid response: missing data array');
    }

    // Validate each embedding item
    for (let i = 0; i < data.data.length; i++) {
      const item = data.data[i];
      if (typeof item.index !== 'number') {
        throw new EmbeddingError('OpenAI', `Invalid response: item ${i} missing index`);
      }
      if (!Array.isArray(item.embedding)) {
        throw new EmbeddingError('OpenAI', `Invalid response: item ${i} missing embedding array`);
      }
    }

    // Sort by index and return embeddings
    return data.data
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((item) => item.embedding!);
  }
}

/**
 * Cohere Embeddings Provider
 *
 * Generates embeddings using Cohere's embed models.
 *
 * @example
 * ```typescript
 * const embedder = new CohereEmbeddings({
 *   apiKey: process.env.COHERE_API_KEY!,
 *   model: 'embed-english-v3.0'
 * });
 * const embedding = await embedder.embedQuery('Hello world');
 * ```
 */
export class CohereEmbeddings implements EmbeddingProvider {
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private timeoutMs: number;
  dimension: number;

  constructor(config: CohereEmbeddingsConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'embed-english-v3.0';
    this.baseUrl = validateBaseUrl(
      config.baseUrl ?? 'https://api.cohere.ai/v1',
      'Cohere'
    );
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.dimension = MODEL_DIMENSIONS[this.model] ?? 1024;
  }

  async embedQuery(text: string): Promise<number[]> {
    const embeddings = await this.embedDocuments([text]);
    return embeddings[0];
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    // Handle empty input - avoid unnecessary API call
    if (texts.length === 0) {
      return [];
    }

    const response = await fetchWithTimeout(
      `${this.baseUrl}/embed`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          texts,
          input_type: 'search_document',
        }),
      },
      this.timeoutMs
    );

    if (!response.ok) {
      // Sanitize error - don't expose full response which may contain sensitive data
      let errorMessage = `HTTP ${response.status}`;
      try {
        const errorData = await response.json() as { message?: string };
        if (errorData.message) {
          errorMessage = errorData.message;
        }
      } catch {
        // Ignore JSON parse errors, use status code only
      }
      throw new EmbeddingError('Cohere', errorMessage);
    }

    const data = await response.json() as {
      embeddings?: number[][];
    };

    // Validate response structure
    if (!data || !Array.isArray(data.embeddings)) {
      throw new EmbeddingError('Cohere', 'Invalid response: missing embeddings array');
    }

    // Validate each embedding is an array
    for (let i = 0; i < data.embeddings.length; i++) {
      if (!Array.isArray(data.embeddings[i])) {
        throw new EmbeddingError('Cohere', `Invalid response: embedding ${i} is not an array`);
      }
    }

    return data.embeddings;
  }
}

/**
 * Voyage Embeddings Provider
 *
 * Generates embeddings using Voyage AI's models.
 *
 * @example
 * ```typescript
 * const embedder = new VoyageEmbeddings({
 *   apiKey: process.env.VOYAGE_API_KEY!,
 *   model: 'voyage-2'
 * });
 * const embedding = await embedder.embedQuery('Hello world');
 * ```
 */
export class VoyageEmbeddings implements EmbeddingProvider {
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private timeoutMs: number;
  dimension: number;

  constructor(config: VoyageEmbeddingsConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'voyage-2';
    this.baseUrl = validateBaseUrl(
      config.baseUrl ?? 'https://api.voyageai.com/v1',
      'Voyage'
    );
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.dimension = MODEL_DIMENSIONS[this.model] ?? 1024;
  }

  async embedQuery(text: string): Promise<number[]> {
    const embeddings = await this.embedDocuments([text]);
    return embeddings[0];
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    // Handle empty input - avoid unnecessary API call
    if (texts.length === 0) {
      return [];
    }

    const response = await fetchWithTimeout(
      `${this.baseUrl}/embeddings`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          input: texts,
        }),
      },
      this.timeoutMs
    );

    if (!response.ok) {
      // Sanitize error - don't expose full response which may contain sensitive data
      let errorMessage = `HTTP ${response.status}`;
      try {
        const errorData = await response.json() as { detail?: string };
        if (errorData.detail) {
          errorMessage = errorData.detail;
        }
      } catch {
        // Ignore JSON parse errors, use status code only
      }
      throw new EmbeddingError('Voyage', errorMessage);
    }

    const data = await response.json() as {
      data?: Array<{ embedding?: number[] }>;
    };

    // Validate response structure
    if (!data || !Array.isArray(data.data)) {
      throw new EmbeddingError('Voyage', 'Invalid response: missing data array');
    }

    // Validate each embedding item
    for (let i = 0; i < data.data.length; i++) {
      if (!Array.isArray(data.data[i].embedding)) {
        throw new EmbeddingError('Voyage', `Invalid response: item ${i} missing embedding array`);
      }
    }

    return data.data.map((item) => item.embedding!);
  }
}

/**
 * Mock Embeddings Provider (for testing)
 *
 * Generates deterministic fake embeddings based on text hash.
 * Useful for unit tests where you don't want to call real APIs.
 *
 * @example
 * ```typescript
 * const embedder = new MockEmbeddings({ dimension: 1536 });
 * const embedding = await embedder.embedQuery('test');
 * ```
 */
export class MockEmbeddings implements EmbeddingProvider {
  dimension: number;

  constructor(config?: { dimension?: number }) {
    this.dimension = config?.dimension ?? 1536;
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.generateMockEmbedding(text);
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    // Handle empty input for consistency with other providers
    if (texts.length === 0) {
      return [];
    }
    return texts.map((text) => this.generateMockEmbedding(text));
  }

  private generateMockEmbedding(text: string): number[] {
    // Simple hash-based deterministic embedding
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }

    const embedding = new Array(this.dimension);
    for (let i = 0; i < this.dimension; i++) {
      // Use hash to seed pseudo-random values
      const seed = hash + i;
      embedding[i] = Math.sin(seed) * 0.5;
    }

    // Normalize
    const norm = Math.sqrt(embedding.reduce((sum, x) => sum + x * x, 0));
    return embedding.map((x) => x / norm);
  }
}
