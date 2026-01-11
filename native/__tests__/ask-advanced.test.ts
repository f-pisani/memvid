/**
 * Advanced Ask (RAG Q&A) tests for memvid-node
 *
 * Tests for Ask API response structure and context retrieval.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Memvid } from '../dist/index.js';
import { uniqueTestFile, cleanupTestFile } from './test-utils.js';

describe('Ask Advanced - Combined Features', () => {
  let mem: Memvid;
  let testFile: string;

  beforeEach(() => {
    testFile = uniqueTestFile('combined');
    mem = Memvid.create(testFile);
    mem.enableLex();

    // Add documents with mixed content
    mem.put(Buffer.from('User profile: Alice Smith, email: alice@company.com, phone: 555-987-6543.'), {
      title: 'User Profile',
    });
    mem.put(Buffer.from('Alice is the team lead for the AI research group.'), {
      title: 'Role Info',
    });
    mem.commit();
  });

  afterEach(() => {
    mem.close();
    cleanupTestFile(testFile);
  });

  it('should retrieve context for questions', () => {
    const result = mem.ask({
      question: 'How can I contact the team lead?',
      topK: 5,
      contextOnly: true,
    });

    expect(result).toBeDefined();
    expect(result.question).toBe('How can I contact the team lead?');
    expect(result.contextOnly).toBe(true);
    expect(result.context).toBeDefined();
    expect(typeof result.context).toBe('string');
  });

  it('should return proper response structure with all fields', () => {
    const result = mem.ask({
      question: 'Who is Alice?',
      topK: 5,
      contextOnly: true,
    });

    // Check all response fields are present
    expect(result.question).toBe('Who is Alice?');
    expect(result.mode).toBeDefined();
    expect(result.retriever).toBeDefined();
    expect(result.contextOnly).toBe(true);
    expect(result.citations).toBeDefined();
    expect(result.contextFragments).toBeDefined();
    expect(result.context).toBeDefined();
    expect(result.totalHits).toBeDefined();
    expect(result.stats).toBeDefined();
    expect(result.stats.retrievalMs).toBeGreaterThanOrEqual(0);
    expect(result.stats.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
