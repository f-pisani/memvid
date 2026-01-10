/**
 * Advanced features tests for memvid-node
 *
 * Tests for:
 * - ask() - RAG Q&A
 * - graphSearch() - Graph-aware search
 * - Enrichment - Background processing
 * - PII masking - Privacy protection
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { Memvid, maskPii, containsPii } from '../dist/index.js';

const TEST_DIR = os.tmpdir();

/** Generate a unique test file path */
function uniqueTestFile(prefix: string = 'adv'): string {
  return path.join(TEST_DIR, `memvid_${prefix}_${crypto.randomUUID()}.mv2`);
}

/** Get native handle for advanced methods */
function getHandle(mem: Memvid): any {
  return (mem as any).handle;
}

describe('PII Masking', () => {
  it('should mask email addresses', () => {
    const text = 'Contact john@example.com for help';
    const masked = maskPii(text);
    expect(masked).toBe('Contact [EMAIL] for help');
    expect(masked).not.toContain('john@example.com');
  });

  it('should mask phone numbers', () => {
    const text = 'Call me at 555-123-4567';
    const masked = maskPii(text);
    expect(masked).toBe('Call me at [PHONE]');
  });

  it('should mask SSN', () => {
    const text = 'SSN: 123-45-6789';
    const masked = maskPii(text);
    expect(masked).toContain('[SSN]');
    expect(masked).not.toContain('123-45-6789');
  });

  it('should mask credit card numbers', () => {
    const text = 'Card: 4111-1111-1111-1111';
    const masked = maskPii(text);
    expect(masked).toContain('[CREDIT_CARD]');
  });

  it('should mask IP addresses', () => {
    const text = 'Server at 192.168.1.1';
    const masked = maskPii(text);
    expect(masked).toContain('[IP_ADDRESS]');
  });

  it('should detect PII with containsPii', () => {
    expect(containsPii('john@example.com')).toBe(true);
    expect(containsPii('555-123-4567')).toBe(true);
    expect(containsPii('Hello world')).toBe(false);
  });

  it('should mask multiple PII types', () => {
    const text = 'Email: test@test.com, Phone: 555-1234';
    const masked = maskPii(text);
    expect(masked).toContain('[EMAIL]');
    expect(masked).toContain('[PHONE]');
  });
});

describe('Ask (RAG Q&A)', () => {
  let mem: Memvid;
  let testFile: string;

  beforeEach(() => {
    testFile = uniqueTestFile('ask');
    mem = Memvid.create(testFile);
    mem.enableLex();

    // Add some test documents
    mem.put(Buffer.from('Paris is the capital of France. It is known for the Eiffel Tower.'), {
      title: 'France Facts',
    });
    mem.put(Buffer.from('Berlin is the capital of Germany. It is known for the Brandenburg Gate.'), {
      title: 'Germany Facts',
    });
    mem.put(Buffer.from('Tokyo is the capital of Japan. It is known for its technology and culture.'), {
      title: 'Japan Facts',
    });
    mem.commit();
  });

  afterEach(() => {
    mem.close();
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  });

  it('should answer questions using lexical search', () => {
    const handle = getHandle(mem);

    const result = handle.ask({
      question: 'What is the capital of France?',
      topK: 5,
      contextOnly: true,
    });

    expect(result).toBeDefined();
    expect(result.context).toBeDefined();
    // Should find Paris in the context
    expect(result.context.toLowerCase()).toContain('paris');
  });

  it('should return citations', () => {
    const handle = getHandle(mem);

    const result = handle.ask({
      question: 'capital of Germany',
      topK: 3,
      contextOnly: true,
    });

    expect(result.citations).toBeDefined();
    expect(Array.isArray(result.citations)).toBe(true);
  });

  it('should return stats', () => {
    const handle = getHandle(mem);

    const result = handle.ask({
      question: 'Eiffel Tower',
      topK: 5,
    });

    expect(result.stats).toBeDefined();
    expect(result.stats.retrievalMs).toBeGreaterThanOrEqual(0);
  });

  it('should support snippet_chars option', () => {
    const handle = getHandle(mem);

    const result = handle.ask({
      question: 'Tokyo',
      topK: 5,
      snippetChars: 50,
    });

    expect(result).toBeDefined();
  });
});

describe('Graph Search', () => {
  let mem: Memvid;
  let testFile: string;

  beforeEach(() => {
    testFile = uniqueTestFile('graph');
    mem = Memvid.create(testFile);
    mem.enableLex();

    const handle = getHandle(mem);

    // Add documents
    mem.put(Buffer.from('Alice works at Google as a software engineer.'), {
      title: 'Alice Profile',
    });
    mem.put(Buffer.from('Bob works at Microsoft as a product manager.'), {
      title: 'Bob Profile',
    });

    // Add memory cards for entities
    handle.putMemoryCard({
      entity: 'alice',
      slot: 'workplace',
      value: 'Google',
      kind: 'fact',
    });
    handle.putMemoryCard({
      entity: 'bob',
      slot: 'workplace',
      value: 'Microsoft',
      kind: 'fact',
    });

    mem.commit();
  });

  afterEach(() => {
    mem.close();
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  });

  it('should perform graph search', () => {
    const handle = getHandle(mem);

    const result = handle.graphSearch('who works at Google', { topK: 5 });

    expect(result).toBeDefined();
    expect(result.hits).toBeDefined();
    expect(result.planType).toBeDefined();
  });

  it('should return plan metadata', () => {
    const handle = getHandle(mem);

    const result = handle.graphSearch('software engineer', { topK: 5 });

    expect(result.usesGraph).toBeDefined();
    expect(result.usesVector).toBeDefined();
    expect(result.totalHits).toBeDefined();
  });

  it('should detect entity queries', () => {
    const handle = getHandle(mem);

    // This query should trigger entity pattern detection
    const result = handle.graphSearch('who works at Microsoft', { topK: 10 });

    expect(result).toBeDefined();
    // Should have detected the entity pattern
    expect(result.planType).toBeDefined();
  });
});

describe('Enrichment', () => {
  let mem: Memvid;
  let testFile: string;

  beforeEach(() => {
    testFile = uniqueTestFile('enrich');
    mem = Memvid.create(testFile);
    mem.enableLex();
  });

  afterEach(() => {
    mem.close();
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  });

  it('should return enrichment stats', () => {
    const handle = getHandle(mem);

    const stats = handle.enrichmentStats();

    expect(stats).toBeDefined();
    expect(stats.totalFrames).toBeDefined();
    expect(stats.enrichedFrames).toBeDefined();
    expect(stats.pendingFrames).toBeDefined();
  });

  it('should return enrichment queue length', () => {
    const handle = getHandle(mem);

    const queueLen = handle.enrichmentQueueLen();

    expect(typeof queueLen).toBe('number');
    expect(queueLen).toBeGreaterThanOrEqual(0);
  });

  it('should check for pending enrichment', () => {
    const handle = getHandle(mem);

    const hasPending = handle.hasPendingEnrichment();

    expect(typeof hasPending).toBe('boolean');
  });

  it('should process all enrichment', () => {
    const handle = getHandle(mem);

    // Add a document
    mem.put(Buffer.from('Test document for enrichment'), { title: 'Test' });
    mem.commit();

    const processed = handle.processAllEnrichment();

    expect(typeof processed).toBe('number');
    expect(processed).toBeGreaterThanOrEqual(0);
  });

  it('should mark frame as enriched', () => {
    const handle = getHandle(mem);

    // Add a document
    const frameId = mem.put(Buffer.from('Test document'), { title: 'Test' });
    mem.commit();

    // Should not throw
    expect(() => {
      handle.markFrameEnriched(frameId);
    }).not.toThrow();
  });
});
