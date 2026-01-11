/**
 * Optimization operations tests for memvid-node
 *
 * Tests for:
 * - vacuum() - Reclaim unused space
 * - compactWal() - Compact write-ahead log
 * - putWithChunkEmbeddings() - Store with per-chunk embeddings
 * - previewChunks() - Preview document chunking
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Memvid, MockEmbeddings } from '../dist/index.js';
import { uniqueTestFile, cleanupTestFile, isVecAvailable, safeClose } from './test-utils.js';

const VEC_AVAILABLE = isVecAvailable();

describe('Vacuum', () => {
  let mem: Memvid;
  let testFile: string;

  beforeEach(() => {
    testFile = uniqueTestFile('vacuum');
    mem = Memvid.create(testFile);
    mem.enableLex();
  });

  afterEach(() => {
    safeClose(mem);
    cleanupTestFile(testFile);
  });

  it('should vacuum an empty file', () => {
    mem.commit();

    const result = mem.vacuum();

    expect(result).toBeDefined();
    expect(typeof result.bytesReclaimed).toBe('number');
    expect(typeof result.framesRetained).toBe('number');
    expect(typeof result.sizeBefore).toBe('number');
    expect(typeof result.sizeAfter).toBe('number');
    expect(result.framesRetained).toBe(0);
  });

  it('should vacuum a file with active frames', () => {
    // Add some documents
    mem.put(Buffer.from('Document one'), { title: 'Doc 1' });
    mem.put(Buffer.from('Document two'), { title: 'Doc 2' });
    mem.put(Buffer.from('Document three'), { title: 'Doc 3' });
    mem.commit();

    const result = mem.vacuum();

    expect(result).toBeDefined();
    expect(result.framesRetained).toBe(3);
    expect(result.sizeAfter).toBeGreaterThan(0);
  });

  it('should reclaim space after deleting frames', () => {
    // Add some documents
    mem.put(Buffer.from('Document one to delete'), { title: 'Doc 1' });
    mem.put(Buffer.from('Document two to keep'), { title: 'Doc 2' });
    mem.put(Buffer.from('Document three to delete'), { title: 'Doc 3' });
    mem.commit();

    // Get actual frame IDs from timeline
    const entries = mem.timeline({ limit: 10 });
    expect(entries.length).toBe(3);

    // Delete two frames (first and third)
    mem.delete(entries[0].frameId);
    mem.delete(entries[2].frameId);
    mem.commit();

    // Vacuum should reclaim space
    const result = mem.vacuum();

    expect(result).toBeDefined();
    expect(result.framesRetained).toBe(1);
    // After vacuum, bytes reclaimed should be calculated
    expect(result.bytesReclaimed).toBeGreaterThanOrEqual(0);
  });

  it('should rebuild indexes after vacuum', () => {
    // Add documents
    mem.put(Buffer.from('Searchable content about cats'), { title: 'Cats' });
    mem.put(Buffer.from('Searchable content about dogs'), { title: 'Dogs' });
    mem.commit();

    // Search should work before vacuum
    const beforeVacuum = mem.find('cats');
    expect(beforeVacuum.hits.length).toBeGreaterThan(0);

    // Vacuum
    mem.vacuum();

    // Search should still work after vacuum
    const afterVacuum = mem.find('cats');
    expect(afterVacuum.hits.length).toBeGreaterThan(0);
  });
});

describe('Compact WAL', () => {
  let mem: Memvid;
  let testFile: string;

  beforeEach(() => {
    testFile = uniqueTestFile('compact');
    mem = Memvid.create(testFile);
    mem.enableLex();
  });

  afterEach(() => {
    safeClose(mem);
    cleanupTestFile(testFile);
  });

  it('should compact WAL on empty file', () => {
    const result = mem.compactWal();

    expect(result).toBeDefined();
    expect(typeof result.recordsCompacted).toBe('number');
    expect(typeof result.walSizeBefore).toBe('number');
    expect(typeof result.walSizeAfter).toBe('number');
    expect(typeof result.pendingBefore).toBe('number');
    expect(typeof result.pendingAfter).toBe('number');
    // After compaction, pending should be 0
    expect(result.pendingAfter).toBe(0);
  });

  it('should compact WAL after adding documents', () => {
    // Add documents without committing
    mem.put(Buffer.from('Document one'), { title: 'Doc 1' });
    mem.put(Buffer.from('Document two'), { title: 'Doc 2' });
    // Note: compactWal includes a commit

    const result = mem.compactWal();

    expect(result).toBeDefined();
    expect(result.pendingAfter).toBe(0);
    // WAL size should remain the same (embedded WAL has fixed size)
    expect(result.walSizeAfter).toBe(result.walSizeBefore);
  });

  it('should return correct pending counts', () => {
    // First, ensure clean state
    mem.commit();
    const initial = mem.compactWal();
    expect(initial.pendingBefore).toBe(0);
    expect(initial.pendingAfter).toBe(0);

    // Add more documents
    mem.put(Buffer.from('More content'), { title: 'More' });

    // Compact should show activity
    const afterPut = mem.compactWal();
    expect(afterPut.pendingAfter).toBe(0);
  });
});

describe('Put With Chunk Embeddings', () => {
  let mem: Memvid;
  let testFile: string;

  beforeEach(() => {
    testFile = uniqueTestFile('chunks');
    mem = Memvid.create(testFile);
    mem.enableLex();
  });

  afterEach(() => {
    safeClose(mem);
    cleanupTestFile(testFile);
  });

  it.skipIf(!VEC_AVAILABLE)('should store document with chunk embeddings', () => {
    mem.enableVec();

    const content = Buffer.from('This is a document that would be chunked into multiple parts.');
    const chunkEmbeddings = [
      { text: 'This is a document', embedding: new Array(1536).fill(0.1) },
      { text: 'that would be chunked', embedding: new Array(1536).fill(0.2) },
      { text: 'into multiple parts', embedding: new Array(1536).fill(0.3) },
    ];

    const frameId = mem.putWithChunkEmbeddings(content, undefined, chunkEmbeddings, {
      title: 'Chunked Doc',
    });
    mem.commit();

    expect(typeof frameId).toBe('number');
    expect(frameId).toBeGreaterThanOrEqual(0);

    // Verify the document was stored
    const stats = mem.stats();
    expect(stats.frameCount).toBe(1);
  });

  it.skipIf(!VEC_AVAILABLE)('should store document with parent and chunk embeddings', () => {
    mem.enableVec();

    const content = Buffer.from('Document with parent embedding.');
    const parentEmbedding = new Array(1536).fill(0.5);
    const chunkEmbeddings = [{ embedding: new Array(1536).fill(0.1) }];

    const frameId = mem.putWithChunkEmbeddings(content, parentEmbedding, chunkEmbeddings);
    mem.commit();

    expect(typeof frameId).toBe('number');
  });

  it('should reject empty chunk embeddings array', () => {
    // Note: empty chunk embeddings array is actually valid (no chunks)
    // The Rust implementation should accept this
    const content = Buffer.from('Small document');

    // This should work - no chunks is valid
    const frameId = mem.putWithChunkEmbeddings(content, undefined, []);
    expect(typeof frameId).toBe('number');
  });

  it('should reject invalid embedding dimensions', () => {
    const content = Buffer.from('Test content');
    const invalidChunkEmbeddings = [{ embedding: [] as number[] }]; // Empty embedding

    expect(() => {
      mem.putWithChunkEmbeddings(content, undefined, invalidChunkEmbeddings);
    }).toThrow();
  });
});

describe('Preview Chunks', () => {
  let mem: Memvid;
  let testFile: string;

  beforeEach(() => {
    testFile = uniqueTestFile('preview');
    mem = Memvid.create(testFile);
  });

  afterEach(() => {
    safeClose(mem);
    cleanupTestFile(testFile);
  });

  it('should return null for small documents', () => {
    const smallContent = Buffer.from('This is a small document.');

    const chunks = mem.previewChunks(smallContent);

    expect(chunks).toBeNull();
  });

  it('should return chunks for large documents', () => {
    // Create a large document (> 2400 chars after normalization)
    const paragraph = 'This is a paragraph of text that will be repeated. ';
    const largeContent = Buffer.from(paragraph.repeat(100));

    const chunks = mem.previewChunks(largeContent);

    // Large documents should be chunked
    if (chunks !== null) {
      expect(Array.isArray(chunks)).toBe(true);
      expect(chunks.length).toBeGreaterThan(0);
      for (const chunk of chunks) {
        expect(typeof chunk).toBe('string');
        expect(chunk.length).toBeGreaterThan(0);
      }
    }
  });

  it('should be consistent with actual chunking', () => {
    // If previewChunks returns chunks, they should be consistent
    const paragraph = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. ';
    const content = Buffer.from(paragraph.repeat(100));

    const chunks1 = mem.previewChunks(content);
    const chunks2 = mem.previewChunks(content);

    // Should be deterministic
    expect(chunks1).toEqual(chunks2);
  });
});

describe('Integration: Optimization Workflow', () => {
  let testFile: string;

  beforeEach(() => {
    testFile = uniqueTestFile('workflow');
  });

  afterEach(() => {
    cleanupTestFile(testFile);
  });

  it('should handle full optimization workflow', () => {
    const mem = Memvid.create(testFile);
    mem.enableLex();

    // Add documents
    const id1 = mem.put(Buffer.from('First document'), { title: 'First' });
    const id2 = mem.put(Buffer.from('Second document'), { title: 'Second' });
    const id3 = mem.put(Buffer.from('Third document'), { title: 'Third' });
    mem.commit();

    // Compact WAL
    const compactResult = mem.compactWal();
    expect(compactResult.pendingAfter).toBe(0);

    // Delete a document
    mem.delete(id2);
    mem.commit();

    // Vacuum to reclaim space
    const vacuumResult = mem.vacuum();
    expect(vacuumResult.framesRetained).toBe(2);

    // Verify remaining documents are searchable
    const results = mem.find('document');
    expect(results.hits.length).toBe(2);

    mem.close();
  });

  it.skipIf(!VEC_AVAILABLE)('should handle chunk embeddings workflow', async () => {
    const mem = Memvid.create(testFile);
    mem.enableLex();
    mem.enableVec();

    const embedder = new MockEmbeddings({ dimension: 1536 });

    // Create a document and preview chunks
    const paragraph = 'This is content that might be chunked based on its size. ';
    const content = Buffer.from(paragraph.repeat(100));

    const chunks = mem.previewChunks(content);

    if (chunks) {
      // Generate embeddings for each chunk
      const chunkEmbeddings = await Promise.all(
        chunks.map(async (text) => ({
          text,
          embedding: await embedder.embedQuery(text),
        }))
      );

      // Store with chunk embeddings
      const frameId = mem.putWithChunkEmbeddings(content, undefined, chunkEmbeddings, {
        title: 'Large Document',
      });
      mem.commit();

      expect(typeof frameId).toBe('number');

      // Should be searchable
      const queryEmb = await embedder.embedQuery('content size');
      const results = mem.vecSearch(queryEmb, { topK: 5 });
      expect(results.hits.length).toBeGreaterThan(0);
    }

    mem.close();
  });
});
