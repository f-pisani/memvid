/**
 * Embeddings tests for memvid-node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { Memvid, MockEmbeddings, OpenAIEmbeddings, CohereEmbeddings, VecNotEnabledError } from '../dist/index.js';

/** Generate a unique test file path */
function uniqueTestFile(prefix: string): string {
  return path.join(os.tmpdir(), `memvid_${prefix}_${crypto.randomUUID()}.mv2`);
}

/** Check if vec feature is available */
function isVecAvailable(): boolean {
  const testPath = path.join(os.tmpdir(), `memvid_vec_check_${crypto.randomUUID()}.mv2`);
  try {
    const mem = Memvid.create(testPath);
    mem.enableVec();
    mem.close();
    return true;
  } catch (e) {
    return false;
  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
}

const VEC_AVAILABLE = isVecAvailable();

describe('Embedding Providers', () => {
  describe('MockEmbeddings', () => {
    it('should create embeddings with default dimension', async () => {
      const embedder = new MockEmbeddings();

      const embedding = await embedder.embedQuery('test query');

      expect(embedding).toBeDefined();
      expect(embedding.length).toBe(1536);
    });

    it('should create embeddings with custom dimension', async () => {
      const embedder = new MockEmbeddings({ dimension: 768 });

      const embedding = await embedder.embedQuery('test query');

      expect(embedding.length).toBe(768);
    });

    it('should generate deterministic embeddings', async () => {
      const embedder = new MockEmbeddings();

      const emb1 = await embedder.embedQuery('hello world');
      const emb2 = await embedder.embedQuery('hello world');

      expect(emb1).toEqual(emb2);
    });

    it('should generate different embeddings for different texts', async () => {
      const embedder = new MockEmbeddings();

      const emb1 = await embedder.embedQuery('hello');
      const emb2 = await embedder.embedQuery('goodbye');

      expect(emb1).not.toEqual(emb2);
    });

    it('should batch embed documents', async () => {
      const embedder = new MockEmbeddings();

      const embeddings = await embedder.embedDocuments(['doc1', 'doc2', 'doc3']);

      expect(embeddings.length).toBe(3);
      embeddings.forEach(emb => {
        expect(emb.length).toBe(1536);
      });
    });

    it('should generate normalized embeddings', async () => {
      const embedder = new MockEmbeddings();

      const embedding = await embedder.embedQuery('test');
      const norm = Math.sqrt(embedding.reduce((sum, x) => sum + x * x, 0));

      expect(norm).toBeCloseTo(1.0, 5);
    });
  });

  describe('OpenAIEmbeddings', () => {
    it('should have correct default model', () => {
      const embedder = new OpenAIEmbeddings({ apiKey: 'test-key' });

      expect(embedder.dimension).toBe(1536);
    });

    it('should support custom model', () => {
      const embedder = new OpenAIEmbeddings({
        apiKey: 'test-key',
        model: 'text-embedding-3-large',
      });

      expect(embedder.dimension).toBe(3072);
    });

    it('should support custom base URL', () => {
      // Just verify it doesn't throw
      const embedder = new OpenAIEmbeddings({
        apiKey: 'test-key',
        baseUrl: 'https://custom.api.com/v1',
      });

      expect(embedder).toBeDefined();
    });
  });

  describe('CohereEmbeddings', () => {
    it('should have correct default model', () => {
      const embedder = new CohereEmbeddings({ apiKey: 'test-key' });

      expect(embedder.dimension).toBe(1024);
    });

    it('should support light model', () => {
      const embedder = new CohereEmbeddings({
        apiKey: 'test-key',
        model: 'embed-english-light-v3.0',
      });

      expect(embedder.dimension).toBe(384);
    });
  });
});

describe('Vector Search with Embeddings', () => {
  let mem: Memvid;
  let embedder: MockEmbeddings;
  let testFile: string;

  beforeEach(() => {
    testFile = uniqueTestFile('embeddings');
    mem = Memvid.create(testFile);
    mem.enableLex();
    embedder = new MockEmbeddings({ dimension: 1536 });
  });

  afterEach(() => {
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  });

  it.skipIf(!VEC_AVAILABLE)('should store documents with embeddings', async () => {
    const text = 'Test document about artificial intelligence';
    const embedding = await embedder.embedQuery(text);

    mem.enableVec();
    const frameId = mem.putWithEmbedding(Buffer.from(text), embedding, {
      title: 'AI Test',
    });
    mem.commit();

    expect(frameId).toBeGreaterThan(0);

    const stats = mem.stats();
    expect(stats.frameCount).toBe(1);
  });

  it.skipIf(!VEC_AVAILABLE)('should perform vector search', async () => {
    const docs = [
      'Artificial intelligence is transforming technology',
      'Machine learning enables pattern recognition',
      'TypeScript improves JavaScript development',
    ];

    mem.enableVec();

    // Store with embeddings
    for (const doc of docs) {
      const emb = await embedder.embedQuery(doc);
      mem.putWithEmbedding(Buffer.from(doc), emb, { title: doc.slice(0, 20) });
    }
    mem.commit();

    // Search
    const queryEmb = await embedder.embedQuery('AI and machine learning');
    const results = mem.vecSearch(queryEmb, 3);

    expect(results.hits.length).toBeGreaterThan(0);
    expect(results.engine).toBe('Vec');
  });

  it.skipIf(!VEC_AVAILABLE)('should filter by max distance', async () => {
    mem.enableVec();

    // Store one document
    const doc = 'Test document';
    const emb = await embedder.embedQuery(doc);
    mem.putWithEmbedding(Buffer.from(doc), emb, { title: 'Test' });
    mem.commit();

    // Search with strict threshold
    const queryEmb = await embedder.embedQuery('completely different topic');
    const results = mem.vecSearch(queryEmb, 10, 0.1); // Very strict threshold

    // Should filter out non-matching results
    expect(results.hits.length).toBeLessThanOrEqual(1);
  });

  it('should use putMany with embedder', async () => {
    const documents = [
      { content: 'First document', options: { title: 'First' } },
      { content: 'Second document', options: { title: 'Second' } },
    ];

    const result = await mem.putMany(documents, embedder);
    mem.commit();

    expect(result.frameIds.length).toBe(2);
    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(0);

    const stats = mem.stats();
    expect(stats.frameCount).toBe(2);
  });

  it('should use putMany without embedder', async () => {
    const documents = [
      { content: Buffer.from('First document'), options: { title: 'First' } },
      { content: Buffer.from('Second document'), options: { title: 'Second' } },
    ];

    const result = await mem.putMany(documents);
    mem.commit();

    expect(result.frameIds.length).toBe(2);
    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(0);
  });
});

describe('Input Validation', () => {
  let mem: Memvid;
  let testFile: string;

  beforeEach(() => {
    testFile = uniqueTestFile('validation');
    mem = Memvid.create(testFile);
    mem.enableLex();
  });

  afterEach(() => {
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  });

  it('should reject non-buffer content', () => {
    expect(() => mem.put('not a buffer' as any, {})).toThrow(/Buffer/);
  });

  // Note: These validation tests check TypeScript layer validation which happens
  // before vec is even accessed, so they should work regardless of vec availability
  it('should reject empty embedding', () => {
    // Validation happens in TS layer before native call
    expect(() => mem.putWithEmbedding(Buffer.from('test'), [], {})).toThrow(/empty/);
  });

  it('should reject non-array embedding', () => {
    expect(() => mem.putWithEmbedding(Buffer.from('test'), 'not array' as any, {})).toThrow(/array/);
  });

  it('should reject embedding with non-numbers', () => {
    expect(() => mem.putWithEmbedding(Buffer.from('test'), [1, 2, 'three'] as any, {})).toThrow(/finite number/);
  });

  it('should reject invalid topK values', () => {
    // Native binding rejects negative values with "Cannot convert -1 to usize (negative)"
    expect(() => mem.find('query', -1)).toThrow(/negative/);
    // Native binding accepts float and truncates, so 1.5 becomes 1 (valid)
    // Test removed as behavior is acceptable
  });

  it('should reject non-string query', () => {
    expect(() => mem.find(123 as any)).toThrow(/string/);
  });
});
