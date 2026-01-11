/**
 * Shared test utilities for memvid-node tests
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { Memvid } from '../dist/index.js';

const TEST_DIR = os.tmpdir();

/**
 * Generate a unique test file path with an optional prefix for identification
 */
export function uniqueTestFile(prefix: string = 'test'): string {
  return path.join(TEST_DIR, `memvid_${prefix}_${crypto.randomUUID()}.mv2`);
}

/**
 * Generate a simple mock embedding vector
 */
export function mockEmbedding(dim: number = 128): number[] {
  return Array.from({ length: dim }, () => Math.random() * 2 - 1);
}

/**
 * Clean up a test file if it exists
 */
export function cleanupTestFile(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

/**
 * Check if vec feature is available by trying to enable it
 */
export function isVecAvailable(): boolean {
  const testPath = uniqueTestFile('vec_check');
  try {
    const mem = Memvid.create(testPath);
    mem.enableVec();
    mem.close();
    return true;
  } catch {
    return false;
  } finally {
    cleanupTestFile(testPath);
  }
}

/**
 * Create a memvid file with lex enabled for testing
 */
export function createTestMemvid(testFile: string): Memvid {
  const mem = Memvid.create(testFile);
  mem.enableLex();
  return mem;
}

/**
 * Safe close helper - closes memvid only if not already closed
 */
export function safeClose(mem: Memvid): void {
  if (!mem.isClosed) {
    mem.close();
  }
}
