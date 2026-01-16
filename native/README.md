# @fpisani/memvid

Node.js bindings for [memvid-core](https://github.com/f-pisani/memvid) - a single-file memory layer for AI agents.

Packages documents, embeddings, search indices, and metadata into a portable `.mv2` file.

## Installation

```bash
npm install @fpisani/memvid
```

**Supported platforms:**
- Windows x64
- macOS x64 (Intel)
- macOS arm64 (Apple Silicon)
- Linux x64

## Quick Start

```typescript
import { create, open, OpenAIEmbeddings } from '@fpisani/memvid';

// Create a new memvid file
const mem = create('/path/to/memory.mv2');

// Enable search indices
mem.enableLex();  // Full-text search
mem.enableVec();  // Vector similarity search

// Store documents
mem.put(Buffer.from('Hello world'), { title: 'Greeting' });
mem.put(Buffer.from('AI is transforming the world'), { title: 'AI Article' });
mem.commit();

// Text search
const results = mem.find('hello');
console.log(results.hits);

// Vector search with OpenAI embeddings
const embedder = new OpenAIEmbeddings({ apiKey: process.env.OPENAI_API_KEY! });
const queryVec = await embedder.embedQuery('artificial intelligence');
const vecResults = mem.vecSearch(queryVec, 5);
console.log(vecResults.hits);

// Clean up
mem.close();
```

## API Reference

### Core Functions

#### `create(path: string): Memvid`

Create a new memvid file.

```typescript
const mem = create('/tmp/memory.mv2');
```

#### `open(path: string): Memvid`

Open an existing memvid file with an exclusive lock.

```typescript
const mem = open('/tmp/existing.mv2');
```

#### `openReadOnly(path: string): Memvid`

Open an existing memvid file in read-only mode (shared lock) for concurrent readers.

```typescript
const mem = openReadOnly('/tmp/existing.mv2');
```

#### `openSnapshot(path: string): Memvid`

Open an existing memvid file as a snapshot without acquiring a lock.
This reads the last committed footer for a consistent view even if a writer is active.
While snapshot readers are active, shrink operations (vacuum/rebuild/footer truncation)
are deferred and the latest footer is appended.

```typescript
const mem = openSnapshot('/tmp/existing.mv2');
```

#### `version(): string`

Get the memvid-node version.

```typescript
console.log(version()); // "1.0.0"
```

---

### Memvid Class

The main interface for working with `.mv2` files.

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `path` | `string` | File path |
| `isClosed` | `boolean` | Whether handle is closed |

#### Methods

##### `close(): void`

Close the handle and release resources.

```typescript
mem.close();
```

##### `stats(): Stats`

Get file statistics.

```typescript
const stats = mem.stats();
console.log(stats.frameCount);      // Total frames
console.log(stats.sizeBytes);       // File size
console.log(stats.hasLexIndex);     // Text search enabled
console.log(stats.hasVecIndex);     // Vector search enabled
```

##### `put(content: Buffer, options?: PutOptions): number`

Store a document. Returns the frame ID.

```typescript
const frameId = mem.put(Buffer.from('Document content'), {
  title: 'My Document',
  uri: 'doc://unique-id',
  kind: 'article',
  labels: ['important', 'reviewed']
});
```

##### `putWithEmbedding(content: Buffer, embedding: number[], options?: PutOptions): number`

Store a document with a pre-computed embedding vector.

```typescript
const embedding = await embedder.embedQuery('Document content');
const frameId = mem.putWithEmbedding(
  Buffer.from('Document content'),
  embedding,
  { title: 'My Document' }
);
```

##### `putMany(documents, embedder?): Promise<PutManyResult>`

Batch store multiple documents with optional auto-embedding.

```typescript
const result = await mem.putMany([
  { content: 'First doc', options: { title: 'Doc 1' } },
  { content: 'Second doc', options: { title: 'Doc 2' } },
], embedder);

console.log(`Stored ${result.successCount}/${result.results.length}`);
console.log(result.frameIds); // [0, 1]
```

##### `commit(): void`

Persist all pending changes to disk.

```typescript
mem.put(Buffer.from('content'));
mem.commit(); // Write to disk
```

##### `enableLex(): void`

Enable full-text search index. Must be called before using `find()`.

```typescript
mem.enableLex();
```

##### `enableVec(): void`

Enable vector similarity search index. Must be called before using `vecSearch()` or `putWithEmbedding()`.

```typescript
mem.enableVec();
```

##### `find(query: string, options?: SearchOptions | number): SearchResult`

Full-text search with optional filtering.

```typescript
// Simple usage (just topK)
const results = mem.find('search query', 10);

// With filter options
const filtered = mem.find('AI', {
  topK: 10,
  uri: 'doc://specific',           // Exact URI match
  scope: 'doc://articles/',        // URI prefix match
  excludeFrameIds: [0, 1, 2],      // Exclude specific frames
  excludeUris: ['doc://skip-me'],  // Exclude specific URIs
});

for (const hit of results.hits) {
  console.log(hit.text, hit.score, hit.frameId);
}
```

##### `vecSearch(queryEmbedding: number[], options?: SearchOptions | number): SearchResult`

Vector similarity search with optional filtering.

```typescript
const queryVec = await embedder.embedQuery('semantic query');

// Simple usage
const results = mem.vecSearch(queryVec, 5);

// With filter options
const filtered = mem.vecSearch(queryVec, {
  topK: 10,
  scope: 'doc://articles/',        // Only search within scope
  excludeFrameIds: [0, 1, 2],      // Exclude specific frames
  excludeUris: ['doc://skip-me'],  // Exclude specific URIs
});

for (const hit of results.hits) {
  console.log(hit.text, hit.score); // score = distance (lower is better)
}
```

##### `timeline(options?: TimelineOptions): TimelineEntry[]`

Get chronological view of frames.

```typescript
const entries = mem.timeline({
  limit: 10,
  reverse: true,  // Newest first
  since: Date.now() - 86400000, // Last 24 hours
});

for (const entry of entries) {
  console.log(entry.timestamp, entry.preview);
}
```

##### `view(frameId: number): string`

Get frame content by ID.

```typescript
const content = mem.view(0);
console.log(content);
```

##### `frame(frameId: number): FrameInfo`

Get frame metadata by ID.

```typescript
const info = mem.frame(0);
console.log(info.id, info.title, info.timestamp);
```

##### `delete(frameId: number): number`

Soft delete a frame. Returns the deleted frame ID.

```typescript
mem.delete(0);
mem.commit();
```

##### `verify(deep?: boolean): boolean`

Verify file integrity.

```typescript
if (!mem.verify(true)) {
  console.error('File is corrupted!');
}
```

---

### Embedding Providers

All providers implement the `EmbeddingProvider` interface:

```typescript
interface EmbeddingProvider {
  embedQuery(text: string): Promise<number[]>;
  embedDocuments(texts: string[]): Promise<number[][]>;
  dimension: number;
}
```

#### OpenAIEmbeddings

```typescript
import { OpenAIEmbeddings } from '@fpisani/memvid';

const embedder = new OpenAIEmbeddings({
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'text-embedding-3-small', // default
  baseUrl: 'https://api.openai.com/v1', // optional
  timeoutMs: 30000, // optional
});

const embedding = await embedder.embedQuery('Hello world');
const embeddings = await embedder.embedDocuments(['doc1', 'doc2']);
```

**Supported models:**
- `text-embedding-3-small` (1536 dimensions) - default
- `text-embedding-3-large` (3072 dimensions)
- `text-embedding-ada-002` (1536 dimensions)

#### CohereEmbeddings

```typescript
import { CohereEmbeddings } from '@fpisani/memvid';

const embedder = new CohereEmbeddings({
  apiKey: process.env.COHERE_API_KEY!,
  model: 'embed-english-v3.0', // default
});
```

**Supported models:**
- `embed-english-v3.0` (1024 dimensions) - default
- `embed-multilingual-v3.0` (1024 dimensions)
- `embed-english-light-v3.0` (384 dimensions)
- `embed-multilingual-light-v3.0` (384 dimensions)

#### VoyageEmbeddings

```typescript
import { VoyageEmbeddings } from '@fpisani/memvid';

const embedder = new VoyageEmbeddings({
  apiKey: process.env.VOYAGE_API_KEY!,
  model: 'voyage-2', // default
});
```

**Supported models:**
- `voyage-2` (1024 dimensions) - default
- `voyage-large-2` (1536 dimensions)
- `voyage-code-2` (1536 dimensions)

#### MockEmbeddings

For testing without API calls:

```typescript
import { MockEmbeddings } from '@fpisani/memvid';

const embedder = new MockEmbeddings({ dimension: 1536 });
const embedding = await embedder.embedQuery('test'); // Deterministic fake embedding
```

---

### Types

#### PutOptions

```typescript
interface PutOptions {
  title?: string;      // Document title
  uri?: string;        // Unique identifier
  kind?: string;       // Document type
  labels?: string[];   // Categorization labels
}
```

#### SearchOptions

```typescript
interface SearchOptions {
  topK?: number;           // Max results to return (default: 10)
  uri?: string;            // Filter to exact URI match
  scope?: string;          // Filter to URI prefix
  excludeFrameIds?: number[];  // Exclude specific frame IDs
  excludeUris?: string[];  // Exclude specific URIs
}
```

#### SearchResult

```typescript
interface SearchResult {
  totalHits: number;
  hits: SearchHit[];
  engine: string;      // 'Tantivy' or 'Vec'
  cursor?: string;     // For pagination
}

interface SearchHit {
  frameId: number;
  score?: number;      // Relevance (lex) or distance (vec)
  text: string;        // Matched snippet
  rangeStart: number;  // Byte range in content
  rangeEnd: number;
  title?: string;
  uri?: string;
}
```

#### Stats

```typescript
interface Stats {
  frameCount: number;
  activeFrameCount: number;
  sizeBytes: number;
  payloadBytes: number;
  logicalBytes: number;
  savedBytes: number;
  compressionRatioPercent: number;
  savingsPercent: number;
  averageFramePayloadBytes: number;
  averageFrameLogicalBytes: number;
  vectorCount: number;
  hasLexIndex: boolean;
  hasVecIndex: boolean;
  hasClipIndex: boolean;
  hasTimeIndex: boolean;
}
```

#### TimelineOptions

```typescript
interface TimelineOptions {
  limit?: number;      // Max entries to return
  since?: number;      // After this timestamp (Unix ms)
  until?: number;      // Before this timestamp (Unix ms)
  reverse?: boolean;   // Newest first
}
```

#### TimelineEntry

```typescript
interface TimelineEntry {
  frameId: number;
  timestamp: number;   // Unix ms
  preview: string;     // Text preview
  uri?: string;
}
```

#### FrameInfo

```typescript
interface FrameInfo {
  id: number;
  timestamp: number;   // Unix ms
  uri?: string;
  title?: string;
  kind?: string;
  payloadLength: number;
}
```

---

### Error Handling

All errors extend `MemvidError`:

```typescript
import {
  MemvidError,
  LexNotEnabledError,
  VecNotEnabledError,
  VecDimensionMismatchError,
  FrameNotFoundError,
  HandleClosedError,
  FileNotFoundError,
  InvalidFileError,
  CorruptedFileError,
  EmbeddingError,
} from '@fpisani/memvid';

try {
  mem.find('query');
} catch (error) {
  if (error instanceof LexNotEnabledError) {
    mem.enableLex();
    // retry
  } else if (error instanceof MemvidError) {
    console.error(`Error [${error.code}]: ${error.message}`);
  }
}
```

| Error Class | Code | Description |
|------------|------|-------------|
| `LexNotEnabledError` | `LEX_NOT_ENABLED` | Call `enableLex()` first |
| `VecNotEnabledError` | `VEC_NOT_ENABLED` | Call `enableVec()` first |
| `VecDimensionMismatchError` | `VEC_DIM_MISMATCH` | Embedding dimension mismatch |
| `FrameNotFoundError` | `FRAME_NOT_FOUND` | Frame ID doesn't exist |
| `HandleClosedError` | `HANDLE_CLOSED` | Handle was closed |
| `FileNotFoundError` | `FILE_NOT_FOUND` | File doesn't exist |
| `InvalidFileError` | `INVALID_FILE` | Not a valid .mv2 file |
| `CorruptedFileError` | `CORRUPTED_FILE` | File is corrupted |
| `EmbeddingError` | `EMBEDDING_ERROR` | Embedding API failed |

---

## Examples

### RAG Pipeline

```typescript
import { create, OpenAIEmbeddings } from '@fpisani/memvid';

const embedder = new OpenAIEmbeddings({ apiKey: process.env.OPENAI_API_KEY! });
const mem = create('knowledge.mv2');
mem.enableLex();
mem.enableVec();

// Ingest documents
const docs = [
  { content: 'TypeScript is a typed superset of JavaScript.', title: 'TypeScript' },
  { content: 'Rust is a systems programming language.', title: 'Rust' },
  { content: 'Python is great for machine learning.', title: 'Python' },
];

for (const doc of docs) {
  const embedding = await embedder.embedQuery(doc.content);
  mem.putWithEmbedding(Buffer.from(doc.content), embedding, { title: doc.title });
}
mem.commit();

// Query with semantic search
const queryVec = await embedder.embedQuery('What language is good for ML?');
const results = mem.vecSearch(queryVec, 3);

console.log('Top matches:');
for (const hit of results.hits) {
  console.log(`- ${hit.title}: ${hit.text} (distance: ${hit.score})`);
}

mem.close();
```

### Hybrid Search

```typescript
// Combine text and vector search
function hybridSearch(mem: Memvid, query: string, embedder: EmbeddingProvider, topK = 10) {
  // Text search
  const lexResults = mem.find(query, topK);

  // Vector search
  const queryVec = await embedder.embedQuery(query);
  const vecResults = mem.vecSearch(queryVec, topK);

  // Combine and dedupe by frameId
  const seen = new Set<number>();
  const combined = [];

  for (const hit of [...lexResults.hits, ...vecResults.hits]) {
    if (!seen.has(hit.frameId)) {
      seen.add(hit.frameId);
      combined.push(hit);
    }
  }

  return combined.slice(0, topK);
}
```

---

## License

Apache-2.0
