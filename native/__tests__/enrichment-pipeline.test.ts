/**
 * Enrichment Pipeline tests for memvid-node
 *
 * Tests for:
 * - enrichmentStats() - Get enrichment statistics
 * - enrichmentQueue() - Get the enrichment queue
 * - processEnrichmentBatch(batchSize) - Process a batch of enrichments
 * - hasPendingEnrichment() - Check for pending tasks
 * - enrichmentQueueLength() - Get queue length
 * - processAllEnrichment() - Process all pending tasks
 * - markFrameEnriched() - Mark a frame as enriched
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { Memvid } from '../dist/index.js';

const TEST_DIR = os.tmpdir();

/** Generate a unique test file path */
function uniqueTestFile(prefix: string = 'enrich'): string {
  return path.join(TEST_DIR, `memvid_${prefix}_${crypto.randomUUID()}.mv2`);
}

describe('Enrichment Stats', () => {
  let mem: Memvid;
  let testFile: string;

  beforeEach(() => {
    testFile = uniqueTestFile('stats');
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

  it('should return enrichment stats for empty file', () => {
    const stats = mem.enrichmentStats();

    expect(stats).toBeDefined();
    expect(typeof stats.totalFrames).toBe('number');
    expect(typeof stats.enrichedFrames).toBe('number');
    expect(typeof stats.pendingFrames).toBe('number');
    expect(typeof stats.skimmedFrames).toBe('number');

    // Empty file should have no frames
    expect(stats.totalFrames).toBe(0);
    expect(stats.enrichedFrames).toBe(0);
    expect(stats.pendingFrames).toBe(0);
    expect(stats.skimmedFrames).toBe(0);
  });

  it('should return enrichment stats after adding documents', () => {
    // Add some documents
    mem.put(Buffer.from('Document one'), { title: 'Doc 1' });
    mem.put(Buffer.from('Document two'), { title: 'Doc 2' });
    mem.put(Buffer.from('Document three'), { title: 'Doc 3' });
    mem.commit();

    const stats = mem.enrichmentStats();

    expect(stats).toBeDefined();
    expect(stats.totalFrames).toBe(3);
    // Exact counts depend on enrichment implementation
    expect(stats.enrichedFrames + stats.pendingFrames + stats.skimmedFrames).toBeLessThanOrEqual(
      stats.totalFrames
    );
  });

  it('should update stats after processing enrichment', () => {
    mem.put(Buffer.from('Test document for enrichment'), { title: 'Test' });
    mem.commit();

    const before = mem.enrichmentStats();

    // Process any pending enrichment
    mem.processAllEnrichment();
    mem.commit();

    const after = mem.enrichmentStats();

    expect(after.totalFrames).toBe(before.totalFrames);
    // After processing, more frames should be enriched
    expect(after.enrichedFrames).toBeGreaterThanOrEqual(before.enrichedFrames);
  });
});

describe('Enrichment Queue', () => {
  let mem: Memvid;
  let testFile: string;

  beforeEach(() => {
    testFile = uniqueTestFile('queue');
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

  it('should return empty queue for new file', () => {
    const queue = mem.enrichmentQueue();

    expect(queue).toBeDefined();
    expect(Array.isArray(queue)).toBe(true);
    expect(queue.length).toBe(0);
  });

  it('should return queue with correct task structure', () => {
    // Add documents
    mem.put(Buffer.from('Document one'), { title: 'Doc 1' });
    mem.commit();

    const queue = mem.enrichmentQueue();

    // Queue may or may not have tasks depending on implementation
    expect(Array.isArray(queue)).toBe(true);

    // If there are tasks, verify structure
    for (const task of queue) {
      expect(typeof task.frameId).toBe('number');
      expect(typeof task.createdAt).toBe('number');
      expect(typeof task.chunksDone).toBe('number');
      expect(typeof task.chunksTotal).toBe('number');
    }
  });

  it('should sync with enrichmentQueueLength', () => {
    mem.put(Buffer.from('Test document'), { title: 'Test' });
    mem.commit();

    const queue = mem.enrichmentQueue();
    const length = mem.enrichmentQueueLength();

    expect(queue.length).toBe(length);
  });

  it('should sync with hasPendingEnrichment', () => {
    const queue = mem.enrichmentQueue();
    const hasPending = mem.hasPendingEnrichment();

    expect(hasPending).toBe(queue.length > 0);
  });
});

describe('Process Enrichment Batch', () => {
  let mem: Memvid;
  let testFile: string;

  beforeEach(() => {
    testFile = uniqueTestFile('batch');
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

  it('should process batch with correct result structure', () => {
    // Add documents
    mem.put(Buffer.from('Document one for batch processing'), { title: 'Doc 1' });
    mem.put(Buffer.from('Document two for batch processing'), { title: 'Doc 2' });
    mem.commit();

    const result = mem.processEnrichmentBatch(10);

    expect(result).toBeDefined();
    expect(typeof result.tasksProcessed).toBe('number');
    expect(typeof result.tasksSucceeded).toBe('number');
    expect(typeof result.tasksFailed).toBe('number');
    expect(Array.isArray(result.enrichedFrameIds)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);

    // Invariant: processed = succeeded + failed
    expect(result.tasksProcessed).toBe(result.tasksSucceeded + result.tasksFailed);
  });

  it('should respect batch size limit', () => {
    // Add many documents
    for (let i = 0; i < 10; i++) {
      mem.put(Buffer.from(`Document ${i} for batch limit test`), { title: `Doc ${i}` });
    }
    mem.commit();

    // Process only 3 at a time
    const result = mem.processEnrichmentBatch(3);

    // Should process at most 3 (or fewer if less pending)
    expect(result.tasksProcessed).toBeLessThanOrEqual(3);
  });

  it('should handle zero batch size', () => {
    mem.put(Buffer.from('Test document'), { title: 'Test' });
    mem.commit();

    const result = mem.processEnrichmentBatch(0);

    expect(result.tasksProcessed).toBe(0);
    expect(result.tasksSucceeded).toBe(0);
    expect(result.tasksFailed).toBe(0);
  });

  it('should reduce queue after processing', () => {
    mem.put(Buffer.from('Test document'), { title: 'Test' });
    mem.commit();

    const before = mem.enrichmentQueueLength();

    // Process all pending
    const result = mem.processEnrichmentBatch(100);

    const after = mem.enrichmentQueueLength();

    // Queue should be smaller by the number of successfully processed tasks
    expect(after).toBe(before - result.tasksSucceeded);
  });

  it('should reject negative batch size', () => {
    expect(() => {
      mem.processEnrichmentBatch(-1);
    }).toThrow();
  });

  it('should reject non-integer batch size', () => {
    expect(() => {
      mem.processEnrichmentBatch(1.5);
    }).toThrow();
  });
});

describe('Process All Enrichment', () => {
  let mem: Memvid;
  let testFile: string;

  beforeEach(() => {
    testFile = uniqueTestFile('all');
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

  it('should process all pending tasks', () => {
    // Add documents
    mem.put(Buffer.from('Document one'), { title: 'Doc 1' });
    mem.put(Buffer.from('Document two'), { title: 'Doc 2' });
    mem.commit();

    const processed = mem.processAllEnrichment();

    expect(typeof processed).toBe('number');
    expect(processed).toBeGreaterThanOrEqual(0);

    // After processing all, queue should be empty
    expect(mem.hasPendingEnrichment()).toBe(false);
    expect(mem.enrichmentQueueLength()).toBe(0);
  });

  it('should return 0 for empty queue', () => {
    const processed = mem.processAllEnrichment();

    expect(processed).toBe(0);
  });
});

describe('Mark Frame Enriched', () => {
  let mem: Memvid;
  let testFile: string;

  beforeEach(() => {
    testFile = uniqueTestFile('mark');
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

  it('should mark frame as enriched', () => {
    // Add a document and get its frame ID
    const frameId = mem.put(Buffer.from('Test document to mark'), { title: 'Test' });
    mem.commit();

    // Should not throw
    expect(() => {
      mem.markFrameEnriched(frameId);
    }).not.toThrow();
  });

  it('should handle non-existent frame gracefully', () => {
    // Mark a frame that doesn't exist - should not throw
    expect(() => {
      mem.markFrameEnriched(999999);
    }).not.toThrow();
  });
});

describe('Integration: Enrichment Workflow', () => {
  let testFile: string;

  beforeEach(() => {
    testFile = uniqueTestFile('workflow');
  });

  afterEach(() => {
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  });

  it('should handle full enrichment workflow', () => {
    const mem = Memvid.create(testFile);
    mem.enableLex();

    // Add multiple documents
    mem.put(Buffer.from('First document about cats'), { title: 'Cats' });
    mem.put(Buffer.from('Second document about dogs'), { title: 'Dogs' });
    mem.put(Buffer.from('Third document about birds'), { title: 'Birds' });
    mem.commit();

    // Check initial state
    const initialStats = mem.enrichmentStats();
    expect(initialStats.totalFrames).toBe(3);

    // Check queue
    const queue = mem.enrichmentQueue();
    expect(Array.isArray(queue)).toBe(true);

    // Process in batches
    let totalProcessed = 0;
    while (mem.hasPendingEnrichment()) {
      const result = mem.processEnrichmentBatch(2);
      totalProcessed += result.tasksProcessed;
    }

    // Commit changes
    mem.commit();

    // Check final state
    const finalStats = mem.enrichmentStats();
    expect(finalStats.pendingFrames).toBe(0);

    // Search should still work
    const results = mem.find('cats');
    expect(results.hits.length).toBeGreaterThan(0);

    mem.close();
  });

  it('should persist enrichment state across reopen', () => {
    // Create and populate
    let mem = Memvid.create(testFile);
    mem.enableLex();

    mem.put(Buffer.from('Document to enrich'), { title: 'Test' });
    mem.commit();

    // Process enrichment
    mem.processAllEnrichment();
    mem.commit();

    const statsBeforeClose = mem.enrichmentStats();
    mem.close();

    // Reopen and verify
    mem = Memvid.open(testFile);

    const statsAfterReopen = mem.enrichmentStats();
    expect(statsAfterReopen.totalFrames).toBe(statsBeforeClose.totalFrames);
    expect(statsAfterReopen.enrichedFrames).toBe(statsBeforeClose.enrichedFrames);

    mem.close();
  });
});
