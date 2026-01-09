# Node.js Wrapper Build Plan

> **SSE Review Status**: REVIEWED - See critical fixes below

---

## Progress Tracker

| Phase | Description | Status | Notes |
|-------|-------------|--------|-------|
| **0** | POC - Basic NAPI bindings | ✅ DONE | create, open, put, find, commit working |
| **1** | Core APIs | ✅ DONE | All APIs implemented and tested |
| **2** | TypeScript wrapper | ✅ DONE | Memvid class, embeddings providers, error handling |
| **3** | Full test suite | ✅ DONE | 41 tests passing (vitest) |
| **4** | Cross-platform builds | ✅ DONE | GitHub Actions CI/CD |

### Phase 0 Completed ✅
- [x] Create native/ directory structure
- [x] Set up Cargo.toml with napi-rs
- [x] Create lib.rs with MemvidHandle (Arc<Mutex<Memvid>>)
- [x] Implement: create, open, put, commit, find, stats, enableLex, verify
- [x] Build and test POC - ALL TESTS PASSED

### Phase 1 Completed ✅
- [x] timeline(options) - chronological view of frames
- [x] view(frameId) - get frame text content via frame_text_by_id
- [x] frame(frameId) - get frame metadata
- [x] delete(frameId) - soft delete frame
- [x] putWithEmbedding(content, embedding, options) - store with vector embedding
- [x] enableVec() - enable vector index
- [x] vecSearch(embedding, topK) - vector similarity search

### Phase 2 Completed ✅
- [x] tsconfig.json - TypeScript configuration
- [x] src/types.ts - Type definitions for all APIs
- [x] src/error.ts - Error classes with NAPI error parsing
- [x] src/embeddings.ts - Embedding providers (OpenAI, Cohere, Voyage, Mock)
- [x] src/index.ts - Memvid class wrapper with full API
- [x] Updated package.json for TypeScript build
- [x] All tests passing (native + TypeScript wrapper)

### OpenAI Integration Tested ✅
- [x] OpenAI text-embedding-3-small working
- [x] Batch embedding (5 docs in ~1.6s)
- [x] Store with embeddings via putWithEmbedding()
- [x] Semantic search via vecSearch() - correctly matches semantically similar content
- [x] Lexical search fallback working

### Phase 3 Completed ✅
- [x] Vitest test framework setup
- [x] basic.test.ts - 13 tests (create, open, stats, put, commit, verify)
- [x] search.test.ts - 12 tests (find, timeline, view, frame, delete)
- [x] embeddings.test.ts - 16 tests (MockEmbeddings, OpenAI, Cohere, vecSearch)
- [x] All 41 tests passing

### Phase 4 Completed ✅
- [x] GitHub Actions CI workflow (.github/workflows/ci.yml)
- [x] Test job - runs on Ubuntu
- [x] Build job - cross-compiles for:
  - x86_64-unknown-linux-gnu (Linux x64)
  - x86_64-apple-darwin (macOS Intel)
  - aarch64-apple-darwin (macOS Apple Silicon)
  - x86_64-pc-windows-msvc (Windows x64)
- [x] Publish job - publishes to npm on version tags

### Known Issues
- WSL cross-filesystem paths don't work (use /tmp or native Linux paths)
- Frame IDs: put() returns WAL record ID (1-based), timeline uses frame index (0-based)

---

## Goal
Build a clean Node.js wrapper for our unlimited memvid-core Rust library.
- 100% local operation (no memvid.com dependencies)
- No telemetry/analytics
- Keep AI provider integrations (OpenAI, Cohere, etc.) for embeddings
- Full test coverage

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    memvid-node (our package)                │
├─────────────────────────────────────────────────────────────┤
│  src/                                                       │
│  ├── index.ts          # Main exports & Memvid class        │
│  ├── embeddings.ts     # AI provider integrations           │
│  ├── clip.ts           # Image embeddings (optional)        │
│  ├── entities.ts       # NER extraction (optional)          │
│  ├── types.ts          # TypeScript interfaces              │
│  └── error.ts          # Error types                        │
├─────────────────────────────────────────────────────────────┤
│                      ↓ napi-rs bindings ↓                   │
├─────────────────────────────────────────────────────────────┤
│  native/                                                    │
│  ├── Cargo.toml        # napi-rs + memvid-core deps         │
│  └── src/lib.rs        # Rust → Node bindings               │
└─────────────────────────────────────────────────────────────┘
```

## Phase 1: NAPI-RS Bindings (Rust → Node)

### 1.1 Create native binding crate
```
memvid/
├── src/                 # existing memvid-core
├── native/              # NEW: napi bindings
│   ├── Cargo.toml
│   ├── src/
│   │   └── lib.rs
│   └── build.rs
```

### 1.2 Cargo.toml for native bindings
```toml
[package]
name = "memvid-node"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
memvid-core = { path = ".." }
napi = { version = "2", features = ["async", "serde-json"] }
napi-derive = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[build-dependencies]
napi-build = "2"
```

### 1.3 Functions to expose via NAPI
| Rust Method | JS Method | Description |
|-------------|-----------|-------------|
| `Memvid::create()` | `create(path)` | Create new .mv2 file |
| `Memvid::open()` | `open(path)` | Open existing file |
| `memvid.put_bytes_with_options()` | `put(data)` | Store document |
| `memvid.search()` | `find(query)` | Text search |
| `memvid.vec_search()` | `vecSearch(query, embedding)` | Vector search |
| `memvid.ask()` | `ask(question)` | RAG query |
| `memvid.timeline()` | `timeline(opts)` | Browse chronologically |
| `memvid.stats()` | `stats()` | Get file statistics |
| `memvid.commit()` | `commit()` | Persist changes |
| `memvid.verify()` | `verify()` | Check integrity |
| `memvid.doctor()` | `doctor()` | Repair file |
| `memvid.enable_lex()` | `enableLex()` | Enable text index |
| `memvid.frame_content()` | `view(frameId)` | Get frame content |

### 1.4 Estimated effort: 2-3 days

## Phase 2: TypeScript Wrapper

### 2.1 Project structure
```
memvid-node/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts         # Main entry point
│   ├── memvid.ts        # Memvid class wrapper
│   ├── embeddings.ts    # Embedding providers (from SDK)
│   ├── types.ts         # TypeScript types
│   └── error.ts         # Error handling
├── native/              # Rust bindings (from Phase 1)
├── __tests__/
│   ├── basic.test.ts
│   ├── embeddings.test.ts
│   ├── search.test.ts
│   └── vecSearch.test.ts
└── examples/
    ├── basic-usage.ts
    ├── openai-embeddings.ts
    └── rag-query.ts
```

### 2.2 Code to KEEP from original SDK
- `embeddings.ts` - All embedding providers (OpenAI, Cohere, Voyage, NVIDIA, Gemini, Mistral)
- `clip.ts` - CLIP image embeddings
- `entities.ts` - NER extraction
- `types.ts` - Core type definitions
- `error.ts` - Error classes (remove CapacityExceededError, TicketInvalidError, QuotaExceededError)

### 2.3 Code to REMOVE from original SDK
- `analytics.ts` - Telemetry (DELETE entirely)
- `createMemory()` - Cloud memory creation
- `listMemories()` - Cloud memory listing
- `syncTickets()` - Ticket synchronization
- `applyTicket()` - Ticket application
- `currentTicket()` - Get current ticket
- `getCapacity()` - Capacity checking
- `trackQueryUsage()` - Query quota tracking
- `validateConfig()` - Dashboard validation (keep LLM provider validation only)
- All `dashboardUrl` references
- All `memvidApiKey` / `mv2_*` key handling
- All adapters (langchain, llamaindex, etc.) - can add back later if needed

### 2.4 Simplified API
```typescript
// Create/Open
const mem = await create('knowledge.mv2');
const mem = await open('knowledge.mv2');

// Store with embeddings
const embedder = new OpenAIEmbeddings({ apiKey: process.env.OPENAI_API_KEY });
await mem.put({
  title: 'Document',
  text: 'Content here...',
  embedding: await embedder.embedQuery('Content here...')
});

// Or batch with auto-embedding
await mem.putMany([
  { title: 'Doc 1', text: 'Content 1' },
  { title: 'Doc 2', text: 'Content 2' },
], { embedder });

// Search
const results = await mem.find('search query');
const vecResults = await mem.vecSearch('query', queryEmbedding);

// RAG
const answer = await mem.ask('What is...?', {
  model: 'gpt-4',
  modelApiKey: process.env.OPENAI_API_KEY
});

// Cleanup
await mem.commit();
```

### 2.5 Estimated effort: 1-2 days

## Phase 3: Testing

### 3.1 Test categories
1. **Unit tests** - Individual function tests
2. **Integration tests** - Full workflows
3. **Embedding tests** - Mock + real API tests
4. **Error handling tests** - Edge cases

### 3.2 Test files
```typescript
// __tests__/basic.test.ts
describe('Basic Operations', () => {
  test('create and open file', async () => {});
  test('put and retrieve document', async () => {});
  test('commit persists data', async () => {});
  test('stats returns correct counts', async () => {});
  test('verify passes on healthy file', async () => {});
});

// __tests__/search.test.ts
describe('Search', () => {
  test('find returns matching documents', async () => {});
  test('find with scope filters correctly', async () => {});
  test('find returns snippets', async () => {});
  test('timeline returns chronological order', async () => {});
});

// __tests__/vecSearch.test.ts
describe('Vector Search', () => {
  test('vecSearch finds similar documents', async () => {});
  test('vecSearch respects k parameter', async () => {});
  test('embedding dimension validation', async () => {});
});

// __tests__/embeddings.test.ts
describe('Embedding Providers', () => {
  test('OpenAI embeddings work', async () => {});
  test('batch embedding works', async () => {});
  test('dimension validation works', async () => {});
  // Mock tests for CI (no API keys needed)
  test('mock provider works', async () => {});
});

// __tests__/rag.test.ts
describe('RAG Queries', () => {
  test('ask returns answer with sources', async () => {});
  test('ask respects context limit', async () => {});
});
```

### 3.3 Test infrastructure
- Use `vitest` or `jest` for testing
- Mock embedding providers for CI
- Real API tests gated behind `OPENAI_API_KEY` env var
- Temp files cleaned up after each test

### 3.4 Estimated effort: 1-2 days

## Phase 4: Build & Distribution

### 4.1 Build targets
- `darwin-arm64` (macOS Apple Silicon)
- `darwin-x64` (macOS Intel)
- `linux-x64-gnu` (Linux)
- `win32-x64-msvc` (Windows)

### 4.2 Package structure
```json
{
  "name": "memvid-node",
  "version": "1.0.0",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "napi build --release && tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "optionalDependencies": {
    "memvid-node-darwin-arm64": "1.0.0",
    "memvid-node-darwin-x64": "1.0.0",
    "memvid-node-linux-x64-gnu": "1.0.0",
    "memvid-node-win32-x64-msvc": "1.0.0"
  }
}
```

### 4.3 Estimated effort: 1 day

## Timeline Summary

| Phase | Task | Effort |
|-------|------|--------|
| 1 | NAPI-RS bindings | 2-3 days |
| 2 | TypeScript wrapper | 1-2 days |
| 3 | Testing | 1-2 days |
| 4 | Build & distribution | 1 day |
| **Total** | | **5-8 days** |

## Success Criteria

1. All basic operations work locally without network calls
2. No telemetry/analytics code
3. No dashboard/ticket/capacity code
4. Embedding providers work with user's API keys
5. All tests pass
6. Builds for all 4 platforms
7. Can be installed via `npm install` (local tarball or registry)

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| NAPI-RS learning curve | Follow official napi-rs examples |
| Async handling across FFI | Use napi's async support |
| Memory management | Use Arc/Box for shared state |
| Platform-specific issues | Test on all platforms in CI |

## Open Questions

1. Should we keep the framework adapters (LangChain, LlamaIndex)?
   - Recommendation: Skip initially, add later if needed
2. Should we publish to npm or keep private?
   - Recommendation: Keep private initially, publish later
3. Do we need CLIP/NER support immediately?
   - Recommendation: Skip initially, embeddings are priority

---

## SSE Review Findings (CRITICAL)

### 1. Thread Safety Fix Required

The Rust `Memvid` struct is NOT thread-safe. NAPI wrapper must use:

```rust
#[napi]
pub struct MemvidHandle {
    inner: Arc<Mutex<Memvid>>,
}

#[napi]
impl MemvidHandle {
    #[napi]
    pub fn stats(&self) -> napi::Result<Stats> {
        let guard = self.inner.lock().map_err(|e|
            napi::Error::from_reason(format!("Lock poisoned: {}", e))
        )?;
        guard.stats().map_err(|e| napi::Error::from_reason(e.to_string()))
    }
}
```

### 2. Panic Handling Required

Every NAPI function MUST catch Rust panics:

```rust
#[napi]
pub fn create(path: String) -> napi::Result<MemvidHandle> {
    std::panic::catch_unwind(|| {
        // ... actual logic
    }).map_err(|_| napi::Error::from_reason("Rust panic occurred"))?
}
```

### 3. Simplified Embedding Architecture

**DON'T** try to call JavaScript from Rust. Keep embeddings in TypeScript:

```typescript
// TypeScript side - CORRECT approach
const embedder = new OpenAIEmbeddings();
const embedding = await embedder.embedQuery(text);
await mem.putWithEmbedding({ text, embedding }); // Pass vector to Rust
```

### 4. Missing APIs to Add

| API | Purpose |
|-----|---------|
| `enableVec()` | Enable vector index |
| `enableClip()` | Enable CLIP index |
| `searchAdaptive()` | Dynamic result sizing |
| `frameEmbedding()` | Get stored embedding |
| `rebuildIndexes()` | Maintenance |

### 5. Error Mapping Required

Map all 30+ Rust `MemvidError` variants to TypeScript:

```typescript
// error.ts
export class MemvidError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class LexNotEnabledError extends MemvidError {
  constructor() { super('LEX_NOT_ENABLED', 'Lex index not enabled'); }
}

export class VecNotEnabledError extends MemvidError {
  constructor() { super('VEC_NOT_ENABLED', 'Vec index not enabled'); }
}

export class VecDimensionMismatchError extends MemvidError {
  constructor(expected: number, got: number) {
    super('VEC_DIM_MISMATCH', `Expected ${expected} dimensions, got ${got}`);
  }
}
// ... etc for all error types
```

### 6. Revised Timeline

| Phase | Task | Days |
|-------|------|------|
| **0** | POC - single function working | 2 |
| **1** | Core APIs (create, open, put, find, commit) | 5 |
| **2** | TypeScript wrapper + embeddings | 3 |
| **3** | Advanced (vecSearch, ask, timeline) | 4 |
| **4** | Full test suite | 4 |
| **5** | Cross-platform builds | 2 |
| **Total** | | **20 days** |

### 7. Security Checklist

- [ ] Path traversal validation in TypeScript before passing to Rust
- [ ] API keys never logged or stored in .mv2
- [ ] File size limits for untrusted files
- [ ] Native binaries signed for distribution
- [ ] Build reproducibility documented

### 8. Test Categories to Add

```
__tests__/
├── basic.test.ts        # Create, open, put, find
├── search.test.ts       # Text search, filtering
├── vecSearch.test.ts    # Vector search
├── embeddings.test.ts   # Provider integration
├── rag.test.ts          # Ask/RAG queries
├── native.test.ts       # Module loading, panic handling
├── stress.test.ts       # Large files, concurrent ops
├── errors.test.ts       # All error types surfaced correctly
└── cleanup.test.ts      # File handles released properly
```
