/**
 * Batch Ingestion Example
 *
 * Demonstrates using putMany() for efficient batch document ingestion
 * with automatic embedding generation.
 *
 * Run: OPENAI_API_KEY=sk-... npx tsx examples/batch-ingestion.ts
 */

import { create, OpenAIEmbeddings, MockEmbeddings } from '../dist/index.js';
import type { EmbeddingProvider } from '../dist/index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

async function main() {
  // Use real embeddings if API key available, otherwise mock
  let embedder: EmbeddingProvider;
  const apiKey = process.env.OPENAI_API_KEY;

  if (apiKey) {
    embedder = new OpenAIEmbeddings({ apiKey });
    console.log('Using OpenAI embeddings\n');
  } else {
    embedder = new MockEmbeddings({ dimension: 1536 });
    console.log('Using mock embeddings (set OPENAI_API_KEY for real embeddings)\n');
  }

  // Create a temp file
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memvid-'));
  const filePath = path.join(tempDir, 'batch.mv2');

  console.log(`Creating memvid file: ${filePath}\n`);

  const mem = create(filePath);
  mem.enableLex();
  mem.enableVec();

  // Prepare batch of documents
  const documents = [
    { content: 'Redis is an in-memory data structure store used as a database and cache.', options: { title: 'Redis', kind: 'database' } },
    { content: 'PostgreSQL is a powerful open-source relational database system.', options: { title: 'PostgreSQL', kind: 'database' } },
    { content: 'MongoDB is a document-oriented NoSQL database for modern applications.', options: { title: 'MongoDB', kind: 'database' } },
    { content: 'React is a JavaScript library for building user interfaces.', options: { title: 'React', kind: 'frontend' } },
    { content: 'Vue.js is a progressive framework for building user interfaces.', options: { title: 'Vue.js', kind: 'frontend' } },
    { content: 'Express.js is a minimal web application framework for Node.js.', options: { title: 'Express', kind: 'backend' } },
    { content: 'FastAPI is a modern Python web framework for building APIs.', options: { title: 'FastAPI', kind: 'backend' } },
    { content: 'Docker containers package applications with their dependencies.', options: { title: 'Docker', kind: 'devops' } },
    { content: 'Kubernetes orchestrates containerized applications at scale.', options: { title: 'Kubernetes', kind: 'devops' } },
    { content: 'GitHub Actions automates CI/CD workflows directly in repositories.', options: { title: 'GitHub Actions', kind: 'devops' } },
  ];

  // Batch ingest with embeddings
  console.log(`Ingesting ${documents.length} documents...`);
  const startTime = Date.now();

  const result = await mem.putMany(documents, embedder);

  const elapsed = Date.now() - startTime;
  console.log(`\nCompleted in ${elapsed}ms`);
  console.log(`  Success: ${result.successCount}/${documents.length}`);
  console.log(`  Failures: ${result.failureCount}`);

  if (result.failureCount > 0) {
    console.log('\nFailed documents:');
    for (const r of result.results) {
      if (!r.success) {
        console.log(`  [${r.index}] ${documents[r.index].options.title}: ${r.error?.message}`);
      }
    }
  }

  // Commit
  mem.commit();

  // Show stored frame IDs
  console.log(`\nStored frame IDs: [${result.frameIds.join(', ')}]`);

  // Stats
  const stats = mem.stats();
  console.log(`\nStats:`);
  console.log(`  Frame count: ${stats.frameCount}`);
  console.log(`  Vector count: ${stats.vectorCount}`);
  console.log(`  File size: ${stats.sizeBytes} bytes`);

  // Quick search test
  console.log('\n--- Quick Search Test ---');

  // Text search
  console.log('\nText search for "database":');
  const lexResults = mem.find('database', 3);
  for (const hit of lexResults.hits) {
    console.log(`  [${hit.frameId}] ${hit.title}`);
  }

  // Vector search
  console.log('\nVector search for "web development frameworks":');
  const queryVec = await embedder.embedQuery('web development frameworks');
  const vecResults = mem.vecSearch(queryVec, 3);
  for (const hit of vecResults.hits) {
    console.log(`  [${hit.frameId}] ${hit.title} (distance: ${hit.score?.toFixed(4)})`);
  }

  // Clean up
  mem.close();
  fs.rmSync(tempDir, { recursive: true });
  console.log('\nDone! Temp files cleaned up.');
}

main().catch(console.error);
