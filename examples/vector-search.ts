/**
 * Vector Search Example
 *
 * Demonstrates semantic search using vector embeddings.
 * Requires OPENAI_API_KEY environment variable.
 *
 * Run: OPENAI_API_KEY=sk-... npx tsx examples/vector-search.ts
 */

import { create, OpenAIEmbeddings } from '@fpisani/memvid';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

async function main() {
  // Check for API key
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('Error: OPENAI_API_KEY environment variable is required');
    console.error('Run: OPENAI_API_KEY=sk-... npx tsx examples/vector-search.ts');
    process.exit(1);
  }

  // Create embedder
  const embedder = new OpenAIEmbeddings({
    apiKey,
    model: 'text-embedding-3-small',
  });
  console.log(`Using model: text-embedding-3-small (${embedder.dimension} dimensions)\n`);

  // Create a temp file
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memvid-'));
  const filePath = path.join(tempDir, 'vectors.mv2');

  console.log(`Creating memvid file: ${filePath}\n`);

  // Create memvid with vector index
  const mem = create(filePath);
  mem.enableVec();

  // Knowledge base
  const docs = [
    { content: 'Neural networks are computing systems inspired by biological neural networks in the brain.', title: 'Neural Networks' },
    { content: 'Machine learning is a subset of AI that enables systems to learn from data.', title: 'Machine Learning' },
    { content: 'Deep learning uses multiple layers of neural networks to process complex patterns.', title: 'Deep Learning' },
    { content: 'Natural language processing enables computers to understand human language.', title: 'NLP' },
    { content: 'Computer vision allows machines to interpret and understand visual information.', title: 'Computer Vision' },
    { content: 'Reinforcement learning trains agents through rewards and penalties.', title: 'Reinforcement Learning' },
    { content: 'Transfer learning reuses pre-trained models for new but related tasks.', title: 'Transfer Learning' },
    { content: 'Generative AI creates new content like text, images, and music.', title: 'Generative AI' },
  ];

  // Generate embeddings and store
  console.log('Generating embeddings and storing documents...');
  for (const doc of docs) {
    const embedding = await embedder.embedQuery(doc.content);
    const frameId = mem.putWithEmbedding(
      Buffer.from(doc.content),
      embedding,
      { title: doc.title }
    );
    console.log(`  [${frameId}] ${doc.title}`);
  }

  mem.commit();
  console.log('\nCommitted to disk.');

  // Stats
  const stats = mem.stats();
  console.log(`  Vector count: ${stats.vectorCount}`);
  console.log(`  Has vec index: ${stats.hasVecIndex}`);

  // Semantic queries
  console.log('\n--- Semantic Search ---');
  const queries = [
    'How do computers understand images?',
    'What is the relationship between AI and learning?',
    'How can we create new content with AI?',
    'Brain-inspired computing systems',
  ];

  for (const query of queries) {
    console.log(`\nQuery: "${query}"`);
    const queryVec = await embedder.embedQuery(query);
    const results = mem.vecSearch(queryVec, 3);

    for (const hit of results.hits) {
      const distance = hit.score?.toFixed(4) ?? 'N/A';
      console.log(`  [${hit.frameId}] ${hit.title} (distance: ${distance})`);
      console.log(`      "${hit.text.substring(0, 60)}..."`);
    }
  }

  // Clean up
  mem.close();
  fs.rmSync(tempDir, { recursive: true });
  console.log('\nDone! Temp files cleaned up.');
}

main().catch(console.error);
