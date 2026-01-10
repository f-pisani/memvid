/**
 * Basic operations tests for memvid-node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { Memvid, create, open, version } from '../index.js';

const TEST_DIR = os.tmpdir();

/** Generate a unique test file path */
function uniqueTestFile(): string {
  return path.join(TEST_DIR, `memvid_basic_${crypto.randomUUID()}.mv2`);
}

describe('Basic Operations', () => {
  let testFile: string;

  beforeEach(() => {
    testFile = uniqueTestFile();
  });

  afterEach(() => {
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  });

  describe('version', () => {
    it('should return version string', () => {
      const v = version();
      expect(v).toBeDefined();
      expect(typeof v).toBe('string');
      expect(v).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('create', () => {
    it('should create a new memvid file', () => {
      const mem = create(testFile);
      expect(mem).toBeDefined();
      expect(mem.path).toBe(testFile);
      expect(fs.existsSync(testFile)).toBe(true);
    });

    it('should create via Memvid.create', () => {
      const mem = Memvid.create(testFile);
      expect(mem).toBeDefined();
      expect(mem.path).toBe(testFile);
    });
  });

  describe('open', () => {
    it('should open an existing file', () => {
      // First create
      const mem1 = create(testFile);
      mem1.commit();

      // Then open
      const mem2 = open(testFile);
      expect(mem2).toBeDefined();
      expect(mem2.path).toBe(testFile);
    });

    it('should throw for non-existent file', () => {
      expect(() => open('/tmp/nonexistent_memvid.mv2')).toThrow();
    });
  });

  describe('stats', () => {
    it('should return stats for empty file', () => {
      const mem = create(testFile);
      const stats = mem.stats();

      expect(stats.frameCount).toBe(0);
      expect(stats.activeFrameCount).toBe(0);
      expect(stats.sizeBytes).toBeGreaterThan(0);
      expect(typeof stats.hasLexIndex).toBe('boolean');
      expect(typeof stats.hasVecIndex).toBe('boolean');
    });

    it('should update stats after put', () => {
      const mem = create(testFile);
      mem.enableLex();
      mem.put(Buffer.from('Test content'), { title: 'Test' });
      mem.commit();

      const stats = mem.stats();
      expect(stats.frameCount).toBe(1);
      expect(stats.activeFrameCount).toBe(1);
      expect(stats.payloadBytes).toBeGreaterThan(0);
    });
  });

  describe('put and commit', () => {
    it('should store a document', () => {
      const mem = create(testFile);
      mem.enableLex();

      const frameId = mem.put(Buffer.from('Hello world'), {
        title: 'Greeting',
        uri: 'test://greeting/1',
      });

      expect(frameId).toBeGreaterThan(0);
    });

    it('should persist after commit', () => {
      const mem1 = create(testFile);
      mem1.enableLex();
      mem1.put(Buffer.from('Persistent content'), { title: 'Test' });
      mem1.commit();

      const mem2 = open(testFile);
      const stats = mem2.stats();
      expect(stats.frameCount).toBe(1);
    });

    it('should store multiple documents', () => {
      const mem = create(testFile);
      mem.enableLex();

      mem.put(Buffer.from('First document'), { title: 'First' });
      mem.put(Buffer.from('Second document'), { title: 'Second' });
      mem.put(Buffer.from('Third document'), { title: 'Third' });
      mem.commit();

      const stats = mem.stats();
      expect(stats.frameCount).toBe(3);
    });
  });

  describe('enableLex', () => {
    it('should enable lexical index', () => {
      const mem = create(testFile);

      // Initially may or may not have lex index
      mem.enableLex();

      const stats = mem.stats();
      expect(stats.hasLexIndex).toBe(true);
    });
  });

  describe('verify', () => {
    it('should verify a valid file', () => {
      const mem = create(testFile);
      mem.enableLex();
      mem.put(Buffer.from('Test content'), { title: 'Test' });
      mem.commit();

      const valid = mem.verify(false);
      expect(valid).toBe(true);
    });

    it('should support deep verification', () => {
      const mem = create(testFile);
      mem.commit();

      const valid = mem.verify(true);
      expect(valid).toBe(true);
    });
  });

  describe('close', () => {
    it('should close handle and release resources', () => {
      const mem = create(testFile);
      expect(mem.isClosed).toBe(false);

      mem.close();
      expect(mem.isClosed).toBe(true);
    });

    it('should fail operations after close', () => {
      const mem = create(testFile);
      mem.close();

      expect(() => mem.stats()).toThrow(/closed/i);
      expect(() => mem.put(Buffer.from('test'), {})).toThrow(/closed/i);
    });

    it('should allow multiple close calls', () => {
      const mem = create(testFile);
      mem.close();
      mem.close(); // Should not throw
      expect(mem.isClosed).toBe(true);
    });
  });

  describe('path validation', () => {
    it('should reject path traversal', () => {
      expect(() => create('/tmp/../etc/passwd.mv2')).toThrow(/traversal/i);
    });

    it('should reject non-.mv2 extension', () => {
      expect(() => create('/tmp/test.txt')).toThrow(/\.mv2 extension/i);
    });

    it('should reject null bytes', () => {
      expect(() => create('/tmp/test\x00.mv2')).toThrow(/null bytes/i);
    });

    it('should accept valid paths', () => {
      const mem = create(testFile);
      expect(mem).toBeDefined();
    });
  });
});
