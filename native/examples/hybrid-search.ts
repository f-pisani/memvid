/**
 * Hybrid Search Example
 *
 * This example demonstrates how to combine lexical (text) search
 * with vector (semantic) search for more accurate retrieval.
 *
 * Key concepts:
 * - Lexical search (find): Exact keyword matching using Tantivy
 * - Vector search (vecSearch): Semantic similarity using embeddings
 * - Hybrid search: Combines both for best results
 * - Adaptive retrieval: Dynamic cutoff based on score distribution
 *
 * Why hybrid search matters:
 * - Lexical catches exact matches that vectors might miss
 * - Vectors catch semantic meaning that keywords might miss
 * - Combined, they provide more robust retrieval
 */

import { create, OpenAIEmbeddings, MockEmbeddings } from '@fpisani/memvid';
import type { EmbeddingProvider } from '@fpisani/memvid';
import * as fs from 'fs';

// Helper to access native handle
function getHandle(mem: any): any {
  return mem.handle || mem;
}

// Use MockEmbeddings for demo (replace with OpenAIEmbeddings for production)
function getEmbedder(): EmbeddingProvider {
  // For production, use:
  // return new OpenAIEmbeddings({ apiKey: process.env.OPENAI_API_KEY! });

  // For demo without API keys:
  return new MockEmbeddings({ dimension: 1536 });
}

async function main() {
  const filePath = './hybrid-search-example.mv2';

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  console.log('=== Hybrid Search Example ===\n');

  // -------------------------------------------------------------------------
  // Step 1: Set up the memory file with both indices
  // -------------------------------------------------------------------------
  const mem = create(filePath);
  const handle = getHandle(mem);
  const embedder = getEmbedder();

  // Enable BOTH search indices
  // - Lex index: Full-text search with Tantivy (BM25 ranking)
  // - Vec index: Vector similarity search (HNSW)
  mem.enableLex();
  mem.enableVec();

  console.log('Embedding dimension:', embedder.dimension);
  console.log('Search indices enabled: Lex + Vec\n');

  // -------------------------------------------------------------------------
  // Step 2: Ingest documents with embeddings
  // -------------------------------------------------------------------------
  // For vector search to work, documents need embeddings.
  // Use putWithEmbedding to store both content and its vector representation.

  const documents = [
    {
      content:
        'TypeScript is a strongly typed programming language that builds on JavaScript. It adds optional static typing and class-based object-oriented programming.',
      title: 'TypeScript Overview',
      uri: 'doc://typescript/overview',
    },
    {
      content:
        'Rust is a systems programming language focused on safety, speed, and concurrency. It prevents memory errors without using garbage collection.',
      title: 'Rust Language',
      uri: 'doc://rust/overview',
    },
    {
      content:
        'Python is an interpreted, high-level programming language known for its readability. It is widely used in data science, machine learning, and web development.',
      title: 'Python Guide',
      uri: 'doc://python/overview',
    },
    {
      content:
        'Machine learning is a subset of artificial intelligence that enables systems to learn and improve from experience without being explicitly programmed.',
      title: 'ML Introduction',
      uri: 'doc://ai/machine-learning',
    },
    {
      content:
        'Deep learning uses artificial neural networks with multiple layers to progressively extract higher-level features from raw input.',
      title: 'Deep Learning Basics',
      uri: 'doc://ai/deep-learning',
    },
    {
      content:
        'Natural language processing (NLP) enables computers to understand, interpret, and generate human language in meaningful ways.',
      title: 'NLP Overview',
      uri: 'doc://ai/nlp',
    },
    {
      content:
        'The embedding model converts text into numerical vectors that capture semantic meaning, enabling similarity search.',
      title: 'Embeddings Explained',
      uri: 'doc://ai/embeddings',
    },
  ];

  console.log('--- Ingesting Documents with Embeddings ---\n');

  for (const doc of documents) {
    // Generate embedding for the document content
    const embedding = await embedder.embedQuery(doc.content);

    // Store with both content and embedding
    mem.putWithEmbedding(Buffer.from(doc.content), embedding, {
      title: doc.title,
      uri: doc.uri,
    });

    console.log(`Indexed: ${doc.title}`);
  }

  mem.commit();
  console.log(`\nTotal documents: ${mem.stats().frameCount}`);

  // -------------------------------------------------------------------------
  // Step 3: Basic text search (lexical)
  // -------------------------------------------------------------------------
  // Lexical search finds documents containing exact or stemmed words.
  // Good for: specific terms, exact phrases, acronyms.

  console.log('\n--- Lexical Search (Text Keywords) ---\n');

  const lexQuery = 'programming language';
  const lexResults = mem.find(lexQuery, 5);

  console.log(`Query: "${lexQuery}"`);
  console.log(`Found: ${lexResults.totalHits} results (engine: ${lexResults.engine})\n`);

  for (const hit of lexResults.hits.slice(0, 3)) {
    console.log(`  [${hit.frameId}] ${hit.title}`);
    console.log(`       Score: ${hit.score?.toFixed(4)}`);
    console.log(`       Snippet: ${hit.text.slice(0, 80)}...`);
  }

  // -------------------------------------------------------------------------
  // Step 4: Vector search (semantic)
  // -------------------------------------------------------------------------
  // Vector search finds semantically similar documents.
  // Good for: concept matching, paraphrases, related ideas.

  console.log('\n--- Vector Search (Semantic Similarity) ---\n');

  const vecQuery = 'how do computers understand human speech?';
  const vecQueryEmbedding = await embedder.embedQuery(vecQuery);
  const vecResults = mem.vecSearch(vecQueryEmbedding, 5);

  console.log(`Query: "${vecQuery}"`);
  console.log(`Found: ${vecResults.totalHits} results (engine: ${vecResults.engine})\n`);

  for (const hit of vecResults.hits.slice(0, 3)) {
    console.log(`  [${hit.frameId}] ${hit.title}`);
    console.log(`       Distance: ${hit.score?.toFixed(4)} (lower is better)`);
    console.log(`       URI: ${hit.uri}`);
  }

  // -------------------------------------------------------------------------
  // Step 5: Hybrid search
  // -------------------------------------------------------------------------
  // The native hybridSearch combines vector similarity with text snippets.
  // It uses the embedding for ranking but extracts text snippets for display.

  console.log('\n--- Hybrid Search ---\n');

  const hybridQuery = 'AI and neural networks';
  const hybridQueryEmbedding = await embedder.embedQuery(hybridQuery);

  // hybridSearch takes: query (for snippets), embedding (for ranking), limit, options
  const hybridResults = handle.hybridSearch(hybridQuery, hybridQueryEmbedding, 5, {
    snippetChars: 150, // Max characters for text snippets
  });

  console.log(`Query: "${hybridQuery}"`);
  console.log(`Found: ${hybridResults.totalHits} results (engine: ${hybridResults.engine})\n`);

  for (const hit of hybridResults.hits) {
    console.log(`  [${hit.frameId}] ${hit.title || 'Untitled'}`);
    console.log(`       Score: ${hit.score?.toFixed(4)}`);
    console.log(`       Snippet: ${hit.text.slice(0, 100)}...`);
  }

  // -------------------------------------------------------------------------
  // Step 6: Scoped search
  // -------------------------------------------------------------------------
  // Filter results to documents within a URI prefix.
  // Useful for searching within categories or folders.

  console.log('\n--- Scoped Search (URI Prefix Filter) ---\n');

  const scopedQuery = 'learning';
  const scopedQueryEmbedding = await embedder.embedQuery(scopedQuery);

  // Only search within doc://ai/ namespace
  const scopedResults = handle.hybridSearch(scopedQuery, scopedQueryEmbedding, 5, {
    scope: 'doc://ai/', // Only return results with URIs starting with this prefix
    snippetChars: 100,
  });

  console.log(`Query: "${scopedQuery}" (scope: doc://ai/)`);
  console.log(`Found: ${scopedResults.totalHits} results\n`);

  for (const hit of scopedResults.hits) {
    console.log(`  [${hit.frameId}] ${hit.title} - ${hit.uri}`);
  }

  // -------------------------------------------------------------------------
  // Step 7: Adaptive retrieval
  // -------------------------------------------------------------------------
  // Fixed top_k retrieval can miss relevant results or include noise.
  // Adaptive retrieval analyzes the score distribution to find natural cutoffs.
  //
  // Strategies:
  // - "relative": Stop when score drops below threshold% of top score
  // - "absolute": Stop when score drops below fixed threshold
  // - "cliff": Stop when score drops sharply from previous result
  // - "elbow": Find the "knee" in the score curve
  // - "combined": Use multiple strategies together (default)

  console.log('\n--- Adaptive Retrieval ---\n');

  const adaptiveQuery = 'programming and types';
  const adaptiveQueryEmbedding = await embedder.embedQuery(adaptiveQuery);

  const adaptiveResults = handle.searchAdaptive(adaptiveQuery, adaptiveQueryEmbedding, {
    enabled: true,
    maxResults: 100, // Consider up to 100 results
    minResults: 1, // Return at least 1
    strategy: 'combined', // Use multiple strategies
    threshold: 0.5, // Threshold for relative strategy
    snippetChars: 100,
  });

  console.log(`Query: "${adaptiveQuery}"`);
  console.log(`Results returned: ${adaptiveResults.hits.length}\n`);

  console.log('Adaptive Stats:');
  console.log(`  - Total considered: ${adaptiveResults.stats.totalConsidered}`);
  console.log(`  - Cutoff index: ${adaptiveResults.stats.cutoffIndex}`);
  console.log(`  - Triggered by: ${adaptiveResults.stats.triggeredBy}`);
  if (adaptiveResults.stats.topScore) {
    console.log(`  - Top score: ${adaptiveResults.stats.topScore.toFixed(4)}`);
  }
  if (adaptiveResults.stats.cutoffScore) {
    console.log(`  - Cutoff score: ${adaptiveResults.stats.cutoffScore.toFixed(4)}`);
  }

  console.log('\nSelected results:');
  for (const hit of adaptiveResults.hits) {
    console.log(`  [${hit.frameId}] ${hit.title} (score: ${hit.score?.toFixed(4)})`);
  }

  // -------------------------------------------------------------------------
  // Step 8: Different adaptive strategies
  // -------------------------------------------------------------------------

  console.log('\n--- Comparing Adaptive Strategies ---\n');

  const strategies = ['relative', 'cliff', 'elbow'] as const;

  for (const strategy of strategies) {
    const result = handle.searchAdaptive(adaptiveQuery, adaptiveQueryEmbedding, {
      strategy,
      threshold: 0.4,
      maxResults: 50,
    });

    console.log(
      `${strategy}: ${result.stats.returned} results (triggered by: ${result.stats.triggeredBy})`
    );
  }

  // -------------------------------------------------------------------------
  // Step 9: Manual hybrid approach
  // -------------------------------------------------------------------------
  // Sometimes you want more control over how results are combined.
  // Here's a pattern for manual hybrid search.

  console.log('\n--- Manual Hybrid Search Pattern ---\n');

  async function manualHybridSearch(
    mem: any,
    query: string,
    embedder: EmbeddingProvider,
    topK: number = 10
  ) {
    // Get lexical results
    const lexHits = mem.find(query, topK);

    // Get vector results
    const queryVec = await embedder.embedQuery(query);
    const vecHits = mem.vecSearch(queryVec, topK);

    // Combine and dedupe by frameId
    const seen = new Set<number>();
    const combined = [];

    // Add lexical hits first (usually more precise)
    for (const hit of lexHits.hits) {
      if (!seen.has(hit.frameId)) {
        seen.add(hit.frameId);
        combined.push({ ...hit, source: 'lex' });
      }
    }

    // Add vector hits
    for (const hit of vecHits.hits) {
      if (!seen.has(hit.frameId)) {
        seen.add(hit.frameId);
        combined.push({ ...hit, source: 'vec' });
      }
    }

    return combined.slice(0, topK);
  }

  const manualQuery = 'typed JavaScript';
  const manualResults = await manualHybridSearch(mem, manualQuery, embedder, 5);

  console.log(`Manual hybrid query: "${manualQuery}"`);
  for (const hit of manualResults) {
    console.log(`  [${(hit as any).source}] ${hit.title} (frameId: ${hit.frameId})`);
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------
  mem.close();
  fs.unlinkSync(filePath);

  console.log('\n=== Example Complete ===');
}

main().catch(console.error);
