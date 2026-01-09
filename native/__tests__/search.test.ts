/**
 * Search operations tests for memvid-node
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { Memvid } from '../dist/index.js';

const testFile = path.join(os.tmpdir(), `memvid_search_${crypto.randomUUID()}.mv2`);

describe('Search Operations', () => {
  let mem: Memvid;

  beforeAll(() => {
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }

    mem = Memvid.create(testFile);
    mem.enableLex();

    // Add test documents
    mem.put(Buffer.from('Artificial intelligence is transforming the world of technology.'), {
      title: 'AI Introduction',
      uri: 'doc://ai/intro',
    });
    mem.put(Buffer.from('Machine learning algorithms can learn patterns from data.'), {
      title: 'Machine Learning',
      uri: 'doc://ml/basics',
    });
    mem.put(Buffer.from('TypeScript adds static typing to JavaScript for better developer experience.'), {
      title: 'TypeScript Guide',
      uri: 'doc://typescript/guide',
    });
    mem.put(Buffer.from('Rust programming language focuses on memory safety and performance.'), {
      title: 'Rust Overview',
      uri: 'doc://rust/overview',
    });
    mem.put(Buffer.from('The Mediterranean diet includes olive oil, fish, and fresh vegetables.'), {
      title: 'Healthy Eating',
      uri: 'doc://health/diet',
    });

    mem.commit();
  });

  afterAll(() => {
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  });

  describe('find (lexical search)', () => {
    it('should find documents by keyword', () => {
      const results = mem.find('TypeScript', 10);

      expect(results.totalHits).toBeGreaterThan(0);
      expect(results.hits.length).toBeGreaterThan(0);
      expect(results.engine).toBe('Tantivy');
    });

    it('should return relevant snippets', () => {
      const results = mem.find('artificial intelligence', 5);

      expect(results.hits.length).toBeGreaterThan(0);
      expect(results.hits[0].text.toLowerCase()).toContain('artificial');
    });

    it('should respect topK limit', () => {
      const results = mem.find('the', 2);

      expect(results.hits.length).toBeLessThanOrEqual(2);
    });

    it('should return empty for non-matching query', () => {
      const results = mem.find('xyznonexistentword', 10);

      expect(results.totalHits).toBe(0);
      expect(results.hits.length).toBe(0);
    });

    it('should find by partial match', () => {
      const results = mem.find('memory', 10);

      expect(results.totalHits).toBeGreaterThan(0);
      // Should match "memory safety" in Rust doc
    });
  });

  describe('timeline', () => {
    it('should return timeline entries', () => {
      const entries = mem.timeline();

      expect(entries.length).toBe(5);
      entries.forEach(entry => {
        expect(entry.frameId).toBeDefined();
        expect(entry.timestamp).toBeGreaterThan(0);
        expect(entry.preview).toBeDefined();
      });
    });

    it('should respect limit option', () => {
      const entries = mem.timeline({ limit: 2 });

      expect(entries.length).toBe(2);
    });

    it('should support reverse order', () => {
      const normal = mem.timeline({ limit: 5 });
      const reversed = mem.timeline({ limit: 5, reverse: true });

      // Reversed should have different order
      expect(reversed[0].frameId).not.toBe(normal[0].frameId);
    });
  });

  describe('view', () => {
    it('should retrieve frame content', () => {
      const entries = mem.timeline({ limit: 1 });
      const frameId = entries[0].frameId;

      const content = mem.view(frameId);

      expect(content).toBeDefined();
      expect(content.length).toBeGreaterThan(0);
    });
  });

  describe('frame', () => {
    it('should retrieve frame metadata', () => {
      const entries = mem.timeline({ limit: 1 });
      const frameId = entries[0].frameId;

      const info = mem.frame(frameId);

      expect(info.id).toBe(frameId);
      expect(info.timestamp).toBeGreaterThan(0);
      expect(info.payloadLength).toBeGreaterThan(0);
    });

    it('should include title and uri', () => {
      const entries = mem.timeline({ limit: 1 });
      const frameId = entries[0].frameId;

      const info = mem.frame(frameId);

      expect(info.title).toBeDefined();
      expect(info.uri).toBeDefined();
    });
  });

  describe('delete', () => {
    it('should soft delete a frame', () => {
      // Create a separate file for delete test
      const deleteTestFile = path.join('/tmp', 'memvid_delete_test.mv2');
      if (fs.existsSync(deleteTestFile)) {
        fs.unlinkSync(deleteTestFile);
      }

      const deleteMem = Memvid.create(deleteTestFile);
      deleteMem.enableLex();
      deleteMem.put(Buffer.from('Test content to delete'), { title: 'Delete Me' });
      deleteMem.commit();

      const beforeStats = deleteMem.stats();
      expect(beforeStats.activeFrameCount).toBe(1);

      const entries = deleteMem.timeline({ limit: 1 });
      deleteMem.delete(entries[0].frameId);
      deleteMem.commit();

      const afterStats = deleteMem.stats();
      expect(afterStats.activeFrameCount).toBe(0);

      fs.unlinkSync(deleteTestFile);
    });
  });
});
