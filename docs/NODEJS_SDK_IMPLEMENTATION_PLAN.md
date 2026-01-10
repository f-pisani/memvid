# Node.js SDK Implementation Plan

> Tracking implementation of advertised features missing from our Node.js SDK
> All features listed here are advertised in the official memvid Node.js SDK docs AND already implemented in Rust.

---

## Implementation Checklist

### 1. Hybrid Search
- [x] Add `HybridSearchOptions` DTO
- [x] Add `hybrid_search()` method to `MemvidHandle`
- [x] Add Node.js tests

### 2. Adaptive Retrieval
- [x] Add `AdaptiveSearchOptions` DTO
- [x] Add `AdaptiveStatsResult` DTO
- [x] Add `AdaptiveSearchResult` DTO
- [x] Add `search_adaptive()` method to `MemvidHandle`
- [x] Add Node.js tests

### 3. Memory Cards / Enrichment
- [x] Add `MemoryCardInput` DTO
- [x] Add `MemoryCardResult` DTO
- [x] Add `MemoriesStatsResult` DTO
- [x] Add `put_memory_card()` method
- [x] Add `put_memory_cards()` method
- [x] Add `get_current_memory()` method
- [x] Add `get_entity_memories()` method
- [x] Add `memories_stats()` method
- [x] Add `memory_card_count()` method
- [x] Add `clear_memories()` method
- [x] Add Node.js tests

### 4. Entity State Lookup
- [x] Add `state()` method (O(1) entity:slot lookup)
- [x] Add Node.js tests

### 5. Table Processing
- [x] Add `TableExtractionOptions` DTO
- [x] Add `ExtractedTableResult` DTO
- [x] Add `TableSummaryResult` DTO
- [x] Add `extract_tables()` method
- [x] Add `list_tables()` method
- [x] Add `get_table()` method
- [x] Add `export_table_csv()` method
- [x] Add `export_table_json()` method
- [x] Add Node.js tests

### 6. Encryption
- [x] Add `lock()` module function
- [x] Add `unlock()` module function
- [x] Add Node.js tests (feature-gated)

### 7. Document Processing (PDF/DOCX)
- [x] Add `DocumentExtractionResult` DTO
- [x] Add `extract_document()` method
- [x] Add `put_document()` method (auto-detect format)
- [x] Add Node.js tests

### 8. Streaming Output
- [x] Add `blob()` method (get raw bytes)
- [x] Add Node.js tests

### 9. Update Frame
- [x] Add `UpdateFrameOptions` DTO
- [x] Add `update()` method
- [x] Add Node.js tests

### 10. Doctor/Repair
- [x] Add `DoctorResultOutput` DTO
- [x] Add `doctor()` module function
- [x] Add Node.js tests

---

## Summary

**Status: COMPLETE**

- **Started**: 2026-01-10
- **Completed**: 2026-01-10
- **Branch**: `feat/nodejs-sdk-complete`

### Test Results
- Rust tests: 289 passed
- Node.js tests: 100 passed, 1 skipped (PDF table extraction)

### Files Modified
- `native/src/lib.rs` - Added all NAPI bindings (~900 lines of new code)
- `native/Cargo.toml` - Enabled encryption feature by default
- Various Rust source files - Minor clippy fixes

### Test Files
Tests organized by feature:
- `native/__tests__/memory-cards.test.ts` - Memory card operations
- `native/__tests__/hybrid-search.test.ts` - Hybrid/adaptive search tests
- `native/__tests__/documents.test.ts` - Document processing tests
- `native/__tests__/diagnostics.test.ts` - Update/doctor operations

### Examples Added
Comprehensive examples with detailed documentation:
- `native/examples/memory-cards.ts` - Structured fact storage for AI agents
- `native/examples/hybrid-search.ts` - Combined lexical + vector search
- `native/examples/document-ingestion.ts` - PDF/DOCX processing
- `native/examples/tables.ts` - Table extraction from PDFs
- `native/examples/encryption.ts` - File security operations
- `native/examples/file-maintenance.ts` - Verify/doctor/repair workflows
- `native/examples/README.md` - Usage guide and common patterns

### New Bindings Added

| Category | Methods Added |
|----------|---------------|
| Hybrid Search | `hybrid_search()` |
| Adaptive Retrieval | `search_adaptive()` |
| Memory Cards | `put_memory_card()`, `put_memory_cards()`, `get_current_memory()`, `get_entity_memories()`, `memories_stats()`, `memory_card_count()`, `clear_memories()` |
| Entity State | `state()` |
| Table Processing | `extract_tables()`, `list_tables()`, `get_table()`, `export_table_csv()`, `export_table_json()` |
| Encryption | `lock()`, `unlock()` (module-level) |
| Document Processing | `extract_document()`, `put_document()` |
| Streaming | `blob()` |
| Update Frame | `update()` |
| Doctor | `doctor()` (module-level) |

**Total: 21 new functions/methods**
