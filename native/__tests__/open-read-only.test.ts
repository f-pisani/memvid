/**
 * Read-only open tests for memvid-node
 *
 * Tests for shared-lock access:
 * - Memvid.openReadOnly()
 * - openReadOnly() helper
 * - Multiple read-only handles
 * - Cross-process lock contention
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';
import { Memvid, openReadOnly, openSnapshot } from '../dist/index.js';

const TEST_DIR = os.tmpdir();
const MODULE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'dist',
  'index.js',
);
const HELPER_SCRIPT = `
const fs = require('fs');
try {
  const { Memvid, openReadOnly } = require(process.env.MEMVID_MODULE);
  const mode = process.env.MEMVID_MODE;
  const filePath = process.env.MEMVID_PATH;
  const readyPath = process.env.MEMVID_READY;
  const releasePath = process.env.MEMVID_RELEASE;

  const mem = mode === 'shared' ? openReadOnly(filePath) : Memvid.open(filePath);
  fs.writeFileSync(readyPath, 'ready');
  const interval = setInterval(() => {
    if (fs.existsSync(releasePath)) {
      clearInterval(interval);
      mem.close();
      process.exit(0);
    }
  }, 25);
} catch (err) {
  console.error(err);
  process.exit(1);
}
`;

function uniqueTestFile(prefix: string = 'readonly'): string {
  return path.join(TEST_DIR, `memvid_${prefix}_${crypto.randomUUID()}.mv2`);
}

function uniqueSignalFile(prefix: string): string {
  return path.join(TEST_DIR, `memvid_${prefix}_${crypto.randomUUID()}`);
}

function spawnLockHolder(mode: 'shared' | 'exclusive', filePath: string) {
  const readyPath = uniqueSignalFile('ready');
  const releasePath = uniqueSignalFile('release');
  const child = spawn(process.execPath, ['-e', HELPER_SCRIPT], {
    env: {
      ...process.env,
      MEMVID_MODULE: MODULE_PATH,
      MEMVID_MODE: mode,
      MEMVID_PATH: filePath,
      MEMVID_READY: readyPath,
      MEMVID_RELEASE: releasePath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });
  return { child, readyPath, releasePath, stderr: () => stderr };
}

async function waitForFile(
  filePath: string,
  timeoutMs: number,
  child?: ReturnType<typeof spawn>,
  stderr?: () => string,
) {
  const start = Date.now();
  while (!fs.existsSync(filePath)) {
    if (child && child.exitCode !== null) {
      const output = stderr ? `\n${stderr()}` : '';
      throw new Error(`Lock holder exited early${output}`);
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${filePath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function waitForExit(child: ReturnType<typeof spawn>, timeoutMs: number) {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Timed out waiting for lock holder exit'));
    }, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

describe('openReadOnly', () => {
  let testFile: string;
  const signalFiles: string[] = [];

  beforeEach(() => {
    testFile = uniqueTestFile();
    const mem = Memvid.create(testFile);
    mem.put(Buffer.from('Hello read-only'), { title: 'Greeting' });
    mem.commit();
    mem.close();
  });

  afterEach(() => {
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
    while (signalFiles.length > 0) {
      const filePath = signalFiles.pop();
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  });

  it('opens via Memvid.openReadOnly and supports reads', () => {
    const mem = Memvid.openReadOnly(testFile);
    const stats = mem.stats();
    expect(stats.frameCount).toBeGreaterThanOrEqual(1);
    mem.close();
  });

  it('allows multiple read-only handles', () => {
    const mem1 = Memvid.openReadOnly(testFile);
    const mem2 = openReadOnly(testFile);
    const stats1 = mem1.stats();
    const stats2 = mem2.stats();
    expect(stats1.frameCount).toBe(stats2.frameCount);
    mem1.close();
    mem2.close();
  });

  it('allows shared open when another process holds shared lock', async () => {
    const holder = spawnLockHolder('shared', testFile);
    signalFiles.push(holder.readyPath, holder.releasePath);
    await waitForFile(holder.readyPath, 5000, holder.child, holder.stderr);

    const mem = Memvid.openReadOnly(testFile);
    expect(mem.stats().frameCount).toBeGreaterThanOrEqual(1);
    mem.close();

    fs.writeFileSync(holder.releasePath, 'release');
    await waitForExit(holder.child, 5000);
  });

  it('blocks exclusive open when another process holds shared lock', async () => {
    const holder = spawnLockHolder('shared', testFile);
    signalFiles.push(holder.readyPath, holder.releasePath);
    await waitForFile(holder.readyPath, 5000, holder.child, holder.stderr);

    let caught: unknown;
    try {
      const mem = Memvid.open(testFile);
      mem.close();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    if (caught && typeof caught === 'object' && 'code' in caught) {
      expect(String((caught as { code?: string }).code)).toMatch(/LOCK_ERROR|FILE_LOCKED/);
    }

    fs.writeFileSync(holder.releasePath, 'release');
    await waitForExit(holder.child, 5000);
  });

  it('blocks shared open when another process holds exclusive lock', async () => {
    const holder = spawnLockHolder('exclusive', testFile);
    signalFiles.push(holder.readyPath, holder.releasePath);
    await waitForFile(holder.readyPath, 5000, holder.child, holder.stderr);

    let caught: unknown;
    try {
      const mem = Memvid.openReadOnly(testFile);
      mem.close();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    if (caught && typeof caught === 'object' && 'code' in caught) {
      expect(String((caught as { code?: string }).code)).toMatch(/LOCK_ERROR|FILE_LOCKED/);
    }

    fs.writeFileSync(holder.releasePath, 'release');
    await waitForExit(holder.child, 5000);
  });

  it('allows snapshot open when another process holds exclusive lock', async () => {
    const holder = spawnLockHolder('exclusive', testFile);
    signalFiles.push(holder.readyPath, holder.releasePath);
    await waitForFile(holder.readyPath, 5000, holder.child, holder.stderr);

    const mem = openSnapshot(testFile);
    expect(mem.stats().frameCount).toBeGreaterThanOrEqual(1);
    mem.close();

    fs.writeFileSync(holder.releasePath, 'release');
    await waitForExit(holder.child, 5000);
  });

  it('keeps file size when snapshot readers are active during commit', () => {
    const baseSize = fs.statSync(testFile).size;
    const extendedSize = baseSize + 1024 * 1024;
    fs.truncateSync(testFile, extendedSize);

    const mem = Memvid.open(testFile);
    const snapshot = openSnapshot(testFile);
    mem.put(Buffer.from('Snapshot guard test'), { title: 'Snapshot' });
    mem.commit();

    const newSize = fs.statSync(testFile).size;
    expect(newSize).toBeGreaterThanOrEqual(extendedSize);

    snapshot.close();
    mem.close();
  });
});
