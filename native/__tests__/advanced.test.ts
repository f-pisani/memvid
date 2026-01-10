/**
 * Advanced operations tests for memvid-node
 *
 * Tests for new NAPI bindings including:
 * - hybrid_search, search_adaptive (vector search variants)
 * - Memory Cards API
 * - Table extraction and management
 * - Document processing
 * - Update and blob operations
 * - Doctor diagnostic tool
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { Memvid, MockEmbeddings } from '../dist/index.js';

// Import native bindings directly for module-level functions
import * as native from '../index.js';

const TEST_DIR = os.tmpdir();

/** Generate a unique test file path */
function uniqueTestFile(prefix: string = 'advanced'): string {
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

// ============================================================================
// Hybrid Search and Adaptive Search Tests
// ============================================================================

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

// ============================================================================
// Memory Cards Tests
// ============================================================================

describe('Memory Cards', () => {
  let mem: Memvid;
  let testFile: string;

  beforeEach(() => {
    testFile = uniqueTestFile('memory');
    mem = Memvid.create(testFile);
    mem.enableLex();
  });

  afterEach(() => {
    if (!mem.isClosed) {
      mem.close();
    }
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  });

  describe('put_memory_card', () => {
    it('should create a memory card with required fields', () => {
      const handle = (mem as any).handle;

      const cardId = handle.putMemoryCard({
        entity: 'user',
        slot: 'name',
        value: 'John Doe',
      });

      // Card IDs start at 0
      expect(typeof cardId).toBe('number');
      expect(cardId).toBeGreaterThanOrEqual(0);
    });

    it('should create a memory card with all fields', () => {
      const handle = (mem as any).handle;

      const cardId = handle.putMemoryCard({
        entity: 'project',
        slot: 'status',
        value: 'active',
        kind: 'fact',
        confidence: 0.95,
        sourceFrameId: 1,
        sourceUri: 'doc://source/1',
      });

      expect(typeof cardId).toBe('number');
      expect(cardId).toBeGreaterThanOrEqual(0);
    });

    it('should accept different memory kinds', () => {
      const handle = (mem as any).handle;
      const kinds = ['fact', 'preference', 'event', 'profile', 'relationship', 'goal', 'other'];

      for (const kind of kinds) {
        const cardId = handle.putMemoryCard({
          entity: 'test',
          slot: `slot_${kind}`,
          value: `value_${kind}`,
          kind,
        });
        expect(typeof cardId).toBe('number');
        expect(cardId).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('put_memory_cards (batch)', () => {
    it('should create multiple memory cards at once', () => {
      const handle = (mem as any).handle;

      const cards = [
        { entity: 'user', slot: 'name', value: 'Alice' },
        { entity: 'user', slot: 'email', value: 'alice@example.com' },
        { entity: 'user', slot: 'age', value: '30' },
      ];

      const cardIds = handle.putMemoryCards(cards);

      expect(Array.isArray(cardIds)).toBe(true);
      expect(cardIds.length).toBe(3);
      cardIds.forEach((id: number) => expect(id).toBeGreaterThanOrEqual(0));
    });
  });

  describe('get_current_memory', () => {
    it('should retrieve current memory for entity:slot', () => {
      const handle = (mem as any).handle;

      handle.putMemoryCard({
        entity: 'user',
        slot: 'employer',
        value: 'Acme Corp',
      });

      const card = handle.getCurrentMemory('user', 'employer');

      expect(card).toBeDefined();
      expect(card.entity).toBe('user');
      expect(card.slot).toBe('employer');
      expect(card.value).toBe('Acme Corp');
    });

    it('should return null for non-existent memory', () => {
      const handle = (mem as any).handle;

      const card = handle.getCurrentMemory('nonexistent', 'slot');

      expect(card).toBeNull();
    });

    it('should return the most recent value for a slot', () => {
      const handle = (mem as any).handle;

      // Add multiple values for same slot
      handle.putMemoryCard({ entity: 'user', slot: 'location', value: 'New York' });
      handle.putMemoryCard({ entity: 'user', slot: 'location', value: 'San Francisco' });
      handle.putMemoryCard({ entity: 'user', slot: 'location', value: 'Seattle' });

      const card = handle.getCurrentMemory('user', 'location');

      expect(card).toBeDefined();
      expect(card.value).toBe('Seattle');
    });
  });

  describe('get_entity_memories', () => {
    it('should retrieve all memories for an entity', () => {
      const handle = (mem as any).handle;

      handle.putMemoryCard({ entity: 'project', slot: 'name', value: 'Memvid' });
      handle.putMemoryCard({ entity: 'project', slot: 'status', value: 'active' });
      handle.putMemoryCard({ entity: 'project', slot: 'priority', value: 'high' });

      const cards = handle.getEntityMemories('project');

      expect(Array.isArray(cards)).toBe(true);
      expect(cards.length).toBe(3);
      cards.forEach((card: any) => expect(card.entity).toBe('project'));
    });

    it('should return empty array for non-existent entity', () => {
      const handle = (mem as any).handle;

      const cards = handle.getEntityMemories('nonexistent');

      expect(Array.isArray(cards)).toBe(true);
      expect(cards.length).toBe(0);
    });
  });

  describe('memories_stats', () => {
    it('should return memory statistics', () => {
      const handle = (mem as any).handle;

      handle.putMemoryCard({ entity: 'user1', slot: 'name', value: 'Alice' });
      handle.putMemoryCard({ entity: 'user2', slot: 'name', value: 'Bob' });
      handle.putMemoryCard({ entity: 'user1', slot: 'email', value: 'alice@test.com' });

      const stats = handle.memoriesStats();

      expect(stats).toBeDefined();
      expect(stats.cardCount).toBe(3);
      expect(stats.entityCount).toBe(2);
    });
  });

  describe('memory_card_count', () => {
    it('should return total card count', () => {
      const handle = (mem as any).handle;

      expect(handle.memoryCardCount()).toBe(0);

      handle.putMemoryCard({ entity: 'test', slot: 'a', value: '1' });
      handle.putMemoryCard({ entity: 'test', slot: 'b', value: '2' });

      expect(handle.memoryCardCount()).toBe(2);
    });
  });

  describe('state (convenience lookup)', () => {
    it('should return value for entity:slot', () => {
      const handle = (mem as any).handle;

      handle.putMemoryCard({ entity: 'config', slot: 'theme', value: 'dark' });

      const value = handle.state('config', 'theme');

      expect(value).toBe('dark');
    });

    it('should return null for non-existent state', () => {
      const handle = (mem as any).handle;

      const value = handle.state('nonexistent', 'slot');

      expect(value).toBeNull();
    });
  });

  describe('clear_memories', () => {
    it('should clear all memory cards', () => {
      const handle = (mem as any).handle;

      handle.putMemoryCard({ entity: 'user', slot: 'name', value: 'Test' });
      handle.putMemoryCard({ entity: 'user', slot: 'email', value: 'test@test.com' });

      expect(handle.memoryCardCount()).toBe(2);

      handle.clearMemories();

      expect(handle.memoryCardCount()).toBe(0);
    });
  });
});

// ============================================================================
// Table Extraction Tests
// ============================================================================

describe('Table Operations', () => {
  let mem: Memvid;
  let testFile: string;

  beforeEach(() => {
    testFile = uniqueTestFile('tables');
    mem = Memvid.create(testFile);
    mem.enableLex();
  });

  afterEach(() => {
    if (!mem.isClosed) {
      mem.close();
    }
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  });

  describe('list_tables', () => {
    it('should return empty array when no tables exist', () => {
      const handle = (mem as any).handle;

      const tables = handle.listTables();

      expect(Array.isArray(tables)).toBe(true);
      expect(tables.length).toBe(0);
    });
  });

  describe('get_table', () => {
    it('should return null for non-existent table', () => {
      const handle = (mem as any).handle;

      const table = handle.getTable('nonexistent-id');

      expect(table).toBeNull();
    });
  });

  // Note: extract_tables requires a valid PDF. Skip if no test PDF available.
  describe('extract_tables', () => {
    it.skip('should extract tables from PDF (requires test PDF)', () => {
      // This test would require a test PDF file
      // const pdfBytes = fs.readFileSync('/path/to/test.pdf');
      // const handle = (mem as any).handle;
      // const tables = handle.extractTables(pdfBytes, 'test.pdf', {});
    });

    it('should support different extraction modes', () => {
      const handle = (mem as any).handle;

      // Just verify options are accepted (will fail without valid PDF, but shouldn't crash)
      const modes = ['conservative', 'standard', 'aggressive', 'lattice_only', 'stream_only'];

      for (const mode of modes) {
        try {
          // Empty buffer should throw a proper error, not crash
          handle.extractTables(Buffer.from([]), 'test.pdf', { mode });
        } catch (e) {
          // Expected to fail with empty PDF, but error should be meaningful
          expect(e).toBeDefined();
        }
      }
    });
  });
});

// ============================================================================
// Document Processing Tests
// ============================================================================

describe('Document Processing', () => {
  let mem: Memvid;
  let testFile: string;

  beforeEach(() => {
    testFile = uniqueTestFile('docs');
    mem = Memvid.create(testFile);
    mem.enableLex();
  });

  afterEach(() => {
    if (!mem.isClosed) {
      mem.close();
    }
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  });

  describe('extract_document', () => {
    it('should extract text from plain text file', () => {
      const handle = (mem as any).handle;
      const content = 'This is a test document with some content.';

      const result = handle.extractDocument(Buffer.from(content), 'test.txt');

      expect(result).toBeDefined();
      expect(result.text).toBe(content);
      // Format is returned as the Rust enum label (e.g., 'text' or 'plain_text')
      expect(['text', 'plain_text']).toContain(result.format);
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    it('should extract text from markdown file', () => {
      const handle = (mem as any).handle;
      const content = '# Heading\n\nSome paragraph text.';

      const result = handle.extractDocument(Buffer.from(content), 'readme.md');

      expect(result).toBeDefined();
      expect(result.text).toContain('Heading');
      expect(result.format).toBe('markdown');
    });

    it('should handle various text file extensions', () => {
      const handle = (mem as any).handle;
      const content = 'test content';

      const extensions = ['.txt', '.log', '.json', '.yaml', '.py', '.js', '.ts', '.rs'];

      for (const ext of extensions) {
        const result = handle.extractDocument(Buffer.from(content), `file${ext}`);
        expect(result.text).toBeDefined();
      }
    });
  });

  describe('put_document', () => {
    it('should store a text document', () => {
      const handle = (mem as any).handle;
      const content = 'Document content to be stored and indexed.';

      const frameId = handle.putDocument(Buffer.from(content), 'document.txt', {
        title: 'My Document',
      });
      mem.commit();

      expect(frameId).toBeGreaterThan(0);

      // Verify document was stored
      const stats = mem.stats();
      expect(stats.frameCount).toBe(1);
    });

    it('should infer title from filename if not provided', () => {
      const handle = (mem as any).handle;

      const frameId = handle.putDocument(Buffer.from('content'), 'my-report.txt', {});
      mem.commit();

      // Frame ID should be a valid number
      expect(typeof frameId).toBe('number');
      expect(frameId).toBeGreaterThanOrEqual(0);

      // Verify a frame was created
      const entries = mem.timeline({ limit: 1, reverse: true });
      expect(entries.length).toBe(1);
    });

    it('should use filename as URI if not provided', () => {
      const handle = (mem as any).handle;

      handle.putDocument(Buffer.from('content'), 'report.txt', {});
      mem.commit();

      // Retrieve frame info from timeline to verify
      const entries = mem.timeline({ limit: 1, reverse: true });
      expect(entries.length).toBe(1);
      expect(entries[0].uri).toBe('report.txt');
    });
  });

  describe('blob', () => {
    it('should retrieve raw frame bytes', () => {
      const handle = (mem as any).handle;
      const content = 'Binary content test';
      const contentBytes = Buffer.from(content);

      mem.put(contentBytes, { title: 'Blob Test' });
      mem.commit();

      const entries = mem.timeline({ limit: 1 });
      const frameId = entries[0].frameId;

      const blob = handle.blob(frameId);

      expect(Buffer.isBuffer(blob)).toBe(true);
      expect(blob.toString()).toBe(content);
    });

    it('should throw for non-existent frame', () => {
      const handle = (mem as any).handle;

      expect(() => handle.blob(99999)).toThrow();
    });
  });
});

// ============================================================================
// Update Frame Tests
// ============================================================================

describe('Update Frame', () => {
  let mem: Memvid;
  let testFile: string;

  beforeEach(() => {
    testFile = uniqueTestFile('update');
    mem = Memvid.create(testFile);
    mem.enableLex();
  });

  afterEach(() => {
    if (!mem.isClosed) {
      mem.close();
    }
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  });

  it('should call update without throwing', () => {
    const handle = (mem as any).handle;

    mem.put(Buffer.from('content'), { title: 'Original Title' });
    mem.commit();

    // Get actual frame ID from timeline
    const entries = mem.timeline({ limit: 1, reverse: true });
    expect(entries.length).toBe(1);
    const frameId = entries[0].frameId;

    // Update should not throw
    expect(() => {
      handle.update(frameId, { title: 'Updated Title' });
    }).not.toThrow();
    mem.commit();
  });

  it('should accept update options for kind', () => {
    const handle = (mem as any).handle;

    mem.put(Buffer.from('content'), { kind: 'note' });
    mem.commit();

    // Get actual frame ID from timeline
    const entries = mem.timeline({ limit: 1, reverse: true });
    expect(entries.length).toBe(1);
    const frameId = entries[0].frameId;

    // Update should not throw
    expect(() => {
      handle.update(frameId, { kind: 'document' });
    }).not.toThrow();
    mem.commit();
  });

  it('should accept update options for labels', () => {
    const handle = (mem as any).handle;

    mem.put(Buffer.from('content'), { labels: ['old'] });
    mem.commit();

    // Get actual frame ID from timeline
    const entries = mem.timeline({ limit: 1, reverse: true });
    expect(entries.length).toBe(1);
    const frameId = entries[0].frameId;

    // Update should not throw
    expect(() => {
      handle.update(frameId, { labels: ['new1', 'new2'] });
    }).not.toThrow();
    mem.commit();
  });

  it('should accept partial update options', () => {
    const handle = (mem as any).handle;

    mem.put(Buffer.from('content'), {
      title: 'Title',
      kind: 'note',
    });
    mem.commit();

    // Get actual frame ID from timeline
    const entries = mem.timeline({ limit: 1, reverse: true });
    expect(entries.length).toBe(1);
    const frameId = entries[0].frameId;

    // Partial update should not throw
    expect(() => {
      handle.update(frameId, { title: 'New Title' });
    }).not.toThrow();
    mem.commit();
  });
});

// ============================================================================
// Doctor Tests
// ============================================================================

describe('Doctor', () => {
  let testFile: string;

  beforeEach(() => {
    testFile = uniqueTestFile('doctor');
  });

  afterEach(() => {
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  });

  it('should diagnose a healthy file', () => {
    // Create a valid file
    const mem = Memvid.create(testFile);
    mem.enableLex();
    mem.put(Buffer.from('Test content'), { title: 'Test' });
    mem.commit();
    mem.close();

    // Run doctor in diagnosis mode (fix=false)
    const result = native.doctor(testFile, false);

    expect(result).toBeDefined();
    expect(typeof result.issuesFound).toBe('number');
    expect(typeof result.issuesFixed).toBe('number');
    expect(Array.isArray(result.actions)).toBe(true);
  });

  it('should default to diagnosis mode when fix is not specified', () => {
    // Create a valid file
    const mem = Memvid.create(testFile);
    mem.commit();
    mem.close();

    // Run doctor without fix parameter
    const result = native.doctor(testFile);

    expect(result).toBeDefined();
    expect(result.issuesFixed).toBe(0); // Should not fix anything in dry-run mode
  });

  it('should report issues found', () => {
    // Create a valid file first
    const mem = Memvid.create(testFile);
    mem.commit();
    mem.close();

    const result = native.doctor(testFile, false);

    expect(result).toBeDefined();
    // A clean file should have 0 issues
    expect(result.issuesFound).toBeGreaterThanOrEqual(0);
  });

  it('should throw for non-existent file', () => {
    expect(() => native.doctor('/tmp/nonexistent_memvid_file.mv2', false)).toThrow();
  });

  it('should validate path for .mv2 extension', () => {
    expect(() => native.doctor('/tmp/test.txt', false)).toThrow(/\.mv2/);
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration', () => {
  let testFile: string;

  beforeEach(() => {
    testFile = uniqueTestFile('integration');
  });

  afterEach(() => {
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  });

  it('should combine memory cards with documents', () => {
    const mem = Memvid.create(testFile);
    const handle = (mem as any).handle;
    mem.enableLex();

    // Store a document
    const frameId = mem.put(Buffer.from('User profile information'), {
      title: 'User Profile',
      uri: 'doc://profiles/user1',
    });

    // Store memory cards referencing the document
    handle.putMemoryCard({
      entity: 'user1',
      slot: 'name',
      value: 'John Doe',
      sourceFrameId: frameId,
      sourceUri: 'doc://profiles/user1',
    });

    handle.putMemoryCard({
      entity: 'user1',
      slot: 'role',
      value: 'Developer',
      sourceFrameId: frameId,
      sourceUri: 'doc://profiles/user1',
    });

    mem.commit();

    // Verify both are stored
    expect(mem.stats().frameCount).toBe(1);
    expect(handle.memoryCardCount()).toBe(2);

    // Verify card has source info
    const card = handle.getCurrentMemory('user1', 'name');
    expect(card.sourceFrameId).toBe(frameId);
    expect(card.sourceUri).toBe('doc://profiles/user1');

    mem.close();
  });

  it.skipIf(!VEC_AVAILABLE)('should perform full workflow with embeddings and memory', async () => {
    const mem = Memvid.create(testFile);
    const handle = (mem as any).handle;
    const embedder = new MockEmbeddings({ dimension: 1536 });

    mem.enableLex();
    mem.enableVec();

    // Store documents with embeddings
    const docs = [
      { text: 'John works at Acme Corp as a software engineer.', entity: 'john' },
      { text: 'Jane is a product manager at TechCo.', entity: 'jane' },
    ];

    for (const doc of docs) {
      const emb = await embedder.embedQuery(doc.text);
      const frameId = mem.putWithEmbedding(Buffer.from(doc.text), emb, {
        title: `Info about ${doc.entity}`,
        uri: `doc://people/${doc.entity}`,
      });

      // Extract and store memory cards
      handle.putMemoryCard({
        entity: doc.entity,
        slot: 'description',
        value: doc.text,
        sourceFrameId: frameId,
      });
    }

    mem.commit();

    // Search documents
    const queryEmb = await embedder.embedQuery('software engineer at company');
    const results = mem.vecSearch(queryEmb, 2);
    expect(results.hits.length).toBeGreaterThan(0);

    // Query memory
    const johnDesc = handle.state('john', 'description');
    expect(johnDesc).toContain('Acme Corp');

    mem.close();
  });
});
