# SDK Implementation Plan

**Goal:** Achieve full feature parity between Rust core and Node.js SDK
**Current Gap:** 103 methods not exposed
**Approach:** Batch implementations by feature area for parallel agent work

---

## Implementation Batches

Each batch is designed to be tackled by a single agent session. Batches are ordered by dependency (earlier batches should complete first where noted).

---

## Batch 1: Core Utilities
**Effort:** 1-2 hours | **Priority:** High | **Dependencies:** None

### Methods to Implement
| Method | Rust Location | Description |
|--------|---------------|-------------|
| `openReadOnly(path)` | `memvid/lifecycle.rs` | Open file in read-only mode |
| `putWithEmbeddingAndOptions(content, embedding, opts)` | `memvid/mutation.rs` | Put with embedding + full options |
| `commitWithOptions(opts)` | `memvid/mutation.rs` | Commit with CommitOptions |
| `frameByUri(uri)` | `memvid/mod.rs` | Get frame by URI string |
| `frameEmbedding(frameId)` | `memvid/mod.rs` | Get embedding for frame |
| `mediaManifest(frameId)` | `memvid/mod.rs` | Get media manifest for frame |

### Implementation Steps
1. Add Rust bindings in `native/src/lib.rs`
2. Add TypeScript types in `native/src/types.ts` (CommitOptions, MediaManifest)
3. Add TypeScript wrappers in `native/src/index.ts`
4. Add tests in `native/__tests__/core-utils.test.ts`
5. Update README with new methods

### Files to Modify
- `native/src/lib.rs` - Add 6 new `#[napi]` functions
- `native/src/types.ts` - Add CommitOptions, MediaManifest types
- `native/src/index.ts` - Add 6 wrapper methods to Memvid class
- `native/__tests__/core-utils.test.ts` - New test file

---

## Batch 2: Optimization Operations
**Effort:** 1-2 hours | **Priority:** Medium | **Dependencies:** None

### Methods to Implement
| Method | Rust Location | Description |
|--------|---------------|-------------|
| `vacuum()` | `memvid/mod.rs` | Reclaim unused space |
| `compactWal()` | `memvid/mod.rs` | Compact write-ahead log |
| `putWithChunkEmbeddings(content, chunks)` | `memvid/mutation.rs` | Put with per-chunk embeddings |

### Implementation Steps
1. Add Rust bindings for vacuum/compact operations
2. Add TypeScript types (VacuumResult, CompactResult, ChunkEmbedding)
3. Add wrapper methods
4. Add tests
5. Document in README

### Files to Modify
- `native/src/lib.rs`
- `native/src/types.ts`
- `native/src/index.ts`
- `native/__tests__/optimization.test.ts` - New test file

---

## Batch 3: Memory Cards Advanced
**Effort:** 2-3 hours | **Priority:** Medium | **Dependencies:** None

### Methods to Implement
| Method | Rust Location | Description |
|--------|---------------|-------------|
| `memoryCardHistory(entity, slot)` | `memvid/memory.rs` | Get version history for entity:slot |
| `inferSchema()` | `memvid/memory.rs` | Infer schema from existing cards |
| `validateCard(card)` | `types/memory_card.rs` | Validate card against schema |

### Implementation Steps
1. Add Rust bindings
2. Add TypeScript types (SchemaInference, ValidationResult)
3. Add wrapper methods
4. Add tests extending `memory-cards.test.ts`
5. Add example in `examples/memory-cards.ts`

### Files to Modify
- `native/src/lib.rs`
- `native/src/types.ts`
- `native/src/index.ts`
- `native/__tests__/memory-cards.test.ts` - Extend existing

---

## Batch 4: Ask/RAG Advanced
**Effort:** 2-3 hours | **Priority:** High | **Dependencies:** None

### Methods to Implement
| Method | Rust Location | Description |
|--------|---------------|-------------|
| Enhanced `ask()` with `customPrompt` | `memvid/ask.rs` | Custom system/user prompts |
| Enhanced `ask()` with `maskPii` | `memvid/ask.rs` | Mask PII in retrieved context |
| Enhanced `ask()` with `conversationHistory` | `memvid/ask.rs` | Multi-turn conversations |

### Implementation Steps
1. Extend AskOptions type with new fields
2. Update Rust binding to pass new options
3. Update TypeScript types
4. Add tests for each new option
5. Add example showing multi-turn conversation

### Files to Modify
- `native/src/lib.rs` - Extend `ask` function
- `native/src/types.ts` - Extend AskOptions
- `native/src/index.ts` - Update ask wrapper
- `native/__tests__/ask-advanced.test.ts` - New test file
- `native/examples/rag-advanced.ts` - New example

---

## Batch 5: Document Processing
**Effort:** 3-4 hours | **Priority:** Medium | **Dependencies:** None

### Methods to Implement
| Method | Rust Location | Description |
|--------|---------------|-------------|
| XLSX support in `extractDocument()` | `reader/xlsx.rs` | Excel file processing |
| PPTX support in `extractDocument()` | `reader/pptx.rs` | PowerPoint processing |
| `extractExif(imagePath)` | `reader/image.rs` | Extract image metadata |

### Implementation Steps
1. Verify Rust xlsx/pptx readers are feature-enabled
2. Add bindings for new document types
3. Add ExifMetadata TypeScript type
4. Add extractExif method
5. Add tests with sample files
6. Update document-ingestion example

### Files to Modify
- `native/src/lib.rs`
- `native/src/types.ts` - Add ExifMetadata
- `native/src/index.ts`
- `native/__tests__/documents.test.ts` - Extend
- Add test fixtures: `native/__tests__/fixtures/sample.xlsx`, `sample.pptx`

---

## Batch 6: Security & Audit
**Effort:** 2-3 hours | **Priority:** Medium | **Dependencies:** None

### Methods to Implement
| Method | Rust Location | Description |
|--------|---------------|-------------|
| `audit(options)` | `memvid/audit.rs` | Generate audit report |
| `setAccessPolicy(policy)` | `memvid/mod.rs` | Configure access controls |
| `getAccessLog()` | `memvid/mod.rs` | Retrieve access log |

### Implementation Steps
1. Add Rust bindings
2. Add TypeScript types (AuditOptions, AuditReport, AccessPolicy)
3. Add wrapper methods
4. Add tests
5. Add security example

### Files to Modify
- `native/src/lib.rs`
- `native/src/types.ts`
- `native/src/index.ts`
- `native/__tests__/security.test.ts` - New test file
- `native/examples/security.ts` - New example

---

## Batch 7: Graph Search & Logic Mesh
**Effort:** 4-6 hours | **Priority:** High | **Dependencies:** Requires `logic_mesh` feature

### Methods to Implement
| Method | Rust Location | Description |
|--------|---------------|-------------|
| `meshNode(entityId)` | `types/mesh.rs` | Get node from entity graph |
| `meshEdges(entityId, direction?)` | `types/mesh.rs` | Get edges for entity |
| `followEdge(from, edgeType, hops?)` | `graph_search.rs` | Traverse relationships |
| `graphSearch(query, options)` | `graph_search.rs` | Graph-aware hybrid search |

### Implementation Steps
1. Verify logic_mesh feature is enabled in native build
2. Add MeshNode, MeshEdge, FollowResult types
3. Add Rust bindings
4. Add TypeScript types
5. Add wrapper methods
6. Add comprehensive tests
7. Add graph-search example

### Files to Modify
- `native/Cargo.toml` - Ensure logic_mesh feature
- `native/src/lib.rs`
- `native/src/types.ts` - Add mesh types
- `native/src/index.ts`
- `native/__tests__/graph-search.test.ts` - New test file
- `native/examples/graph-search.ts` - New example

---

## Batch 8: Session Replay
**Effort:** 6-8 hours | **Priority:** Medium | **Dependencies:** Requires `replay` feature

### Methods to Implement
| Method | Rust Location | Description |
|--------|---------------|-------------|
| `startSession(name)` | `replay/mod.rs` | Begin recording session |
| `endSession(handle)` | `replay/mod.rs` | End and save session |
| `createCheckpoint(handle, name)` | `replay/mod.rs` | Create named savepoint |
| `replay(sessionId, options)` | `replay/engine.rs` | Replay recorded session |
| `listSessions()` | `replay/mod.rs` | List all sessions |
| `deleteSession(sessionId)` | `replay/mod.rs` | Delete session |
| `compareSessions(id1, id2)` | `replay/engine.rs` | Compare two sessions |

### Implementation Steps
1. Verify replay feature is enabled
2. Add all session-related types
3. Add Rust bindings (7 methods)
4. Add TypeScript types
5. Add wrapper methods
6. Add comprehensive tests
7. Add replay example showing A/B testing workflow

### Files to Modify
- `native/Cargo.toml` - Ensure replay feature
- `native/src/lib.rs` - 7 new functions
- `native/src/types.ts` - Session types
- `native/src/index.ts` - 7 wrapper methods
- `native/__tests__/replay.test.ts` - New test file
- `native/examples/replay.ts` - New example

---

## Batch 9: Enrichment Pipeline
**Effort:** 8-10 hours | **Priority:** High | **Dependencies:** Multiple features required

### Methods to Implement
| Method | Rust Location | Description |
|--------|---------------|-------------|
| `startEnrichmentWorker(config)` | `enrichment_worker.rs` | Start background enrichment |
| `stopEnrichmentWorker(handle)` | `enrichment_worker.rs` | Stop worker |
| `enrichmentStats()` | `enrichment_worker.rs` | Get worker statistics |
| `extractEntities(text)` | `analysis/ner.rs` | NER entity extraction |
| `extractTriplets(text)` | `triplet/mod.rs` | SPO triplet extraction |
| `registerEnrichmentRule(rule)` | `enrich/rules.rs` | Add custom rule |

### Implementation Steps
1. Verify NER model availability
2. Add enrichment configuration types
3. Add Rust bindings
4. Add TypeScript types
5. Add wrapper methods
6. Add comprehensive tests (may need mocking for models)
7. Add enrichment example

### Files to Modify
- `native/Cargo.toml` - Ensure features
- `native/src/lib.rs` - 6 new functions
- `native/src/types.ts` - Enrichment types
- `native/src/index.ts` - 6 wrapper methods
- `native/__tests__/enrichment.test.ts` - New test file
- `native/examples/enrichment.ts` - New example

---

## Batch 10: CLIP Visual Search
**Effort:** 6-8 hours | **Priority:** Medium | **Dependencies:** Requires `clip` feature + model

### Methods to Implement
| Method | Rust Location | Description |
|--------|---------------|-------------|
| `enableClip(config?)` | `clip/mod.rs` | Initialize CLIP model |
| `putImage(path, options)` | `clip/mod.rs` | Ingest image with embedding |
| `searchClip(query, topK)` | `clip/mod.rs` | Text-to-image search |
| `searchByImage(imagePath, topK)` | `clip/mod.rs` | Image-to-image search |
| `clipEmbedding(imagePath)` | `clip/mod.rs` | Get image embedding |

### Implementation Steps
1. Verify CLIP feature and model availability
2. Add CLIP configuration types
3. Add Rust bindings
4. Add TypeScript types
5. Add wrapper methods
6. Add tests (need test images)
7. Add visual-search example

### Files to Modify
- `native/Cargo.toml` - Ensure clip feature
- `native/src/lib.rs` - 5 new functions
- `native/src/types.ts` - CLIP types
- `native/src/index.ts` - 5 wrapper methods
- `native/__tests__/clip.test.ts` - New test file
- `native/__tests__/fixtures/` - Add test images
- `native/examples/visual-search.ts` - New example

---

## Batch 11: Whisper Audio
**Effort:** 4-6 hours | **Priority:** Medium | **Dependencies:** Requires `whisper` feature + model

### Methods to Implement
| Method | Rust Location | Description |
|--------|---------------|-------------|
| `transcribeAudio(path)` | `whisper/mod.rs` | Transcribe audio file |
| `putAudio(path, options)` | `whisper/mod.rs` | Ingest audio with transcription |
| `audioSegments(frameId)` | `whisper/mod.rs` | Get transcription segments |

### Implementation Steps
1. Verify Whisper feature and model availability
2. Add audio configuration types
3. Add Rust bindings
4. Add TypeScript types
5. Add wrapper methods
6. Add tests (need test audio files)
7. Add audio-processing example

### Files to Modify
- `native/Cargo.toml` - Ensure whisper feature
- `native/src/lib.rs` - 3 new functions
- `native/src/types.ts` - Audio types
- `native/src/index.ts` - 3 wrapper methods
- `native/__tests__/whisper.test.ts` - New test file
- `native/__tests__/fixtures/` - Add test audio
- `native/examples/audio-processing.ts` - New example

---

## Batch 12: Sketch & Deduplication
**Effort:** 3-4 hours | **Priority:** Low | **Dependencies:** None

### Methods to Implement
| Method | Rust Location | Description |
|--------|---------------|-------------|
| `sketchSearch(query, options)` | `memvid/search/mod.rs` | Fast approximate search |
| `computeSketch(text)` | `types/sketch.rs` | Compute SimHash for text |
| `findDuplicates(threshold)` | `memvid/mod.rs` | Find near-duplicates |

### Implementation Steps
1. Add sketch-related types
2. Add Rust bindings
3. Add TypeScript types
4. Add wrapper methods
5. Add tests
6. Document deduplication workflow

### Files to Modify
- `native/src/lib.rs`
- `native/src/types.ts`
- `native/src/index.ts`
- `native/__tests__/sketch.test.ts` - New test file

---

## Execution Order

### Phase 1: Foundation (Batches 1-3)
Can run in parallel. No dependencies.

```
Agent A: Batch 1 (Core Utilities)
Agent B: Batch 2 (Optimization)
Agent C: Batch 3 (Memory Cards Advanced)
```

### Phase 2: Features (Batches 4-6)
Can run in parallel after Phase 1.

```
Agent A: Batch 4 (Ask/RAG Advanced)
Agent B: Batch 5 (Document Processing)
Agent C: Batch 6 (Security & Audit)
```

### Phase 3: Major Features (Batches 7-9)
Larger efforts, can run in parallel.

```
Agent A: Batch 7 (Graph Search) - 4-6 hours
Agent B: Batch 8 (Session Replay) - 6-8 hours
Agent C: Batch 9 (Enrichment) - 8-10 hours
```

### Phase 4: Multimodal (Batches 10-11)
Requires model downloads, can run in parallel.

```
Agent A: Batch 10 (CLIP)
Agent B: Batch 11 (Whisper)
```

### Phase 5: Polish (Batch 12)
Final batch, low priority.

```
Agent A: Batch 12 (Sketch/Dedup)
```

---

## Agent Instructions Template

When assigning a batch to an agent, use this template:

```
Implement SDK Batch N: [Batch Name]

See specs/SDK_IMPLEMENTATION_PLAN.md for details.

Requirements:
1. Add Rust bindings in native/src/lib.rs
2. Add TypeScript types in native/src/types.ts
3. Add wrapper methods in native/src/index.ts
4. Add tests in native/__tests__/[feature].test.ts
5. Update native/README.md with new methods
6. Run tests: cd native && npm test
7. Run format: cargo fmt --all

Commit format: feat(sdk): implement [feature] - [method names]
```

---

## Success Criteria

Each batch is complete when:
- [ ] All listed methods are implemented
- [ ] TypeScript types are defined and exported
- [ ] Unit tests pass for all new methods
- [ ] Documentation is updated
- [ ] Code passes `cargo fmt --all -- --check`
- [ ] Code passes `cargo clippy`
- [ ] npm tests pass: `cd native && npm test`
