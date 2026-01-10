# CLAUDE.md

This file provides guidance to Claude Code and other AI assistants working with this repository.

## Project Overview

Memvid is a Rust library that provides a single-file memory layer for AI agents. It packages documents, embeddings, search indices, and metadata into a portable `.mv2` file.

## Architecture

### Core Components

```
src/
├── lib.rs              # Public API exports
├── memvid/             # Main Memvid struct and operations
│   ├── mod.rs          # Memvid implementation
│   ├── mutation.rs     # Write operations (put, commit, delete)
│   ├── search/         # Search implementations
│   └── ask.rs          # RAG query handling
├── io/                 # File I/O layer
│   ├── header.rs       # File header (4KB)
│   ├── wal.rs          # Write-ahead log
│   └── time_index.rs   # Chronological index
├── lex.rs              # Full-text search (Tantivy)
├── vec.rs              # Vector search (HNSW)
├── clip.rs             # CLIP embeddings
├── whisper.rs          # Audio transcription
└── types/              # Type definitions
```

### File Format (.mv2)

```
┌────────────────────────────┐
│ Header (4KB)               │
├────────────────────────────┤
│ Embedded WAL (1-64MB)      │
├────────────────────────────┤
│ Data Segments              │
├────────────────────────────┤
│ Lex Index (Tantivy)        │
├────────────────────────────┤
│ Vec Index (HNSW)           │
├────────────────────────────┤
│ Time Index                 │
├────────────────────────────┤
│ TOC (Footer)               │
└────────────────────────────┘
```

## Development Commands

```bash
# Build
cargo build
cargo build --release

# Test
cargo test -p memvid-core
cargo test --test lifecycle
cargo test -- --nocapture

# Lint (MUST pass before pushing)
cargo fmt --all -- --check
cargo clippy --all-targets

# Fix formatting
cargo fmt --all

# Run examples
cargo run --example basic_usage
cargo run --example pdf_ingestion

# Benchmarks
cargo bench
```

## Before Pushing Checklist

**ALWAYS run these commands before pushing to ensure CI passes:**

```bash
# 1. Format check (CI will fail if not formatted)
cargo fmt --all -- --check

# 2. Run tests
cargo test -p memvid-core

# 3. If format check fails, fix it:
cargo fmt --all
```

**Do NOT push without verifying locally that:**
1. `cargo fmt --all -- --check` passes (no diff output)
2. `cargo test -p memvid-core` passes
3. Any new features have tests

## Pull Request Workflow

**Always open PRs as draft** unless the user explicitly requests otherwise. This allows:
- CI to run on every push for validation during development
- The user to mark ready for review when they're satisfied
- Avoiding premature review requests

```bash
# Create a draft PR
gh pr create --draft --title "feat: description" --body "..."

# Mark ready when done
gh pr ready
```

## Key APIs

```rust
// Create/Open
let mut mem = Memvid::create("file.mv2")?;
let mut mem = Memvid::open("file.mv2")?;

// Write
mem.put_bytes(content)?;
mem.put_bytes_with_options(content, options)?;
mem.commit()?;

// Search
mem.search(SearchRequest { query, top_k, .. })?;
mem.timeline(TimelineQuery::default())?;

// Verify
Memvid::verify("file.mv2", deep)?;
```

## Feature Flags

| Feature | Purpose |
|---------|---------|
| `lex` | Full-text search (default) |
| `vec` | Vector similarity search |
| `clip` | CLIP image embeddings |
| `whisper` | Audio transcription |
| `encryption` | AES-256-GCM encryption |

## Code Style

- Follow Rust idioms and best practices
- Use `thiserror` for error types
- Use `tracing` for logging
- Add doc comments for public APIs
- Write tests for new functionality

## Important Notes

- Single-file design: Never create sidecar files
- Crash safety: All writes go through WAL
- Append-only: Frames are immutable once committed
- No async: Library is synchronous for simplicity
