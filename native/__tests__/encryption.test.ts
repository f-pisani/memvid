/**
 * Encryption tests for memvid-node
 *
 * Tests for file encryption and decryption:
 * - lock (encrypt a file)
 * - unlock (decrypt a file)
 * - Error handling for invalid passwords
 * - Error handling for invalid paths
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { Memvid, lock, unlock, MemvidError } from '../dist/index.js';

const TEST_DIR = os.tmpdir();

/** Generate a unique test file path */
function uniqueTestFile(prefix: string = 'enc'): string {
  return path.join(TEST_DIR, `memvid_${prefix}_${crypto.randomUUID()}.mv2`);
}

describe('Encryption', () => {
  let testFile: string;
  let encryptedFile: string;
  const PASSWORD = 'test-password-123!';

  beforeEach(() => {
    testFile = uniqueTestFile();
    encryptedFile = testFile.replace('.mv2', '.mv2e');
  });

  afterEach(() => {
    // Clean up test files
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
    if (fs.existsSync(encryptedFile)) {
      fs.unlinkSync(encryptedFile);
    }
    // Also clean up decrypted file if different
    const decryptedFile = encryptedFile.replace('.mv2e', '.mv2');
    if (decryptedFile !== testFile && fs.existsSync(decryptedFile)) {
      fs.unlinkSync(decryptedFile);
    }
  });

  describe('lock()', () => {
    it('should encrypt a file and return encrypted path', () => {
      // Create a file with some content
      const mem = Memvid.create(testFile);
      mem.enableLex();
      mem.put(Buffer.from('Secret data'), { title: 'Secret' });
      mem.commit();
      mem.close();

      // Encrypt it
      const result = lock(testFile, PASSWORD);

      // Should return the encrypted file path
      expect(result).toContain('.mv2e');
      expect(fs.existsSync(result)).toBe(true);
    });

    it('should reject empty password', () => {
      const mem = Memvid.create(testFile);
      mem.commit();
      mem.close();

      expect(() => lock(testFile, '')).toThrow();
    });

    it('should reject non-existent file', () => {
      const fakePath = path.join(TEST_DIR, 'nonexistent.mv2');
      expect(() => lock(fakePath, PASSWORD)).toThrow();
    });

    it('should reject invalid extension', () => {
      const invalidPath = path.join(TEST_DIR, 'file.txt');
      fs.writeFileSync(invalidPath, 'test');
      try {
        expect(() => lock(invalidPath, PASSWORD)).toThrow();
      } finally {
        fs.unlinkSync(invalidPath);
      }
    });
  });

  describe('unlock()', () => {
    it('should decrypt a file and return decrypted path', () => {
      // Create and encrypt a file
      const mem = Memvid.create(testFile);
      mem.enableLex();
      mem.put(Buffer.from('Secret data'), { title: 'Secret' });
      mem.commit();
      mem.close();

      const encrypted = lock(testFile, PASSWORD);

      // Remove the original to prove we're reading from decrypted
      fs.unlinkSync(testFile);

      // Decrypt it
      const decrypted = unlock(encrypted, PASSWORD);

      // Should return the decrypted file path
      expect(decrypted).toContain('.mv2');
      expect(decrypted).not.toContain('.mv2e');
      expect(fs.existsSync(decrypted)).toBe(true);

      // Should be able to open and read the decrypted file
      const reopened = Memvid.open(decrypted);

      // Verify file was properly decrypted by checking stats
      const stats = reopened.stats();
      expect(stats.frameCount).toBeGreaterThan(0);

      reopened.close();
    });

    it('should reject wrong password', () => {
      // Create and encrypt a file
      const mem = Memvid.create(testFile);
      mem.commit();
      mem.close();

      const encrypted = lock(testFile, PASSWORD);

      // Try to decrypt with wrong password
      expect(() => unlock(encrypted, 'wrong-password')).toThrow();
    });

    it('should reject empty password', () => {
      const mem = Memvid.create(testFile);
      mem.commit();
      mem.close();

      const encrypted = lock(testFile, PASSWORD);

      expect(() => unlock(encrypted, '')).toThrow();
    });

    it('should reject non-existent file', () => {
      const fakePath = path.join(TEST_DIR, 'nonexistent.mv2e');
      expect(() => unlock(fakePath, PASSWORD)).toThrow();
    });
  });

  describe('Round-trip', () => {
    it('should preserve data through encrypt/decrypt cycle', () => {
      // Create file with multiple documents
      const mem = Memvid.create(testFile);
      mem.enableLex();
      mem.put(Buffer.from('Document 1'), { title: 'First' });
      mem.put(Buffer.from('Document 2'), { title: 'Second' });
      mem.put(Buffer.from('Document 3'), { title: 'Third' });
      mem.commit();

      const originalStats = mem.stats();
      mem.close();

      // Encrypt
      const encrypted = lock(testFile, PASSWORD);
      fs.unlinkSync(testFile);

      // Decrypt
      const decrypted = unlock(encrypted, PASSWORD);

      // Verify data integrity
      const reopened = Memvid.open(decrypted);
      const newStats = reopened.stats();

      expect(newStats.frameCount).toBe(originalStats.frameCount);
      expect(newStats.activeFrameCount).toBe(originalStats.activeFrameCount);

      // Verify timeline shows all documents
      const timeline = reopened.timeline({ limit: 10 });
      expect(timeline.length).toBe(3);

      reopened.close();
    });
  });

  describe('Error Types', () => {
    it('should throw MemvidError with proper code for invalid path', () => {
      try {
        lock('/nonexistent/path/file.mv2', PASSWORD);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(MemvidError);
        expect((error as MemvidError).code).toBeDefined();
      }
    });

    it('should throw MemvidError with proper code for wrong password', () => {
      const mem = Memvid.create(testFile);
      mem.commit();
      mem.close();

      const encrypted = lock(testFile, PASSWORD);

      try {
        unlock(encrypted, 'wrong');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(MemvidError);
      }
    });
  });
});
