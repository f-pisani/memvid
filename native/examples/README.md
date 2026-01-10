# Memvid Examples

This directory contains example code demonstrating various features of the `@fpisani/memvid` Node.js SDK.

## Prerequisites

1. Install dependencies:
   ```bash
   npm install @fpisani/memvid
   ```

2. For TypeScript examples, you'll need `ts-node`:
   ```bash
   npm install -D ts-node typescript @types/node
   ```

3. For OpenAI embeddings (optional), set your API key:
   ```bash
   export OPENAI_API_KEY=your-key-here
   ```

## Running Examples

Each example can be run directly with ts-node:

```bash
# Memory cards (structured fact storage)
npx ts-node examples/memory-cards.ts

# Hybrid search (lex + vec combined)
npx ts-node examples/hybrid-search.ts

# Document ingestion (PDF, DOCX, etc.)
npx ts-node examples/document-ingestion.ts

# Table extraction from PDFs
npx ts-node examples/tables.ts

# File encryption
npx ts-node examples/encryption.ts

# File maintenance and repair
npx ts-node examples/file-maintenance.ts
```

## Example Overview

### [memory-cards.ts](./memory-cards.ts)
**Structured Fact Storage**

Learn how to use memory cards for storing and retrieving facts about entities. Memory cards are perfect for AI agents that need to remember user preferences, facts, and relationships.

Key features demonstrated:
- Creating memory cards with entity/slot/value
- Batch inserting multiple cards
- O(1) state lookup with `state()`
- Memory statistics
- Source tracking for traceability

### [hybrid-search.ts](./hybrid-search.ts)
**Combined Lexical and Vector Search**

Demonstrates how to combine text search (BM25) with vector similarity search for more accurate retrieval.

Key features demonstrated:
- Setting up embedding providers
- Lexical search with `find()`
- Vector search with `vecSearch()`
- Hybrid search combining both
- Adaptive retrieval with dynamic cutoff
- Different cutoff strategies (relative, cliff, elbow)

### [document-ingestion.ts](./document-ingestion.ts)
**Document Processing and Storage**

Shows how to ingest various document formats with automatic text extraction.

Key features demonstrated:
- Basic storage with `put()`
- Auto-extraction with `putDocument()`
- Text extraction preview with `extractDocument()`
- Retrieving raw bytes with `blob()`
- Supported file formats
- Frame metadata inspection

### [tables.ts](./tables.ts)
**Table Extraction from PDFs**

Demonstrates table extraction capabilities and export formats.

Key features demonstrated:
- Table extraction options and modes
- Listing stored tables
- Getting table by ID
- Exporting to CSV/JSON
- Best practices for tabular data

### [encryption.ts](./encryption.ts)
**File Security**

Shows how to encrypt and decrypt memvid files with passwords.

Key features demonstrated:
- Locking files with `lock()`
- Unlocking files with `unlock()`
- Error handling for wrong passwords
- Security best practices

### [file-maintenance.ts](./file-maintenance.ts)
**File Health and Repair**

Demonstrates file maintenance operations using the doctor tool.

Key features demonstrated:
- File verification with `verify()`
- Diagnosis mode with `doctor(path, false)`
- Repair mode with `doctor(path, true)`
- Monitoring file statistics
- Updating frame metadata
- Soft-delete operations
- Maintenance workflow recommendations

## Common Patterns

### Creating and Opening Files

```typescript
import { create, open } from '@fpisani/memvid';

// Create new file
const mem = create('./my-memory.mv2');
mem.enableLex();  // Enable text search
mem.enableVec();  // Enable vector search

// Store data
mem.put(Buffer.from('content'), { title: 'My Document' });
mem.commit();
mem.close();

// Reopen later
const mem2 = open('./my-memory.mv2');
```

### Searching

```typescript
// Text search
const textResults = mem.find('query', 10);

// Vector search
const embedding = await embedder.embedQuery('query');
const vecResults = mem.vecSearch(embedding, 10);

// Filtered search
const filtered = mem.find('query', {
  topK: 10,
  scope: 'doc://articles/',
  excludeFrameIds: [1, 2, 3],
});
```

### Memory Cards

```typescript
// Access native handle for memory operations
const handle = (mem as any).handle;

// Store memory
handle.putMemoryCard({
  entity: 'user',
  slot: 'preference',
  value: 'dark mode',
  kind: 'preference',
});

// Quick lookup
const value = handle.state('user', 'preference');

// Get full card
const card = handle.getCurrentMemory('user', 'preference');

// Get all entity memories
const allMemories = handle.getEntityMemories('user');
```

### Error Handling

```typescript
import { MemvidError, LexNotEnabledError } from '@fpisani/memvid';

try {
  mem.find('query');
} catch (error) {
  if (error instanceof LexNotEnabledError) {
    mem.enableLex();
    // retry
  } else if (error instanceof MemvidError) {
    console.error(`[${error.code}] ${error.message}`);
  }
}
```

## API Reference

For complete API documentation, see the main [README.md](../README.md) or the TypeScript definitions in [index.d.ts](../index.d.ts).
