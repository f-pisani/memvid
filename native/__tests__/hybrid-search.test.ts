/**
 * Hybrid and Adaptive Search tests for memvid-node
 *
 * Tests for vector search variants:
 * - hybrid_search (combines lexical + vector search)
 * - search_adaptive (automatic relevance cutoff)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { Memvid, MockEmbeddings } from '../dist/index.js';

const TEST_DIR = os.tmpdir();

/** Generate a unique test file path */
function uniqueTestFile(prefix: string = 'hybrid'): string {
  return path.join(TEST_DIR, `memvid_${prefix}_${crypto.randomUUID()}.mv2`);
}

/** Check if vec feature is available */
function isVecAvailable(): boolean {
  const testPath = uniqueTestFile('vec_check');
  try {
    const mem = Memvid.create(testPath);
    mem.enableVec();
    mem.close();
    return true;
  } catch {
    return false;
  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
}

const VEC_AVAILABLE = isVecAvailable();

describe('Hybrid Search', () => {
  let mem: Memvid;
  let embedder: MockEmbeddings;
  let testFile: string;

  beforeEach(() => {
    testFile = uniqueTestFile('hybrid');
    mem = Memvid.create(testFile);
    mem.enableLex();
    embedder = new MockEmbeddings({ dimension: 1536 });
  });

  afterEach(() => {
    if (!mem.isClosed) {
      mem.close();
    }
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  });

  it.skipIf(!VEC_AVAILABLE)('should perform hybrid search with query and embedding', async () => {
    mem.enableVec();

    // Store documents with embeddings
    const docs = [
      'Artificial intelligence is revolutionizing technology.',
      'Machine learning algorithms can learn from data.',
      'TypeScript adds static typing to JavaScript.',
    ];

    for (const doc of docs) {
      const emb = await embedder.embedQuery(doc);
      mem.putWithEmbedding(Buffer.from(doc), emb, { title: doc.slice(0, 20) });
    }
    mem.commit();

    // Perform hybrid search using the native handle directly
    const query = 'AI and machine learning';
    const queryEmb = await embedder.embedQuery(query);

    // Access native handle for hybrid_search
    const handle = (mem as any).handle;
    const results = handle.hybridSearch(query, queryEmb, 5, { snippetChars: 100 });

    expect(results).toBeDefined();
    expect(results.hits).toBeDefined();
    expect(Array.isArray(results.hits)).toBe(true);
    expect(results.totalHits).toBeGreaterThan(0);
  });

  it.skipIf(!VEC_AVAILABLE)('should support scope filtering in hybrid search', async () => {
    mem.enableVec();

    // Store documents with different URIs
    const doc1 = 'Document about technology';
    const doc2 = 'Document about cooking';

    const emb1 = await embedder.embedQuery(doc1);
    const emb2 = await embedder.embedQuery(doc2);

    mem.putWithEmbedding(Buffer.from(doc1), emb1, {
      title: 'Tech',
      uri: 'doc://tech/1',
    });
    mem.putWithEmbedding(Buffer.from(doc2), emb2, {
      title: 'Cooking',
      uri: 'doc://cooking/1',
    });
    mem.commit();

    const query = 'document';
    const queryEmb = await embedder.embedQuery(query);

    const handle = (mem as any).handle;
    const results = handle.hybridSearch(query, queryEmb, 10, { scope: 'doc://tech/' });

    // Should only return tech document
    expect(results.hits.every((h: any) => h.uri?.startsWith('doc://tech/'))).toBe(true);
  });
});

describe('Adaptive Search', () => {
  let mem: Memvid;
  let embedder: MockEmbeddings;
  let testFile: string;

  beforeEach(() => {
    testFile = uniqueTestFile('adaptive');
    mem = Memvid.create(testFile);
    mem.enableLex();
    embedder = new MockEmbeddings({ dimension: 1536 });
  });

  afterEach(() => {
    if (!mem.isClosed) {
      mem.close();
    }
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  });

  it.skipIf(!VEC_AVAILABLE)('should perform adaptive search with default settings', async () => {
    mem.enableVec();

    // Store documents
    const docs = [
      'Artificial intelligence is the simulation of human intelligence.',
      'Machine learning is a subset of artificial intelligence.',
      'Deep learning uses neural networks with many layers.',
      'Natural language processing enables computers to understand text.',
      'Computer vision allows machines to interpret images.',
    ];

    for (const doc of docs) {
      const emb = await embedder.embedQuery(doc);
      mem.putWithEmbedding(Buffer.from(doc), emb, { title: doc.slice(0, 30) });
    }
    mem.commit();

    const query = 'artificial intelligence and machine learning';
    const queryEmb = await embedder.embedQuery(query);

    const handle = (mem as any).handle;
    const result = handle.searchAdaptive(query, queryEmb, {
      enabled: true,
      maxResults: 100,
      minResults: 1,
    });

    expect(result).toBeDefined();
    expect(result.hits).toBeDefined();
    expect(result.stats).toBeDefined();
    expect(result.stats.totalConsidered).toBeGreaterThan(0);
    expect(result.stats.returned).toBeGreaterThanOrEqual(result.stats.minResults || 1);
  });

  it.skipIf(!VEC_AVAILABLE)('should support different cutoff strategies', async () => {
    mem.enableVec();

    // Store a few documents
    const docs = ['Document about topic A', 'Document about topic B', 'Completely unrelated'];

    for (const doc of docs) {
      const emb = await embedder.embedQuery(doc);
      mem.putWithEmbedding(Buffer.from(doc), emb, { title: doc });
    }
    mem.commit();

    const query = 'topic A';
    const queryEmb = await embedder.embedQuery(query);
    const handle = (mem as any).handle;

    // Test different strategies
    const strategies = ['relative', 'absolute', 'cliff', 'elbow', 'combined'];

    for (const strategy of strategies) {
      const result = handle.searchAdaptive(query, queryEmb, {
        strategy,
        threshold: 0.5,
        maxResults: 10,
      });

      expect(result).toBeDefined();
      expect(result.stats.triggeredBy).toBeDefined();
    }
  });

  it.skipIf(!VEC_AVAILABLE)('should return adaptive stats', async () => {
    mem.enableVec();

    const doc = 'Test document for adaptive stats';
    const emb = await embedder.embedQuery(doc);
    mem.putWithEmbedding(Buffer.from(doc), emb, { title: 'Test' });
    mem.commit();

    const query = 'test document';
    const queryEmb = await embedder.embedQuery(query);

    const handle = (mem as any).handle;
    const result = handle.searchAdaptive(query, queryEmb, {});

    expect(result.stats).toBeDefined();
    expect(typeof result.stats.totalConsidered).toBe('number');
    expect(typeof result.stats.returned).toBe('number');
    expect(typeof result.stats.cutoffIndex).toBe('number');
    expect(typeof result.stats.triggeredBy).toBe('string');
  });
});
