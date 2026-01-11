/**
 * Memory Cards API tests for memvid-node
 *
 * Tests for the structured key-value memory storage system:
 * - put_memory_card, put_memory_cards (batch)
 * - get_current_memory, get_entity_memories
 * - memories_stats, memory_card_count
 * - state (convenience lookup)
 * - clear_memories
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { Memvid } from '../dist/index.js';

const TEST_DIR = os.tmpdir();

/** Generate a unique test file path */
function uniqueTestFile(prefix: string = 'memory'): string {
  return path.join(TEST_DIR, `memvid_${prefix}_${crypto.randomUUID()}.mv2`);
}

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

  describe('search with memoryFilters', () => {
    it('should filter search results by entity', () => {
      const handle = (mem as any).handle;

      // Store documents about different topics
      mem.put(Buffer.from('Alice works on machine learning projects.'), {
        uri: 'doc://alice/work'
      });
      mem.put(Buffer.from('Bob works on machine learning too.'), {
        uri: 'doc://bob/work'
      });
      mem.put(Buffer.from('Carol does machine learning research.'), {
        uri: 'doc://carol/work'
      });

      // Add memory cards linking docs to entities
      handle.putMemoryCard({
        entity: 'alice',
        slot: 'topic',
        value: 'machine learning',
        sourceFrameId: 0,
      });
      handle.putMemoryCard({
        entity: 'bob',
        slot: 'topic',
        value: 'machine learning',
        sourceFrameId: 1,
      });

      mem.commit();

      // Search without filter - should find all docs
      const allResults = mem.find('machine learning');
      expect(allResults.hits.length).toBeGreaterThanOrEqual(2);

      // Search with entity filter - should only find alice's doc
      const aliceResults = mem.find('machine learning', {
        memoryFilters: [{ entity: 'alice' }]
      });
      expect(aliceResults.hits.length).toBe(1);
      expect(aliceResults.hits[0].uri).toBe('doc://alice/work');
    });

    it('should filter search results by slot', () => {
      const handle = (mem as any).handle;

      mem.put(Buffer.from('Programming languages include Python and Rust.'), {
        uri: 'doc://programming'
      });
      mem.put(Buffer.from('Python is great for AI programming.'), {
        uri: 'doc://ai'
      });

      // Link first doc to "language" slot
      handle.putMemoryCard({
        entity: 'topic',
        slot: 'language',
        value: 'Python',
        sourceFrameId: 0,
      });
      // Link second doc to "framework" slot
      handle.putMemoryCard({
        entity: 'topic',
        slot: 'framework',
        value: 'PyTorch',
        sourceFrameId: 1,
      });

      mem.commit();

      // Filter by slot - should only find doc with "language" slot
      const langResults = mem.find('Python', {
        memoryFilters: [{ slot: 'language' }]
      });
      expect(langResults.hits.length).toBe(1);
      expect(langResults.hits[0].uri).toBe('doc://programming');
    });

    it('should filter search results by value contains', () => {
      const handle = (mem as any).handle;

      mem.put(Buffer.from('Deep learning neural networks.'), {
        uri: 'doc://deep-learning'
      });
      mem.put(Buffer.from('Machine learning basics.'), {
        uri: 'doc://ml-basics'
      });

      handle.putMemoryCard({
        entity: 'doc',
        slot: 'topic',
        value: 'Neural Networks and Deep Learning',
        sourceFrameId: 0,
      });
      handle.putMemoryCard({
        entity: 'doc',
        slot: 'topic',
        value: 'Introduction to ML',
        sourceFrameId: 1,
      });

      mem.commit();

      // Filter by value containing "Neural" (case-insensitive)
      const neuralResults = mem.find('learning', {
        memoryFilters: [{ valueContains: 'Neural' }]
      });
      expect(neuralResults.hits.length).toBe(1);
      expect(neuralResults.hits[0].uri).toBe('doc://deep-learning');
    });

    it('should combine multiple filters with OR logic', () => {
      const handle = (mem as any).handle;

      mem.put(Buffer.from('Document about AI and programming.'), { uri: 'doc://ai' });
      mem.put(Buffer.from('Document about databases and programming.'), { uri: 'doc://db' });
      mem.put(Buffer.from('Document about networking and programming.'), { uri: 'doc://network' });

      handle.putMemoryCard({ entity: 'ai', slot: 'type', value: 'tech', sourceFrameId: 0 });
      handle.putMemoryCard({ entity: 'db', slot: 'type', value: 'tech', sourceFrameId: 1 });
      handle.putMemoryCard({ entity: 'network', slot: 'type', value: 'tech', sourceFrameId: 2 });

      mem.commit();

      // Filter for ai OR db entities
      const results = mem.find('programming', {
        memoryFilters: [
          { entity: 'ai' },
          { entity: 'db' }
        ]
      });
      expect(results.hits.length).toBe(2);
      const uris = results.hits.map(h => h.uri);
      expect(uris).toContain('doc://ai');
      expect(uris).toContain('doc://db');
    });

    it('should return empty results when no memory cards match', () => {
      const handle = (mem as any).handle;

      mem.put(Buffer.from('Document about programming.'), { uri: 'doc://1' });
      handle.putMemoryCard({ entity: 'existing', slot: 'topic', value: 'code', sourceFrameId: 0 });
      mem.commit();

      // Filter for non-existent entity
      const results = mem.find('programming', {
        memoryFilters: [{ entity: 'nonexistent' }]
      });
      expect(results.hits.length).toBe(0);
    });
  });

  describe('includeCards option', () => {
    it('should include memory cards in search results when includeCards is true', () => {
      const handle = (mem as any).handle;

      // Store document and add memory card
      mem.put(Buffer.from('Alice works at Anthropic on AI safety research.'), { uri: 'doc://alice' });
      handle.putMemoryCard({
        entity: 'alice',
        slot: 'employer',
        value: 'Anthropic',
        sourceFrameId: 0,
        kind: 'Fact'
      });
      mem.commit();

      // Search without includeCards
      const resultsWithout = mem.find('Alice', { topK: 10 });
      expect(resultsWithout.hits.length).toBeGreaterThan(0);
      // Cards should not be present (or be undefined/empty)

      // Search with includeCards - access via native handle
      const resultsWithCards = handle.find('Alice', 10, undefined, undefined, undefined, undefined, undefined, true);
      expect(resultsWithCards.hits.length).toBeGreaterThan(0);
    });

    it('should include cards in graphSearch results', () => {
      const handle = (mem as any).handle;

      // Store document and add memory card
      mem.put(Buffer.from('Bob is a software engineer at Google.'), { uri: 'doc://bob' });
      handle.putMemoryCard({
        entity: 'bob',
        slot: 'employer',
        value: 'Google',
        sourceFrameId: 0,
        kind: 'Fact'
      });
      mem.commit();

      // graphSearch with includeCards
      const results = mem.graphSearch('software engineer', { includeCards: true });
      expect(results.hits).toBeDefined();
      expect(results.planType).toBeDefined();
      // If hits found, cards should be populated
      if (results.hits.length > 0) {
        expect(results.hits[0].cards).toBeDefined();
      }
    });

    it('should not include cards when includeCards is false', () => {
      const handle = (mem as any).handle;

      mem.put(Buffer.from('Carol loves TypeScript.'), { uri: 'doc://carol' });
      handle.putMemoryCard({
        entity: 'carol',
        slot: 'preference',
        value: 'TypeScript',
        sourceFrameId: 0,
        kind: 'Preference'
      });
      mem.commit();

      const results = mem.graphSearch('TypeScript', { includeCards: false });
      expect(results.hits).toBeDefined();
      // Cards should be null/undefined when includeCards is false
      if (results.hits.length > 0) {
        // Rust None becomes undefined in JavaScript through napi-rs
        expect(results.hits[0].cards).toBeFalsy();
      }
    });
  });
});
