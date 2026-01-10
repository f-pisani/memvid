/**
 * Basic Usage Example
 *
 * Demonstrates creating a memvid file, storing documents,
 * and performing text search.
 *
 * Run: npx tsx examples/basic-usage.ts
 */

import { create } from '../dist/index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

async function main() {
  // Create a temp file
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memvid-'));
  const filePath = path.join(tempDir, 'example.mv2');

  console.log(`Creating memvid file: ${filePath}\n`);

  // Create a new memvid file
  const mem = create(filePath);

  // Enable text search
  mem.enableLex();

  // Store some documents
  const docs = [
    { content: 'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.', title: 'TypeScript Intro' },
    { content: 'Rust is a systems programming language focused on safety and performance.', title: 'Rust Overview' },
    { content: 'Python is widely used for machine learning and data science applications.', title: 'Python ML' },
    { content: 'JavaScript runs in browsers and on servers with Node.js runtime.', title: 'JavaScript Everywhere' },
    { content: 'Go is designed for simplicity and efficient concurrent programming.', title: 'Go Concurrency' },
  ];

  console.log('Storing documents...');
  for (const doc of docs) {
    const frameId = mem.put(Buffer.from(doc.content), { title: doc.title });
    console.log(`  [${frameId}] ${doc.title}`);
  }

  // Commit to disk
  mem.commit();
  console.log('\nCommitted to disk.');

  // Get stats
  const stats = mem.stats();
  console.log(`\nStats:`);
  console.log(`  Frame count: ${stats.frameCount}`);
  console.log(`  File size: ${stats.sizeBytes} bytes`);
  console.log(`  Has lex index: ${stats.hasLexIndex}`);

  // Text search
  console.log('\n--- Text Search ---');
  const queries = ['JavaScript', 'programming language', 'machine learning'];

  for (const query of queries) {
    console.log(`\nQuery: "${query}"`);
    const results = mem.find(query, 3);
    console.log(`  Found ${results.totalHits} hits:`);
    for (const hit of results.hits) {
      console.log(`    - [${hit.frameId}] ${hit.title}: "${hit.text.substring(0, 50)}..." (score: ${hit.score?.toFixed(2)})`);
    }
  }

  // Timeline
  console.log('\n--- Timeline (newest first) ---');
  const timeline = mem.timeline({ limit: 5, reverse: true });
  for (const entry of timeline) {
    const date = new Date(entry.timestamp).toISOString();
    console.log(`  [${entry.frameId}] ${date}: ${entry.preview.substring(0, 40)}...`);
  }

  // View a specific frame
  console.log('\n--- View Frame 0 ---');
  const content = mem.view(0);
  console.log(`  Content: ${content}`);

  // Frame metadata
  const frameInfo = mem.frame(0);
  console.log(`  Title: ${frameInfo.title}`);
  console.log(`  Payload: ${frameInfo.payloadLength} bytes`);

  // Clean up
  mem.close();
  fs.rmSync(tempDir, { recursive: true });
  console.log('\nDone! Temp files cleaned up.');
}

main().catch(console.error);
