# Memvid SDK Features Report

> Comprehensive analysis of memvid SDK features from docs.memvid.com
> Generated: 2026-01-10

---

## 1. CORE API METHODS/FUNCTIONS

### File Operations
| Method | Description |
|--------|-------------|
| `create(filepath)` | Create new memory file |
| `open(filepath)` | Open existing memory file |
| `close()` | Close connection and write any pending data |
| `use(framework, filepath)` | Open memory with framework adapter |

### Data Ingestion
| Method | Description |
|--------|-------------|
| `put(options)` | Add single document with embeddings |
| `putMany(documents)` | Batch document ingestion |
| `putPdfTables(pdf)` | Extract and ingest tables from PDFs |
| `put_many(documents)` | (Python) Batch insertion |
| `delete(frameId)` | Remove documents |
| `update(frameId, content)` | Modify existing entries |

### Search & Query
| Method | Description |
|--------|-------------|
| `find(query, options)` | Lexical/semantic hybrid search |
| `ask(question, options)` | AI-powered Q&A with LLM |
| `vecSearch(embedding)` | Vector similarity search |
| `vec-search` | (CLI) Raw vector search |
| `timeline(options)` | Temporal/chronological queries |
| `when(temporalPhrase)` | (CLI) Temporal phrase parsing |

### Memory Cards & Enrichment
| Method | Description |
|--------|-------------|
| `memories()` | Retrieve all extracted facts/memory cards |
| `state(entity)` | O(1) lookup of entity information |
| `enrich(type)` | Extract structured facts (rules, Groq, OpenAI, Claude, Candle) |
| `addMemoryCards(cards)` | Manually add memory cards |
| `exportFacts(format, entity)` | Export facts as JSON/CSV |
| `facts` | (CLI) Fact management |
| `schema` | (CLI) Define fact structures |

### Session Management
| Method | Description |
|--------|-------------|
| `sessionStart(label)` | Begin recording session |
| `sessionEnd()` | Stop recording |
| `sessionCheckpoint()` | Create checkpoint in session |
| `sessionReplay(id, params)` | Replay with different parameters/adaptive mode |
| `sessionDelete(id)` | Delete session |
| `session replay` | (CLI) Time-travel debugging |

### Table Processing
| Method | Description |
|--------|-------------|
| `listTables()` | List extracted tables |
| `getTable(id)` | Retrieve specific table |
| `tables import` | (CLI) Extract tables from PDFs |
| `tables list` | (CLI) View extracted tables |
| `tables export` | (CLI) Export as CSV |
| `tables view` | (CLI) Display table contents |

### Security & Encryption
| Method | Description |
|--------|-------------|
| `lock()` | Enable encryption |
| `unlock()` | Disable encryption |
| `lockWho()` | Get current lock state |
| `lockNudge()` | Force lock release |
| `maskPii()` | PII detection and masking |
| `lock/unlock` | (CLI) Encryption management |
| `binding/unbind` | (CLI) Access control |

### Utility Operations
| Method | Description |
|--------|-------------|
| `verify()` | File integrity check |
| `verify` | (CLI) Verify without modification |
| `doctor()` | Diagnostic/repair tool |
| `doctor` | (CLI) Repair corrupted files |
| `configure()` | API configuration |
| `audit` | (CLI) Access logging |

### Capacity Management
| Method | Description |
|--------|-------------|
| `syncTickets()` | Synchronize quota/capacity |
| `currentTicket()` | Get current ticket |
| `getCapacity()` | Check storage limits |
| `tickets sync` | (CLI) Synchronize quota |
| `tickets apply` | (CLI) Apply subscription updates |
| `plan show` | (CLI) View current plan |

---

## 2. CONFIGURATION OPTIONS

### Embedding Configuration

**API Providers:**
- OpenAI - OpenAI embeddings API
- Gemini - Google Gemini embeddings
- Mistral - Mistral embeddings
- Cohere - Cohere embeddings
- Voyage - Voyage embeddings
- NVIDIA - NVIDIA embeddings

**Local Models:**
- BGE_SMALL - Local BGE Small (384D)
- BGE_BASE - Local BGE Base (768D)
- NOMIC - Local Nomic (768D)
- GTE_LARGE - Local GTE Large (1024D)
- No-vec mode - Skip embeddings entirely (optional)

### LLM Integration Configuration
- OpenAI - GPT-4o, GPT-4o-mini, etc.
- Groq - Fast LLM inference
- Claude - Anthropic models
- Custom LLM - Bring your own model
- TinyLlama - Local LLM (CLI only)

### Framework Adapters
- `langchain` - LangChain vector store/retriever
- `llamaindex` - LlamaIndex index/query engine
- `vercel-ai` - Vercel AI SDK integration
- `openai` - OpenAI SDK compatibility
- `crewai` - CrewAI tools
- `autogen` - Microsoft AutoGen
- `haystack` - Haystack RAG
- `semantic-kernel` - Microsoft Semantic Kernel

### Search Configuration
| Option | Description |
|--------|-------------|
| `k` | Number of results (top_k) |
| `mode` | Search mode: 'lex' (BM25), 'sem' (semantic), 'hybrid' |
| `date_filter` | Filter by date range |
| `adaptive` | Enable adaptive retrieval |
| `scope` | Limit search to specific documents |
| `reranking` | Re-rank results by relevance |

### Ask/RAG Configuration
| Option | Description |
|--------|-------------|
| `model` | Specify LLM model |
| `modelApiKey` | API key for LLM |
| `context_only` | Return only context without answer |
| `source_citations` | Include source references |
| `pii_masking` | Enable PII masking in response |
| `custom_prompt` | Custom system prompt |

### Environment Variables
```bash
MEMVID_API_KEY      # Dashboard synchronization
OPENAI_API_KEY      # Embeddings/LLM access
GEMINI_API_KEY      # Gemini API key
MISTRAL_API_KEY     # Mistral API key
COHERE_API_KEY      # Cohere API key
VOYAGE_API_KEY      # Voyage API key
NVIDIA_API_KEY      # NVIDIA embeddings
GROQ_API_KEY        # Groq API key
MEMVID_TELEMETRY    # Control telemetry
```

---

## 3. SEARCH/QUERY CAPABILITIES

### Search Types
1. **Lexical Search (BM25)** - Keyword-based with term frequency scoring
2. **Semantic/Vector Search** - Embedding-based similarity
3. **Hybrid Search** - Combines lexical and semantic with result merging/reranking
4. **Graph Search** - Query entity relationships and knowledge graphs
5. **Raw Vector Search** - Direct embedding similarity (CLI/Python only)
6. **CLIP Visual Search** - Image-based search (CLI/Python only)

### Advanced Retrieval Features
- **Adaptive Retrieval** - Automatically determines optimal result count
- **Deduplication (SimHash)** - Prevents duplicate/similar content
- **Date Range Filtering** - Filter results by temporal range
- **Scope-based Filtering** - Limit search to specific documents/labels
- **Entity-based Filtering** - Filter by extracted entities
- **Temporal Phrase Parsing** - Natural language temporal queries
- **Time-Travel Queries** - Query memory at specific points in time

### Natural Language Q&A (Ask)
- RAG (Retrieval-Augmented Generation)
- Context-Only Mode
- Source Citations
- PII Masking in Context
- Custom Prompts
- Multi-turn Conversation

---

## 4. EMBEDDING/VECTOR FEATURES

### Vector Storage & Search
- Vector indexing (HNSW) - Hierarchical Navigable Small World graphs
- Vector similarity search
- 16x vector compression
- Multiple dimension support (384D, 768D, 1024D, 1536D)
- Batch embedding
- No-vec mode

### Local Embedding Models
| Model | Dimensions |
|-------|------------|
| BGE-Small | 384D |
| BGE-Base | 768D |
| Nomic | 768D |
| GTE-Large | 1024D |

### Visual Embeddings
- CLIP Integration
- Image Search
- Multimodal Support (CLI/Python only)

---

## 5. FILE FORMAT FEATURES (.mv2)

### File Structure
```
┌────────────────────────────┐
│ Header (4KB)               │  Magic, version, WAL offset, checksum
├────────────────────────────┤
│ Embedded WAL (1-64MB)      │  Ring buffer, crash recovery
├────────────────────────────┤
│ Frames                     │  Documents with payload, metadata
├────────────────────────────┤
│ Lexical Index (Tantivy)    │  BM25 full-text search
├────────────────────────────┤
│ Vector Index (HNSW)        │  Semantic similarity search
├────────────────────────────┤
│ Time Index Track           │  Chronological ordering
├────────────────────────────┤
│ Table of Contents          │  Navigation metadata
└────────────────────────────┘
```

### File Characteristics
- **Single-file guarantee** - No sidecar files
- **Fully portable** - Move between systems
- **Append-only** - Frames immutable once committed
- **Crash-safe** - WAL ensures durability
- **Compression** - Optional frame compression
- **Encryption** - AES-256-GCM password-based
- **Checksums** - Cascading BLAKE3 checksums

### Performance
- Search latency: ~5ms for 50K documents
- Cold start: Under 200ms
- WAL append: Under 0.1ms per write

---

## 6. NOTABLE FUNCTIONALITY

### Enrichment Features
- Memory Cards - Entity-attribute-value triples
- Entity Extraction - Automatic extraction
- Logic Mesh - Knowledge graph
- Multiple Enrichment Engines (Rules, Groq, OpenAI, Claude, Candle)
- Fact Provenance - Track history and sources
- Schema Definition - Custom extraction schemas

### Media Processing
- Audio Transcription
- Video Processing
- Table Extraction from PDFs
- CLIP Visual Embeddings
- PDF, DOCX, XLSX, PPTX Processing
- EXIF Parsing

### Security & Privacy
- AES-256-GCM Encryption
- PII Detection & Masking
- Access Control
- Capacity Limits
- Granular Permissions

### Sessions & Debugging
- Session Recording
- Session Checkpoints
- Session Replay
- Time-Travel Debugging
- A/B Testing
- Audit Logging

### Maintenance & Repair
- File Verification
- Automatic Repair
- Index Rebuilding
- Vacuuming
- Doctor Command
- Statistics

---

## 7. FEATURE SUPPORT MATRIX BY PLATFORM

| Feature | CLI | Python | Node.js |
|---------|:---:|:------:|:-------:|
| Core create/open/put | ✓ | ✓ | ✓ |
| Lexical/semantic/hybrid search | ✓ | ✓ | ✓ |
| Adaptive retrieval | ✓ | ✓ | ✓ |
| Ask/RAG | ✓ | ✓ | ✓ |
| CLIP visual search | ✓ | ✓ | ✗ |
| Graph search | ✓ | ✓ | ✗ |
| Raw vector search | ✓ | ✓ | ✗ |
| Memory cards/enrichment | ✓ | ✓ | ✓ |
| All enrichment engines | ✓ | ✓ | Partial |
| Entity state lookup | ✓ | ✓ | ✓ |
| Fact provenance | ✓ | ✓ | ✗ |
| Tables (import/list/export) | ✓ | ✓ | ✓ |
| Timeline/time-travel | ✓ | ✓ | ✗ |
| Session recording/replay | ✓ | ✓ | ✗ |
| Encryption | ✓ | ✓ | ✓ |
| PII masking | ✓ | ✓ | ✗ |
| PDF processing | ✓ | ✓ | ✓ |
| DOCX processing | ✓ | ✓ | ✓ |
| XLSX processing | ✓ | ✓ | ✗ |
| PPTX processing | ✓ | ✓ | ✗ |
| Verification/repair | ✓ | ✓ | ✗ |
| JSON output | ✓ | ✓ | ✓ |
| Streaming output | ✗ | ✗ | ✓ |
| Framework integrations | Limited | Limited | ✓ |

---

## 8. OUR NODE.JS IMPLEMENTATION STATUS

### Implemented ✅
| Feature | Status |
|---------|--------|
| `create()` | ✅ |
| `open()` | ✅ |
| `close()` | ✅ |
| `put()` | ✅ |
| `putWithEmbedding()` | ✅ |
| `find()` with filters | ✅ (uri, scope, excludeFrameIds, excludeUris) |
| `vecSearch()` with filters | ✅ |
| `timeline()` | ✅ |
| `frame()` | ✅ |
| `view()` | ✅ |
| `stats()` | ✅ |
| `enableLex()` | ✅ |
| `enableVec()` | ✅ |
| `commit()` | ✅ |
| OpenAI embeddings | ✅ |
| MockEmbeddings | ✅ |
| Query-time exclusion filters | ✅ |

### Not Implemented ❌
| Feature | Priority |
|---------|----------|
| `ask()` - RAG Q&A | High |
| `putMany()` - batch ingestion | High |
| Memory cards / enrichment | Medium |
| Session recording/replay | Medium |
| Encryption (lock/unlock) | Medium |
| PII masking | Low |
| Graph search | Low |
| CLIP visual search | Low |
| Table extraction | Low |
| Adaptive retrieval | Low |
| Framework integrations | Low |
| `verify()`, `doctor()` | Low |

---

## Summary Statistics

- **Total API Methods/Commands**: 100+
- **Search Types**: 6
- **Embedding Providers**: 6 API + 4 Local
- **LLM Providers**: 4
- **Framework Integrations**: 8+
- **Media Formats**: 5+
- **Security Features**: Encryption, PII, Access Control
