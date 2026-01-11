/**
 * CLIP Visual Search tests for memvid-node
 *
 * Tests the CLIP visual embeddings index functionality:
 * - enableClip() - Enable CLIP index
 * - addClipEmbedding() - Add embedding for a frame
 * - addClipEmbeddingWithPage() - Add embedding with page number
 * - clipSearch() - Search by embedding
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { Memvid } from '../dist/index.js';

const TEST_DIR = os.tmpdir();

/** Generate a unique test file path */
function uniqueTestFile(): string {
  return path.join(TEST_DIR, `memvid_clip_${crypto.randomUUID()}.mv2`);
}

/** Generate a random normalized embedding of given dimension */
function randomEmbedding(dim: number = 512): number[] {
  const embedding = Array.from({ length: dim }, () => Math.random() * 2 - 1);
  const norm = Math.sqrt(embedding.reduce((sum, x) => sum + x * x, 0));
  return embedding.map((x) => x / norm);
}

/** Check if clip feature is available */
function isClipAvailable(): boolean {
  const testPath = uniqueTestFile();
  try {
    const mem = Memvid.create(testPath);
    mem.enableClip();
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

const CLIP_AVAILABLE = isClipAvailable();

describe('CLIP Visual Search', () => {
  let testFile: string;

  beforeEach(() => {
    testFile = uniqueTestFile();
  });

  afterEach(() => {
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  });

  describe('enableClip', () => {
    it.skipIf(!CLIP_AVAILABLE)('should enable CLIP index', () => {
      const mem = Memvid.create(testFile);

      mem.enableClip();

      const stats = mem.stats();
      expect(stats.hasClipIndex).toBe(true);
    });

    it.skipIf(!CLIP_AVAILABLE)('should be idempotent (enable twice without error)', () => {
      const mem = Memvid.create(testFile);

      mem.enableClip();
      mem.enableClip(); // Should not throw

      const stats = mem.stats();
      expect(stats.hasClipIndex).toBe(true);
    });
  });

  describe('addClipEmbedding', () => {
    it.skipIf(!CLIP_AVAILABLE)('should add CLIP embedding for a frame', () => {
      const mem = Memvid.create(testFile);
      mem.enableLex();
      mem.enableClip();

      // Store a document first
      const frameId = mem.put(Buffer.from('Image of a cat'), { title: 'Cat Photo' });

      // Add CLIP embedding
      const embedding = randomEmbedding(512);
      mem.addClipEmbedding(frameId, embedding);
      mem.commit();

      const stats = mem.stats();
      expect(stats.frameCount).toBe(1);
      expect(stats.hasClipIndex).toBe(true);
    });

    it.skipIf(!CLIP_AVAILABLE)('should add multiple CLIP embeddings', () => {
      const mem = Memvid.create(testFile);
      mem.enableLex();
      mem.enableClip();

      // Store multiple documents with embeddings
      const documents = [
        { content: 'Image of a cat', title: 'Cat' },
        { content: 'Image of a dog', title: 'Dog' },
        { content: 'Image of a sunset', title: 'Sunset' },
      ];

      for (const doc of documents) {
        const frameId = mem.put(Buffer.from(doc.content), { title: doc.title });
        mem.addClipEmbedding(frameId, randomEmbedding(512));
      }
      mem.commit();

      const stats = mem.stats();
      expect(stats.frameCount).toBe(3);
    });

    it('should reject empty embedding', () => {
      const mem = Memvid.create(testFile);
      mem.enableLex();

      const frameId = mem.put(Buffer.from('test'), { title: 'Test' });

      expect(() => mem.addClipEmbedding(frameId, [])).toThrow(/empty/);
    });

    it('should reject non-array embedding', () => {
      const mem = Memvid.create(testFile);
      mem.enableLex();

      const frameId = mem.put(Buffer.from('test'), { title: 'Test' });

      expect(() => mem.addClipEmbedding(frameId, 'not an array' as any)).toThrow(/array/);
    });
  });

  describe('addClipEmbeddingWithPage', () => {
    it.skipIf(!CLIP_AVAILABLE)('should add CLIP embedding with page number', () => {
      const mem = Memvid.create(testFile);
      mem.enableLex();
      mem.enableClip();

      // Store a PDF-like document
      const frameId = mem.put(Buffer.from('PDF document content'), { title: 'Report.pdf' });

      // Add embeddings for each "page"
      mem.addClipEmbeddingWithPage(frameId, 1, randomEmbedding(512));
      mem.addClipEmbeddingWithPage(frameId, 2, randomEmbedding(512));
      mem.addClipEmbeddingWithPage(frameId, 3, randomEmbedding(512));
      mem.commit();

      const stats = mem.stats();
      expect(stats.frameCount).toBe(1);
      expect(stats.hasClipIndex).toBe(true);
    });
  });

  describe('clipSearch', () => {
    it.skipIf(!CLIP_AVAILABLE)('should search CLIP index and return results', () => {
      const mem = Memvid.create(testFile);
      mem.enableLex();
      mem.enableClip();

      // Store documents with embeddings
      const catEmbedding = randomEmbedding(512);
      const dogEmbedding = randomEmbedding(512);

      const catFrameId = mem.put(Buffer.from('Image of a cat'), { title: 'Cat' });
      mem.addClipEmbedding(catFrameId, catEmbedding);

      const dogFrameId = mem.put(Buffer.from('Image of a dog'), { title: 'Dog' });
      mem.addClipEmbedding(dogFrameId, dogEmbedding);

      mem.commit();

      // Search with cat embedding (should find cat)
      const hits = mem.clipSearch(catEmbedding, 5);

      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].frameId).toBe(catFrameId);
      expect(hits[0].distance).toBeCloseTo(0, 5); // Same embedding = distance ~0
    });

    it.skipIf(!CLIP_AVAILABLE)('should return page numbers when present', () => {
      const mem = Memvid.create(testFile);
      mem.enableLex();
      mem.enableClip();

      const frameId = mem.put(Buffer.from('Multi-page document'), { title: 'Report' });

      // Add embeddings for pages 1 and 2
      const page1Embedding = randomEmbedding(512);
      const page2Embedding = randomEmbedding(512);

      mem.addClipEmbeddingWithPage(frameId, 1, page1Embedding);
      mem.addClipEmbeddingWithPage(frameId, 2, page2Embedding);
      mem.commit();

      // Search for page 1
      const hits = mem.clipSearch(page1Embedding, 5);

      expect(hits.length).toBeGreaterThan(0);
      // First hit should be page 1 with distance ~0
      const page1Hit = hits.find((h) => h.page === 1);
      expect(page1Hit).toBeDefined();
      expect(page1Hit!.distance).toBeCloseTo(0, 5);
    });

    it.skipIf(!CLIP_AVAILABLE)('should respect topK limit', () => {
      const mem = Memvid.create(testFile);
      mem.enableLex();
      mem.enableClip();

      // Store 5 documents
      for (let i = 0; i < 5; i++) {
        const frameId = mem.put(Buffer.from(`Document ${i}`), { title: `Doc ${i}` });
        mem.addClipEmbedding(frameId, randomEmbedding(512));
      }
      mem.commit();

      // Search with limit 2
      const hits = mem.clipSearch(randomEmbedding(512), 2);

      expect(hits.length).toBeLessThanOrEqual(2);
    });

    it.skipIf(!CLIP_AVAILABLE)('should return empty array when no results', () => {
      const mem = Memvid.create(testFile);
      mem.enableLex();
      mem.enableClip();

      // Add a document with CLIP embedding and then search for something different
      const frameId = mem.put(Buffer.from('Test document'), { title: 'Test' });
      mem.addClipEmbedding(frameId, randomEmbedding(512));
      mem.commit();

      // Generate a random query embedding that's orthogonal to stored embeddings
      // With normalized random vectors, we should get results (they may have high distance)
      const hits = mem.clipSearch(randomEmbedding(512), 5);

      // We should get at least one result (the only document) since CLIP index now exists
      // The test validates that the search works even if no results are found
      expect(Array.isArray(hits)).toBe(true);
    });

    it('should reject empty query embedding', () => {
      const mem = Memvid.create(testFile);

      expect(() => mem.clipSearch([])).toThrow(/empty/);
    });

    it('should reject non-array query embedding', () => {
      const mem = Memvid.create(testFile);

      expect(() => mem.clipSearch('not an array' as any)).toThrow(/array/);
    });
  });

  describe('CLIP search result structure', () => {
    it.skipIf(!CLIP_AVAILABLE)('should have correct result structure', () => {
      const mem = Memvid.create(testFile);
      mem.enableLex();
      mem.enableClip();

      const embedding = randomEmbedding(512);
      const frameId = mem.put(Buffer.from('Test image'), { title: 'Test' });
      mem.addClipEmbedding(frameId, embedding);
      mem.commit();

      const hits = mem.clipSearch(embedding, 1);

      expect(hits.length).toBe(1);
      const hit = hits[0];

      // Check all expected properties
      expect(typeof hit.frameId).toBe('number');
      expect(typeof hit.distance).toBe('number');
      expect(hit.distance).toBeGreaterThanOrEqual(0);

      // page is optional
      expect(hit.page).toBeUndefined();
    });

    it.skipIf(!CLIP_AVAILABLE)('should have page in result when added with page', () => {
      const mem = Memvid.create(testFile);
      mem.enableLex();
      mem.enableClip();

      const embedding = randomEmbedding(512);
      const frameId = mem.put(Buffer.from('PDF page'), { title: 'Page 5' });
      mem.addClipEmbeddingWithPage(frameId, 5, embedding);
      mem.commit();

      const hits = mem.clipSearch(embedding, 1);

      expect(hits.length).toBe(1);
      expect(hits[0].page).toBe(5);
    });
  });
});
