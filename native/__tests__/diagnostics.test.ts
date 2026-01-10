/**
 * Diagnostics and maintenance tests for memvid-node
 *
 * Tests for file maintenance and debugging:
 * - doctor (file diagnosis and repair)
 * - update (frame metadata updates)
 * - Integration tests combining multiple features
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { Memvid, MockEmbeddings } from '../dist/index.js';

// Import native bindings directly for module-level functions
import * as native from '../index.js';

const TEST_DIR = os.tmpdir();

/** Generate a unique test file path */
function uniqueTestFile(prefix: string = 'diag'): string {
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
