# SDK Feature Parity Analysis

**Date:** 2026-01-11
**Rust Core Methods:** ~153
**Node.js SDK Bindings:** 50
**Gap:** 103 methods not exposed

## Executive Summary

The Node.js SDK implements ~60-70% of Rust core functionality. Core features (search, memory cards, documents, encryption) are complete. Major gaps exist in multimodal, replay, enrichment, and graph search.

---

## Feature Status by Category

### 1. Core File Operations (100% Complete)

| Feature | Rust | Node.js | Notes |
|---------|:----:|:-------:|-------|
| `create(path)` | ✅ | ✅ | Complete |
| `open(path)` | ✅ | ✅ | Complete |
| `open_read_only(path)` | ✅ | ❌ | **MISSING** |
| `close()` | ✅ | ✅ | Complete |
| `stats()` | ✅ | ✅ | Complete |
| `path()` | ✅ | ✅ | Complete |

### 2. Data Ingestion (95% Complete)

| Feature | Rust | Node.js | Notes |
|---------|:----:|:-------:|-------|
| `put_bytes()` | ✅ | ✅ | Complete |
| `put_bytes_with_options()` | ✅ | ✅ | Complete |
| `put_with_embedding()` | ✅ | ✅ | Complete |
| `put_with_embedding_and_options()` | ✅ | ❌ | **MISSING** |
| `put_with_chunk_embeddings()` | ✅ | ❌ | **MISSING** (advanced) |
| `update_frame()` | ✅ | ✅ | Complete |
| `delete_frame()` | ✅ | ✅ | Complete |
| `commit()` | ✅ | ✅ | Complete |
| `commit_with_options()` | ✅ | ❌ | **MISSING** |

### 3. Search - Lexical (100% Complete)

| Feature | Rust | Node.js | Notes |
|---------|:----:|:-------:|-------|
| `enable_lex()` | ✅ | ✅ | Complete |
| `search()` / `find()` | ✅ | ✅ | Complete |
| BM25 scoring | ✅ | ✅ | Complete |
| Snippet generation | ✅ | ✅ | Complete |
| URI/scope filtering | ✅ | ✅ | Complete |
| Pagination | ✅ | ✅ | Complete |
| Memory card filtering | ✅ | ✅ | Complete |

### 4. Search - Vector (90% Complete)

| Feature | Rust | Node.js | Notes |
|---------|:----:|:-------:|-------|
| `enable_vec()` | ✅ | ✅ | Complete |
| `search_vec()` | ✅ | ✅ | Complete |
| HNSW indexing | ✅ | ✅ | Complete |
| `vec_search_with_embedding()` | ✅ | ❌ | **MISSING** |
| Vector quantization (PQ) | ✅ | ❌ | **MISSING** (advanced) |

### 5. Search - Hybrid & Adaptive (100% Complete)

| Feature | Rust | Node.js | Notes |
|---------|:----:|:-------:|-------|
| `hybrid_search()` | ✅ | ✅ | Complete |
| `search_adaptive()` | ✅ | ✅ | Complete |
| Dynamic result sizing | ✅ | ✅ | Complete |
| Multiple cutoff strategies | ✅ | ✅ | Complete |

### 6. Search - Graph (0% Complete)

| Feature | Rust | Node.js | Notes |
|---------|:----:|:-------:|-------|
| `hybrid_search()` with graph | ✅ | ❌ | **NOT IMPLEMENTED** |
| Entity-relationship traversal | ✅ | ❌ | **NOT IMPLEMENTED** |
| Logic Mesh queries | ✅ | ❌ | **NOT IMPLEMENTED** |
| `mesh_node()` | ✅ | ❌ | **NOT IMPLEMENTED** |
| `mesh_edges()` | ✅ | ❌ | **NOT IMPLEMENTED** |
| `follow_edge()` | ✅ | ❌ | **NOT IMPLEMENTED** |

### 7. Timeline & Temporal (80% Complete)

| Feature | Rust | Node.js | Notes |
|---------|:----:|:-------:|-------|
| `timeline()` | ✅ | ✅ | Complete |
| Time range filtering | ✅ | ✅ | Complete |
| Reverse order | ✅ | ✅ | Complete |
| Temporal track | ✅ | ❌ | **MISSING** (feature-gated) |
| Natural language time parsing | ✅ | ❌ | **MISSING** |

### 8. Ask/RAG (85% Complete)

| Feature | Rust | Node.js | Notes |
|---------|:----:|:-------:|-------|
| `ask()` | ✅ | ✅ | Complete |
| Lexical/semantic/hybrid modes | ✅ | ✅ | Complete |
| Citation generation | ✅ | ✅ | Complete |
| Context-only mode | ✅ | ✅ | Complete |
| Custom prompts | ✅ | ❌ | **MISSING** |
| PII masking in context | ✅ | ❌ | **MISSING** |
| Multi-turn conversation | ✅ | ❌ | **MISSING** |

### 9. Memory Cards (90% Complete)

| Feature | Rust | Node.js | Notes |
|---------|:----:|:-------:|-------|
| `put_memory_card()` | ✅ | ✅ | Complete |
| `put_memory_cards()` | ✅ | ✅ | Complete |
| `get_current_memory()` | ✅ | ✅ | Complete |
| `get_entity_memories()` | ✅ | ✅ | Complete |
| `memories_stats()` | ✅ | ✅ | Complete |
| `memory_card_count()` | ✅ | ✅ | Complete |
| `clear_memories()` | ✅ | ✅ | Complete |
| `state()` | ✅ | ✅ | Complete |
| Memory filter in search | ✅ | ✅ | Complete |
| `memory_card_history()` | ✅ | ❌ | **MISSING** |
| `infer_schema()` | ✅ | ❌ | **MISSING** |

### 10. Tables (100% Complete)

| Feature | Rust | Node.js | Notes |
|---------|:----:|:-------:|-------|
| `extract_tables()` | ✅ | ✅ | Complete |
| `list_tables()` | ✅ | ✅ | Complete |
| `get_table()` | ✅ | ✅ | Complete |
| `export_table_csv()` | ✅ | ✅ | Complete |
| `export_table_json()` | ✅ | ✅ | Complete |

### 11. Documents (75% Complete)

| Feature | Rust | Node.js | Notes |
|---------|:----:|:-------:|-------|
| `extract_document()` | ✅ | ✅ | Complete |
| `put_document()` | ✅ | ✅ | Complete |
| PDF processing | ✅ | ✅ | Complete |
| DOCX processing | ✅ | ✅ | Complete |
| XLSX processing | ✅ | ❌ | **MISSING** |
| PPTX processing | ✅ | ❌ | **MISSING** |
| Image EXIF parsing | ✅ | ❌ | **MISSING** |

### 12. Encryption (90% Complete)

| Feature | Rust | Node.js | Notes |
|---------|:----:|:-------:|-------|
| `lock()` | ✅ | ✅ | Complete |
| `unlock()` | ✅ | ✅ | Complete |
| `mask_pii()` | ✅ | ✅ | Complete |
| `contains_pii()` | ✅ | ✅ | Complete |
| `.mv2e` format | ✅ | ✅ | Complete |
| `audit()` | ✅ | ❌ | **MISSING** |

### 13. Verification & Repair (85% Complete)

| Feature | Rust | Node.js | Notes |
|---------|:----:|:-------:|-------|
| `verify()` | ✅ | ✅ | Complete |
| `doctor()` | ✅ | ✅ | Complete |
| `rebuild_indexes()` | ✅ | ✅ | Complete |
| `vacuum()` | ✅ | ❌ | **MISSING** |
| `compact_wal()` | ✅ | ❌ | **MISSING** |

### 14. Frame Operations (85% Complete)

| Feature | Rust | Node.js | Notes |
|---------|:----:|:-------:|-------|
| `frame()` | ✅ | ✅ | Complete |
| `view()` | ✅ | ✅ | Complete |
| `blob()` | ✅ | ✅ | Complete |
| `blob_reader()` | ✅ | ✅ | Complete |
| `frame_by_uri()` | ✅ | ❌ | **MISSING** |
| `frame_embedding()` | ✅ | ❌ | **MISSING** |
| `media_manifest()` | ✅ | ❌ | **MISSING** |

### 15. Multimodal - CLIP (0% Complete)

| Feature | Rust | Node.js | Notes |
|---------|:----:|:-------:|-------|
| `enable_clip()` | ✅ | ❌ | **NOT IMPLEMENTED** |
| `put_image()` | ✅ | ❌ | **NOT IMPLEMENTED** |
| `search_clip()` | ✅ | ❌ | **NOT IMPLEMENTED** |
| `search_by_image()` | ✅ | ❌ | **NOT IMPLEMENTED** |
| Image embeddings | ✅ | ❌ | **NOT IMPLEMENTED** |

### 16. Multimodal - Whisper (0% Complete)

| Feature | Rust | Node.js | Notes |
|---------|:----:|:-------:|-------|
| `transcribe_audio()` | ✅ | ❌ | **NOT IMPLEMENTED** |
| `put_audio()` | ✅ | ❌ | **NOT IMPLEMENTED** |
| Audio segment metadata | ✅ | ❌ | **NOT IMPLEMENTED** |

### 17. Session Replay (0% Complete)

| Feature | Rust | Node.js | Notes |
|---------|:----:|:-------:|-------|
| `start_session()` | ✅ | ❌ | **NOT IMPLEMENTED** |
| `end_session()` | ✅ | ❌ | **NOT IMPLEMENTED** |
| `create_checkpoint()` | ✅ | ❌ | **NOT IMPLEMENTED** |
| `replay()` | ✅ | ❌ | **NOT IMPLEMENTED** |
| `list_sessions()` | ✅ | ❌ | **NOT IMPLEMENTED** |
| `delete_session()` | ✅ | ❌ | **NOT IMPLEMENTED** |
| `compare_sessions()` | ✅ | ❌ | **NOT IMPLEMENTED** |

### 18. Enrichment (5% Complete)

| Feature | Rust | Node.js | Notes |
|---------|:----:|:-------:|-------|
| `start_enrichment_worker()` | ✅ | ❌ | **NOT IMPLEMENTED** |
| `stop_enrichment_worker()` | ✅ | ❌ | **NOT IMPLEMENTED** |
| `enrichment_stats()` | ✅ | ❌ | **NOT IMPLEMENTED** |
| Entity extraction (NER) | ✅ | ❌ | **NOT IMPLEMENTED** |
| Triplet extraction | ✅ | ❌ | **NOT IMPLEMENTED** |
| Rules-based enrichment | ✅ | ❌ | **NOT IMPLEMENTED** |
| LLM enrichment (Groq/OpenAI/Claude) | ✅ | ❌ | **NOT IMPLEMENTED** |
| Schema registry | ✅ | ❌ | **NOT IMPLEMENTED** |

### 19. Sketch & Deduplication (0% Complete)

| Feature | Rust | Node.js | Notes |
|---------|:----:|:-------:|-------|
| `sketch_search()` | ✅ | ❌ | **NOT IMPLEMENTED** |
| SimHash generation | ✅ | ❌ | **NOT IMPLEMENTED** |
| Near-duplicate detection | ✅ | ❌ | **NOT IMPLEMENTED** |

---

## Implementation Priority

### Priority 1: Quick Wins (1-2 hours each)
Simple method exposures with minimal logic:
- `open_read_only()`
- `put_with_embedding_and_options()`
- `commit_with_options()`
- `frame_by_uri()`
- `frame_embedding()`
- `vacuum()`
- `compact_wal()`
- `memory_card_history()`

### Priority 2: Medium Effort (2-4 hours each)
Require some new types or logic:
- Ask improvements (custom prompts, PII masking)
- Document processing (XLSX, PPTX)
- `audit()` function
- Graph search basics

### Priority 3: Major Features (1-2 days each)
Significant new subsystems:
- **Session Replay** - Full recording/playback system
- **Enrichment Pipeline** - Worker, NER, triplet extraction
- **CLIP Integration** - Image embeddings and visual search
- **Whisper Integration** - Audio transcription
- **Logic Mesh** - Entity graph queries

---

## Missing Methods Checklist

### Batch 1: Core Utilities
- [ ] `open_read_only(path: string): Memvid`
- [ ] `put_with_embedding_and_options(content, embedding, options)`
- [ ] `commit_with_options(options: CommitOptions)`
- [ ] `frame_by_uri(uri: string): Frame | null`
- [ ] `frame_embedding(frameId: number): number[] | null`
- [ ] `media_manifest(frameId: number): MediaManifest | null`

### Batch 2: Optimization
- [ ] `vacuum(): VacuumResult`
- [ ] `compact_wal(): CompactResult`
- [ ] `put_with_chunk_embeddings(content, chunks)`

### Batch 3: Memory Cards Advanced
- [ ] `memory_card_history(entity, slot): MemoryCard[]`
- [ ] `infer_schema(): SchemaInference`

### Batch 4: Ask/RAG Advanced
- [ ] `ask()` with custom prompt support
- [ ] `ask()` with PII masking option
- [ ] `ask()` with conversation history

### Batch 5: Documents
- [ ] XLSX document processing
- [ ] PPTX document processing
- [ ] Image EXIF extraction

### Batch 6: Security
- [ ] `audit(options): AuditReport`

### Batch 7: Graph Search
- [ ] `mesh_node(entityId): MeshNode`
- [ ] `mesh_edges(entityId): MeshEdge[]`
- [ ] `follow_edge(fromEntity, edgeType): FollowResult`
- [ ] Graph-aware hybrid search

### Batch 8: Session Replay
- [ ] `start_session(name): SessionHandle`
- [ ] `end_session(handle)`
- [ ] `create_checkpoint(handle, name)`
- [ ] `replay(sessionId, options): ReplayResult`
- [ ] `list_sessions(): SessionSummary[]`
- [ ] `delete_session(sessionId)`
- [ ] `compare_sessions(id1, id2): ComparisonReport`

### Batch 9: Enrichment
- [ ] `start_enrichment_worker(config): WorkerHandle`
- [ ] `stop_enrichment_worker(handle)`
- [ ] `enrichment_stats(): EnrichmentStats`
- [ ] NER entity extraction
- [ ] Triplet extraction
- [ ] Rules engine integration

### Batch 10: Multimodal - CLIP
- [ ] `enable_clip()`
- [ ] `put_image(path, options)`
- [ ] `search_clip(query, topK)`
- [ ] `search_by_image(imagePath, topK)`

### Batch 11: Multimodal - Whisper
- [ ] `transcribe_audio(path): TranscriptionResult`
- [ ] `put_audio(path, options)`

### Batch 12: Sketch/Dedup
- [ ] `sketch_search(query, options)`
- [ ] Near-duplicate detection utilities

---

## Notes

- Feature-gated Rust features (temporal_track, logic_mesh, clip, whisper) require corresponding Cargo features enabled
- Some methods may need new TypeScript types in `native/src/types.ts`
- Each batch should include: Rust bindings, TypeScript wrapper, tests, and documentation
