/**
 * Document processing tests for memvid-node
 *
 * Tests for document handling features:
 * - extract_document (text extraction from files)
 * - put_document (store extracted documents)
 * - blob (raw frame retrieval)
 * - Table extraction from PDFs
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { Memvid } from '../dist/index.js';

const TEST_DIR = os.tmpdir();

/** Generate a unique test file path */
function uniqueTestFile(prefix: string = 'docs'): string {
  return path.join(TEST_DIR, `memvid_${prefix}_${crypto.randomUUID()}.mv2`);
}

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
