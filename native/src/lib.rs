//! Node.js bindings for memvid-core
//!
//! This module provides NAPI bindings to expose memvid-core functionality to Node.js.
//! All operations are thread-safe via Arc<Mutex<>> and panic-safe via catch_unwind.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Mutex};

use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde::{Deserialize, Serialize};

use memvid_core::graph_search::{hybrid_search as rust_graph_hybrid_search, QueryPlanner};
use memvid_core::reader::{DocumentFormat, ReaderHint, ReaderRegistry};
use memvid_core::table::{
    export_to_csv, export_to_json, extract_tables_from_pdf, get_table as rust_get_table,
    list_tables as rust_list_tables, ExtractionMode,
    TableExtractionOptions as RustTableExtractionOptions,
};
use memvid_core::types::{
    AdaptiveConfig, AskMode as RustAskMode, AskRequest as RustAskRequest, CutoffStrategy,
    DoctorOptions as RustDoctorOptions, DoctorStatus, MemoryCard, MemoryCardBuilder, MemoryKind,
    VecEmbedder,
};
use memvid_core::Memvid;

use memvid_core::encryption::{lock_file, unlock_file};
use memvid_core::pii;

// ============================================================================
// Noop Embedder (for lex-only ask)
// ============================================================================

/// A no-op embedder used when calling ask() in lex-only mode.
/// This type is never instantiated - we always pass None.
struct NoopEmbedder;

impl VecEmbedder for NoopEmbedder {
    fn embed_query(&self, _text: &str) -> memvid_core::Result<Vec<f32>> {
        // Should never be called since we pass None
        Err(memvid_core::MemvidError::VecNotEnabled)
    }

    fn embedding_dimension(&self) -> usize {
        0
    }
}

// ============================================================================
// Error Handling
// ============================================================================

/// Extract error code from memvid error
fn error_code(e: &memvid_core::MemvidError) -> &'static str {
    use memvid_core::MemvidError::*;
    match e {
        Io { .. } => "IO_ERROR",
        Encode(_) => "ENCODE_ERROR",
        Decode(_) => "DECODE_ERROR",
        Lock(_) => "LOCK_ERROR",
        Locked(_) => "FILE_LOCKED",
        ChecksumMismatch { .. } => "CHECKSUM_MISMATCH",
        InvalidHeader { .. } => "INVALID_HEADER",
        EncryptedFile { .. } => "ENCRYPTED_FILE",
        InvalidToc { .. } => "INVALID_TOC",
        InvalidTimeIndex { .. } => "INVALID_TIME_INDEX",
        InvalidSketchTrack { .. } => "INVALID_SKETCH_TRACK",
        InvalidLogicMesh { .. } => "INVALID_LOGIC_MESH",
        LogicMeshNotEnabled => "LOGIC_MESH_NOT_ENABLED",
        NerModelNotAvailable { .. } => "NER_MODEL_NOT_AVAILABLE",
        LexNotEnabled => "LEX_NOT_ENABLED",
        VecNotEnabled => "VEC_NOT_ENABLED",
        ClipNotEnabled => "CLIP_NOT_ENABLED",
        VecDimensionMismatch { .. } => "VEC_DIMENSION_MISMATCH",
        AuxiliaryFileDetected { .. } => "AUXILIARY_FILE_DETECTED",
        WalCorruption { .. } => "WAL_CORRUPTION",
        ManifestWalCorrupted { .. } => "MANIFEST_WAL_CORRUPTED",
        CheckpointFailed { .. } => "CHECKPOINT_FAILED",
        MemoryAlreadyBound { .. } => "MEMORY_ALREADY_BOUND",
        RequiresSealed => "REQUIRES_SEALED",
        RequiresOpen => "REQUIRES_OPEN",
        DoctorNoOp => "DOCTOR_NO_OP",
        Doctor { .. } => "DOCTOR_ERROR",
        FeatureUnavailable { .. } => "FEATURE_UNAVAILABLE",
        InvalidCursor { .. } => "INVALID_CURSOR",
        InvalidFrame { .. } => "INVALID_FRAME",
        FrameNotFound { .. } => "FRAME_NOT_FOUND",
        FrameNotFoundByUri { .. } => "FRAME_NOT_FOUND",
        ModelSignatureInvalid { .. } => "MODEL_SIGNATURE_INVALID",
        ModelManifestInvalid { .. } => "MODEL_MANIFEST_INVALID",
        ModelIntegrity { .. } => "MODEL_INTEGRITY_ERROR",
        ExtractionFailed { .. } => "EXTRACTION_FAILED",
        EmbeddingFailed { .. } => "EMBEDDING_FAILED",
        RerankFailed { .. } => "RERANK_FAILED",
        InvalidQuery { .. } => "INVALID_QUERY",
        Tantivy { .. } => "TANTIVY_ERROR",
        TableExtraction { .. } => "TABLE_EXTRACTION_ERROR",
        SchemaValidation { .. } => "SCHEMA_VALIDATION_ERROR",
        #[cfg(feature = "temporal_track")]
        InvalidTemporalTrack { .. } => "INVALID_TEMPORAL_TRACK",
        // Catch-all for any future variants
        #[allow(unreachable_patterns)]
        _ => "UNKNOWN_ERROR",
    }
}

/// Convert a memvid error to a NAPI error with structured code
fn memvid_to_napi_error(e: memvid_core::MemvidError) -> napi::Error {
    let code = error_code(&e);
    let message = e.to_string();
    napi::Error::from_reason(format!("[{}] {}", code, message))
}

/// Wrap an operation with panic catching
///
/// This is the FFI boundary panic safety layer. We catch all panics to prevent
/// them from unwinding across the Rust/Node.js boundary which would cause UB.
/// The caller is responsible for ensuring the operation is unwind-safe by using
/// AssertUnwindSafe appropriately.
fn catch_panic<F, T>(f: F) -> napi::Result<T>
where
    F: FnOnce() -> napi::Result<T> + std::panic::UnwindSafe,
{
    match catch_unwind(f) {
        Ok(result) => result,
        Err(_) => Err(napi::Error::from_reason("[PANIC] Rust panic occurred")),
    }
}

/// Safely convert u64 to i64, returning error on overflow
fn u64_to_i64(val: u64) -> napi::Result<i64> {
    i64::try_from(val).map_err(|_| {
        napi::Error::from_reason(format!("[INTEGER_OVERFLOW] Value {} exceeds i64::MAX", val))
    })
}

/// Safely convert i64 to usize, returning error on negative or overflow
fn i64_to_usize(val: i64) -> napi::Result<usize> {
    usize::try_from(val).map_err(|_| {
        napi::Error::from_reason(format!(
            "[INTEGER_OVERFLOW] Cannot convert {} to usize",
            val
        ))
    })
}

/// Safely convert i32 to usize, returning error on negative values
fn i32_to_usize(val: i32) -> napi::Result<usize> {
    usize::try_from(val).map_err(|_| {
        napi::Error::from_reason(format!(
            "[INTEGER_OVERFLOW] Cannot convert {} to usize (negative)",
            val
        ))
    })
}

/// Maximum allowed embedding dimension (64K dimensions should cover all known models)
const MAX_EMBEDDING_DIM: usize = 65536;

/// Validate embedding vector size to prevent DoS via memory exhaustion
fn validate_embedding_size(embedding: &[f64]) -> napi::Result<()> {
    if embedding.is_empty() {
        return Err(napi::Error::from_reason(
            "[INVALID_INPUT] Embedding cannot be empty",
        ));
    }
    if embedding.len() > MAX_EMBEDDING_DIM {
        return Err(napi::Error::from_reason(format!(
            "[INVALID_INPUT] Embedding dimension {} exceeds maximum {}",
            embedding.len(),
            MAX_EMBEDDING_DIM
        )));
    }
    Ok(())
}

// ============================================================================
// Stats Result
// ============================================================================

/// Statistics about a memvid file
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatsResult {
    /// Total number of frames
    pub frame_count: i64,
    /// File size in bytes
    pub size_bytes: i64,
    /// Whether lex (text) index is enabled
    pub has_lex_index: bool,
    /// Whether vec (vector) index is enabled
    pub has_vec_index: bool,
    /// Whether CLIP index is enabled
    pub has_clip_index: bool,
    /// Whether time index is enabled
    pub has_time_index: bool,
    /// Number of active (non-deleted) frames
    pub active_frame_count: i64,
    /// Total payload bytes
    pub payload_bytes: i64,
    /// Total logical bytes (before compression)
    pub logical_bytes: i64,
    /// Bytes saved by compression
    pub saved_bytes: i64,
    /// Compression ratio as percentage
    pub compression_ratio_percent: f64,
    /// Savings as percentage
    pub savings_percent: f64,
    /// Average payload bytes per frame
    pub average_frame_payload_bytes: i64,
    /// Average logical bytes per frame
    pub average_frame_logical_bytes: i64,
    /// Vector count in index
    pub vector_count: i64,
}

impl StatsResult {
    fn try_from_stats(s: memvid_core::Stats) -> napi::Result<Self> {
        Ok(Self {
            frame_count: u64_to_i64(s.frame_count)?,
            size_bytes: u64_to_i64(s.size_bytes)?,
            has_lex_index: s.has_lex_index,
            has_vec_index: s.has_vec_index,
            has_clip_index: s.has_clip_index,
            has_time_index: s.has_time_index,
            active_frame_count: u64_to_i64(s.active_frame_count)?,
            payload_bytes: u64_to_i64(s.payload_bytes)?,
            logical_bytes: u64_to_i64(s.logical_bytes)?,
            saved_bytes: u64_to_i64(s.saved_bytes)?,
            compression_ratio_percent: s.compression_ratio_percent,
            savings_percent: s.savings_percent,
            average_frame_payload_bytes: u64_to_i64(s.average_frame_payload_bytes)?,
            average_frame_logical_bytes: u64_to_i64(s.average_frame_logical_bytes)?,
            vector_count: u64_to_i64(s.vector_count)?,
        })
    }
}

// ============================================================================
// Doctor Result
// ============================================================================

/// Result of doctor/repair operation
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoctorResultOutput {
    /// Number of issues found during diagnosis
    pub issues_found: i64,
    /// Number of issues fixed during repair
    pub issues_fixed: i64,
    /// Descriptions of actions taken
    pub actions: Vec<String>,
}

// ============================================================================
// Vacuum Result
// ============================================================================

/// Result of a vacuum operation
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VacuumResultOutput {
    /// Number of bytes reclaimed by vacuum
    pub bytes_reclaimed: i64,
    /// Number of active frames retained after vacuum
    pub frames_retained: i64,
    /// File size before vacuum (bytes)
    pub size_before: i64,
    /// File size after vacuum (bytes)
    pub size_after: i64,
}

// ============================================================================
// Compact WAL Result
// ============================================================================

/// Result of a WAL compaction operation
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompactWalResultOutput {
    /// Number of WAL records compacted
    pub records_compacted: i64,
    /// WAL size before compaction (bytes)
    pub wal_size_before: i64,
    /// WAL size after compaction (bytes)
    pub wal_size_after: i64,
    /// Number of pending records before compaction
    pub pending_before: i64,
    /// Number of pending records after compaction (should be 0)
    pub pending_after: i64,
}

// ============================================================================
// Chunk Embedding Input
// ============================================================================

/// A chunk embedding for document ingestion
#[napi(object)]
#[derive(Debug, Clone)]
pub struct ChunkEmbeddingInput {
    /// Optional text content of the chunk
    pub text: Option<String>,
    /// Embedding vector for the chunk
    pub embedding: Vec<f64>,
}

// ============================================================================
// Put Options
// ============================================================================

/// Options for storing a document
#[napi(object)]
#[derive(Debug, Clone, Default)]
pub struct PutOptions {
    /// Document title
    pub title: Option<String>,
    /// Document URI (unique identifier)
    pub uri: Option<String>,
    /// Document kind/type
    pub kind: Option<String>,
    /// Labels for categorization
    pub labels: Option<Vec<String>>,
}

/// Options for updating a frame
#[napi(object)]
#[derive(Debug, Clone, Default)]
pub struct UpdateFrameOptions {
    /// New title
    pub title: Option<String>,
    /// New kind
    pub kind: Option<String>,
    /// New labels (replaces existing)
    pub labels: Option<Vec<String>>,
}

// ============================================================================
// Timeline Types
// ============================================================================

/// Options for timeline queries
#[napi(object)]
#[derive(Debug, Clone, Default)]
pub struct TimelineOptions {
    /// Maximum number of entries to return
    pub limit: Option<i32>,
    /// Only return entries after this timestamp
    pub since: Option<i64>,
    /// Only return entries before this timestamp
    pub until: Option<i64>,
    /// Reverse order (newest first)
    pub reverse: Option<bool>,
}

/// A timeline entry
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineEntryResult {
    /// Frame ID
    pub frame_id: i64,
    /// Frame timestamp
    pub timestamp: i64,
    /// Preview text
    pub preview: String,
    /// Frame URI
    pub uri: Option<String>,
}

/// Frame metadata
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrameInfo {
    /// Frame ID
    pub id: i64,
    /// Frame timestamp
    pub timestamp: i64,
    /// Frame URI
    pub uri: Option<String>,
    /// Frame title
    pub title: Option<String>,
    /// Frame kind/type
    pub kind: Option<String>,
    /// Payload length in bytes
    pub payload_length: i64,
}

// ============================================================================
// Search Results
// ============================================================================

/// A single search hit
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    /// Frame ID
    pub frame_id: i64,
    /// Relevance score
    pub score: Option<f64>,
    /// Matched text snippet
    pub text: String,
    /// Byte range in original content
    pub range_start: i64,
    pub range_end: i64,
    /// Frame title
    pub title: Option<String>,
    /// Frame URI
    pub uri: Option<String>,
}

/// Search response
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    /// Total hits found
    pub total_hits: i64,
    /// Hits returned (may be limited)
    pub hits: Vec<SearchHit>,
    /// Search engine used
    pub engine: String,
    /// Cursor for pagination
    pub cursor: Option<String>,
}

/// A single CLIP visual search hit
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipSearchHitResult {
    /// Frame ID
    pub frame_id: i64,
    /// Page number (1-indexed, for PDFs) - None if not a paged document
    pub page: Option<i32>,
    /// L2 distance to query (lower is more similar)
    pub distance: f64,
}

/// Memory filter for restricting search to frames with matching Memory Cards.
///
/// Multiple filters in an array are ORed together - frames matching ANY filter are included.
/// Within a single filter, all specified criteria are ANDed together.
#[napi(object)]
#[derive(Debug, Clone, Default)]
pub struct JsMemoryFilter {
    /// Entity name (case-insensitive, "*" matches all entities)
    pub entity: Option<String>,
    /// Slot/attribute name (case-insensitive)
    pub slot: Option<String>,
    /// Substring to match in value (case-insensitive)
    pub value_contains: Option<String>,
    /// Memory kind to match: "Fact", "Preference", "Event", "Profile", "Relationship", "Goal", "Other"
    pub kind: Option<String>,
}

impl JsMemoryFilter {
    /// Convert to core MemoryFilter
    fn to_core(&self) -> memvid_core::types::MemoryFilter {
        memvid_core::types::MemoryFilter {
            entity: self.entity.clone(),
            slot: self.slot.clone(),
            value_contains: self.value_contains.clone(),
            kind: self.kind.as_ref().and_then(|k| MemoryKind::try_from_str(k)),
        }
    }
}

/// Options for hybrid search
#[napi(object)]
#[derive(Debug, Clone, Default)]
pub struct HybridSearchOptions {
    /// Maximum characters for snippets
    pub snippet_chars: Option<i32>,
    /// URI scope filter (prefix match)
    pub scope: Option<String>,
}

/// Options for adaptive search
#[napi(object)]
#[derive(Debug, Clone, Default)]
pub struct AdaptiveSearchOptions {
    /// Enable adaptive retrieval (default: true)
    pub enabled: Option<bool>,
    /// Maximum results to consider
    pub max_results: Option<i32>,
    /// Minimum results to return
    pub min_results: Option<i32>,
    /// Strategy: "relative", "absolute", "cliff", "elbow", "combined"
    pub strategy: Option<String>,
    /// Threshold value for the strategy
    pub threshold: Option<f64>,
    /// Maximum characters for snippets
    pub snippet_chars: Option<i32>,
    /// URI scope filter (prefix match)
    pub scope: Option<String>,
}

/// Statistics from adaptive retrieval
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdaptiveStatsResult {
    pub total_considered: i64,
    pub returned: i64,
    pub cutoff_index: i64,
    pub cutoff_score: Option<f64>,
    pub top_score: Option<f64>,
    pub cutoff_ratio: Option<f64>,
    pub triggered_by: String,
}

/// Result of adaptive search
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdaptiveSearchResult {
    pub hits: Vec<SearchHit>,
    pub stats: AdaptiveStatsResult,
}

// ============================================================================
// Ask (RAG Q&A) Types
// ============================================================================

/// Input for ask (RAG Q&A) request
#[napi(object)]
#[derive(Debug, Clone, Default)]
pub struct AskRequestInput {
    /// The question to ask
    pub question: String,
    /// Maximum number of context chunks to retrieve (default: 5)
    pub top_k: Option<i32>,
    /// Maximum characters per snippet (default: 500)
    pub snippet_chars: Option<i32>,
    /// Filter to specific URI
    pub uri: Option<String>,
    /// Filter to URI scope (prefix match)
    pub scope: Option<String>,
    /// Pagination cursor
    pub cursor: Option<String>,
    /// Start timestamp filter (Unix epoch seconds)
    pub start: Option<i64>,
    /// End timestamp filter (Unix epoch seconds)
    pub end: Option<i64>,
    /// If true, only return context without synthesized answer
    pub context_only: Option<bool>,
    /// Retrieval mode: "lex", "sem", or "hybrid" (default: "lex" for NAPI since no embedder)
    pub mode: Option<String>,
    /// Replay: Filter to frames with id <= as_of_frame (time-travel view)
    pub as_of_frame: Option<i64>,
    /// Replay: Filter to frames with timestamp <= as_of_ts (time-travel view)
    pub as_of_ts: Option<i64>,
}

/// Citation pointing back into the memory
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AskCitationResult {
    /// 1-based citation index
    pub index: i64,
    /// Frame ID of the source
    pub frame_id: i64,
    /// URI of the source
    pub uri: String,
    /// Byte range of the chunk in the source (start)
    pub chunk_range_start: Option<i64>,
    /// Byte range of the chunk in the source (end)
    pub chunk_range_end: Option<i64>,
    /// Relevance score
    pub score: Option<f64>,
}

/// Context fragment used for answer synthesis
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AskContextFragmentResult {
    /// Rank in the result set (1-based)
    pub rank: i64,
    /// Frame ID of the source
    pub frame_id: i64,
    /// URI of the source
    pub uri: String,
    /// Title of the source document
    pub title: Option<String>,
    /// Relevance score
    pub score: Option<f64>,
    /// Number of keyword matches
    pub matches: i64,
    /// Byte range in the source (start)
    pub range_start: Option<i64>,
    /// Byte range in the source (end)
    pub range_end: Option<i64>,
    /// Chunk byte range (start)
    pub chunk_range_start: Option<i64>,
    /// Chunk byte range (end)
    pub chunk_range_end: Option<i64>,
    /// The text content
    pub text: String,
}

/// Statistics from ask operation
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AskStatsResult {
    /// Time spent retrieving context in milliseconds
    pub retrieval_ms: i64,
    /// Time spent synthesizing the answer in milliseconds
    pub synthesis_ms: i64,
    /// End-to-end latency in milliseconds
    pub latency_ms: i64,
}

/// Response from ask (RAG Q&A)
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AskResponseOutput {
    /// The original question
    pub question: String,
    /// Retrieval mode used: "lex", "sem", or "hybrid"
    pub mode: String,
    /// Retriever used: "lex", "semantic", "hybrid", "lex_fallback", or "timeline_fallback"
    pub retriever: String,
    /// Whether this was a context-only request
    pub context_only: bool,
    /// Synthesized answer (if context_only is false)
    pub answer: Option<String>,
    /// Citations pointing to source frames
    pub citations: Vec<AskCitationResult>,
    /// Context fragments used for synthesis
    pub context_fragments: Vec<AskContextFragmentResult>,
    /// Concatenated context text for LLM consumption
    pub context: String,
    /// Search hits (for detailed access)
    pub hits: Vec<SearchHit>,
    /// Total hits found
    pub total_hits: i64,
    /// Timing statistics
    pub stats: AskStatsResult,
}

// ============================================================================
// Graph Search Types
// ============================================================================

/// Options for graph search
#[napi(object)]
#[derive(Debug, Clone, Default)]
pub struct GraphSearchOptions {
    /// Maximum number of results to return
    pub top_k: Option<i32>,
    /// Maximum characters for snippets
    pub snippet_chars: Option<i32>,
    /// URI scope filter (prefix match)
    pub scope: Option<String>,
}

/// A single graph search hit
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphSearchHit {
    /// Frame ID
    pub frame_id: i64,
    /// Combined relevance score (graph + vector)
    pub score: f64,
    /// Graph pattern match score (0.0-1.0)
    pub graph_score: f64,
    /// Vector/lexical similarity score
    pub vector_score: f64,
    /// Entity that matched the graph pattern (if any)
    pub matched_entity: Option<String>,
    /// Frame content preview
    pub preview: Option<String>,
}

/// Result of graph search including execution plan info
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphSearchResult {
    /// Search hits
    pub hits: Vec<GraphSearchHit>,
    /// Execution plan used: "vector_only", "graph_only", or "hybrid"
    pub plan_type: String,
    /// Whether the plan used graph patterns
    pub uses_graph: bool,
    /// Whether the plan used vector/lexical search
    pub uses_vector: bool,
    /// Total hits found
    pub total_hits: i64,
}

// ============================================================================
// Memory Card Types
// ============================================================================

/// Input for creating a memory card
#[napi(object)]
#[derive(Debug, Clone)]
pub struct MemoryCardInput {
    /// Entity this card is about (e.g., "user", "project")
    pub entity: String,
    /// Slot/attribute name (e.g., "employer", "location")
    pub slot: String,
    /// The value
    pub value: String,
    /// Kind: "fact", "preference", "event", "profile", "relationship", "goal", "other"
    pub kind: Option<String>,
    /// Confidence score (0.0-1.0)
    pub confidence: Option<f64>,
    /// Source frame ID
    pub source_frame_id: Option<i64>,
    /// Source URI
    pub source_uri: Option<String>,
}

/// Memory card returned from queries
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryCardResult {
    pub id: i64,
    pub entity: String,
    pub slot: String,
    pub value: String,
    pub kind: String,
    pub confidence: f64,
    pub timestamp: i64,
    pub source_frame_id: Option<i64>,
    pub source_uri: Option<String>,
}

/// Statistics about memory cards
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoriesStatsResult {
    pub card_count: i64,
    pub entity_count: i64,
}

// ============================================================================
// Enrichment Stats
// ============================================================================

/// Statistics about enrichment state
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnrichmentStatsResult {
    /// Total active frames
    pub total_frames: i64,
    /// Frames that have been fully enriched
    pub enriched_frames: i64,
    /// Frames pending enrichment
    pub pending_frames: i64,
    /// Frames that are searchable but not enriched (skimmed)
    pub skimmed_frames: i64,
}

/// An enrichment task in the queue
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnrichmentTaskResult {
    /// Frame ID to enrich
    pub frame_id: i64,
    /// Timestamp when task was created (Unix epoch seconds)
    pub created_at: i64,
    /// Number of chunks already processed
    pub chunks_done: i64,
    /// Total chunks to process
    pub chunks_total: i64,
}

/// Result of processing an enrichment batch
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessBatchResult {
    /// Number of tasks processed
    pub tasks_processed: i64,
    /// Number of tasks that succeeded
    pub tasks_succeeded: i64,
    /// Number of tasks that failed
    pub tasks_failed: i64,
    /// Frame IDs that were enriched
    pub enriched_frame_ids: Vec<i64>,
    /// Errors encountered (if any)
    pub errors: Vec<String>,
}

// ============================================================================
// Table Types
// ============================================================================

/// Options for table extraction
#[napi(object)]
#[derive(Debug, Clone, Default)]
pub struct TableExtractionOptions {
    /// Mode: "conservative", "standard", "aggressive", "lattice_only", "stream_only"
    pub mode: Option<String>,
    /// Minimum rows for a valid table
    pub min_rows: Option<i32>,
    /// Minimum columns for a valid table
    pub min_cols: Option<i32>,
    /// Merge tables spanning multiple pages
    pub merge_multi_page: Option<bool>,
    /// Maximum pages to process (0 = all)
    pub max_pages: Option<i32>,
}

/// An extracted table
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedTableResult {
    pub table_id: String,
    pub page: i32,
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub n_rows: i64,
    pub n_cols: i64,
    pub quality: String,
}

/// Summary of a stored table
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableSummaryResult {
    pub table_id: String,
    pub title: Option<String>,
    pub n_rows: i64,
    pub n_cols: i64,
    pub headers: Vec<String>,
    pub frame_id: i64,
}

// ============================================================================
// Document Extraction Types
// ============================================================================

/// Result of document extraction
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentExtractionResult {
    /// Extracted text content
    pub text: String,
    /// Number of pages (for PDFs and multi-page documents)
    pub page_count: Option<i32>,
    /// Detected document format (pdf, docx, xlsx, etc.)
    pub format: String,
    /// Warnings generated during extraction
    pub warnings: Vec<String>,
}

/// Convert a MemoryCardInput to a Rust MemoryCard
fn memory_card_input_to_rust(input: MemoryCardInput) -> napi::Result<MemoryCard> {
    // Parse kind string to MemoryKind enum (default to Fact)
    let kind = input
        .kind
        .map(|k| MemoryKind::from_str(&k))
        .unwrap_or(MemoryKind::Fact);

    // Get source_frame_id (default to 0 if not provided)
    let source_frame_id = input
        .source_frame_id
        .map(|id| if id >= 0 { id as u64 } else { 0 })
        .unwrap_or(0);

    // Build the card using MemoryCardBuilder
    let mut builder = MemoryCardBuilder::new()
        .kind(kind)
        .entity(input.entity)
        .slot(input.slot)
        .value(input.value)
        .source(source_frame_id, input.source_uri)
        .engine("napi", env!("CARGO_PKG_VERSION"));

    // Add confidence if provided
    if let Some(conf) = input.confidence {
        builder = builder.confidence(conf as f32);
    }

    // Build with id=0 (will be assigned by the track)
    builder.build(0).map_err(|e| {
        napi::Error::from_reason(format!(
            "[INVALID_INPUT] Failed to build memory card: {}",
            e
        ))
    })
}

/// Build memvid-core PutOptions from NAPI PutOptions
fn build_put_options(opts: &PutOptions) -> memvid_core::PutOptions {
    let mut put_opts = memvid_core::PutOptions::builder();

    if let Some(ref title) = opts.title {
        put_opts = put_opts.title(title);
    }
    if let Some(ref uri) = opts.uri {
        put_opts = put_opts.uri(uri);
    }
    if let Some(ref kind) = opts.kind {
        put_opts = put_opts.kind(kind);
    }
    if let Some(ref labels) = opts.labels {
        for label in labels {
            put_opts = put_opts.label(label);
        }
    }

    put_opts.build()
}

/// Convert a Rust MemoryCard to MemoryCardResult
fn memory_card_to_result(card: &MemoryCard) -> napi::Result<MemoryCardResult> {
    Ok(MemoryCardResult {
        id: u64_to_i64(card.id)?,
        entity: card.entity.clone(),
        slot: card.slot.clone(),
        value: card.value.clone(),
        kind: card.kind.as_str().to_string(),
        confidence: card.confidence.map(|c| c as f64).unwrap_or(1.0),
        timestamp: card.created_at,
        source_frame_id: if card.source_frame_id > 0 {
            Some(u64_to_i64(card.source_frame_id)?)
        } else {
            None
        },
        source_uri: card.source_uri.clone(),
    })
}

/// Infer document format from file extension in filename
fn infer_format_from_filename(filename: &str) -> Option<DocumentFormat> {
    let path = std::path::Path::new(filename);
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "pdf" => Some(DocumentFormat::Pdf),
        "docx" => Some(DocumentFormat::Docx),
        "xlsx" => Some(DocumentFormat::Xlsx),
        "xls" => Some(DocumentFormat::Xls),
        "pptx" => Some(DocumentFormat::Pptx),
        "txt" | "text" | "log" | "cfg" | "ini" | "json" | "yaml" | "yml" | "toml" | "csv"
        | "tsv" | "rs" | "py" | "js" | "ts" | "tsx" | "jsx" | "c" | "h" | "cpp" | "hpp" | "go"
        | "rb" | "php" | "css" | "scss" | "sh" | "bash" | "swift" | "kt" | "java" | "scala"
        | "sql" => Some(DocumentFormat::PlainText),
        "md" | "markdown" => Some(DocumentFormat::Markdown),
        "html" | "htm" => Some(DocumentFormat::Html),
        _ => None,
    }
}

// ============================================================================
// MemvidHandle - Thread-safe wrapper
// ============================================================================

/// Handle to a memvid file
///
/// This is a thread-safe wrapper around the Rust Memvid struct.
/// All operations acquire a mutex lock before accessing the underlying data.
#[napi]
pub struct MemvidHandle {
    inner: Arc<Mutex<Option<Memvid>>>,
    path: String,
    closed: std::sync::atomic::AtomicBool,
}

#[napi]
impl MemvidHandle {
    /// Check if handle is closed and return error if so
    fn check_closed(&self) -> napi::Result<()> {
        if self.closed.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(napi::Error::from_reason("Handle is closed"));
        }
        Ok(())
    }

    /// Get a mutable reference to the inner Memvid, checking for closed state
    ///
    /// # Safety (Unwind)
    /// AssertUnwindSafe is used because:
    /// 1. The closure captures `self` which contains Arc<Mutex<>> - thread-safe references
    /// 2. If panic occurs, the mutex becomes poisoned and handle gets invalidated
    /// 3. Subsequent operations will fail-fast with "Lock poisoned" or "Handle is closed"
    /// 4. No data can leak across the FFI boundary in an inconsistent state
    fn with_memvid<F, T>(&self, f: F) -> napi::Result<T>
    where
        F: FnOnce(&mut Memvid) -> napi::Result<T> + std::panic::UnwindSafe,
    {
        catch_panic(AssertUnwindSafe(|| {
            self.check_closed()?;
            let mut guard = self.inner.lock().map_err(|e| {
                // Mark handle as invalid after lock poison - prevents further operations
                self.closed.store(true, std::sync::atomic::Ordering::SeqCst);
                napi::Error::from_reason(format!("Lock poisoned, handle invalidated: {}", e))
            })?;
            let memvid = guard
                .as_mut()
                .ok_or_else(|| napi::Error::from_reason("Handle is closed"))?;
            f(memvid)
        }))
    }

    /// Get the file path
    #[napi]
    pub fn path(&self) -> String {
        self.path.clone()
    }

    /// Check if handle is closed
    #[napi(js_name = "isClosed")]
    pub fn is_closed(&self) -> bool {
        self.closed.load(std::sync::atomic::Ordering::SeqCst)
    }

    /// Close the handle and release resources
    ///
    /// After closing, all operations on this handle will fail.
    /// It's safe to call close() multiple times.
    #[napi]
    pub fn close(&self) -> napi::Result<()> {
        catch_panic(AssertUnwindSafe(|| {
            // Always mark as closed first, even if lock fails
            self.closed.store(true, std::sync::atomic::Ordering::SeqCst);

            // Try to drop the inner Memvid - if lock is poisoned, it's already invalid
            match self.inner.lock() {
                Ok(mut guard) => {
                    *guard = None;
                }
                Err(_) => {
                    // Lock was poisoned - handle is already marked closed, nothing more to do
                }
            }
            Ok(())
        }))
    }

    /// Get file statistics
    #[napi]
    pub fn stats(&self) -> napi::Result<StatsResult> {
        self.with_memvid(|memvid| {
            let stats = memvid.stats().map_err(memvid_to_napi_error)?;
            StatsResult::try_from_stats(stats)
        })
    }

    /// Store a document
    #[napi]
    pub fn put(&self, content: Buffer, options: Option<PutOptions>) -> napi::Result<i64> {
        let content_vec = content.to_vec();
        let opts = options.unwrap_or_default();
        let put_opts = build_put_options(&opts);
        self.with_memvid(move |memvid| {
            let frame_id = memvid
                .put_bytes_with_options(&content_vec, put_opts)
                .map_err(memvid_to_napi_error)?;
            u64_to_i64(frame_id)
        })
    }

    /// Commit changes to disk
    #[napi]
    pub fn commit(&self) -> napi::Result<()> {
        self.with_memvid(|memvid| {
            memvid.commit().map_err(memvid_to_napi_error)?;
            Ok(())
        })
    }

    /// Search for documents
    ///
    /// Supports filtering by URI, scope, exclusions, and memory filters.
    #[napi]
    pub fn find(
        &self,
        query: String,
        limit: Option<i32>,
        uri: Option<String>,
        scope: Option<String>,
        exclude_ids: Option<Vec<i64>>,
        exclude_uris: Option<Vec<String>>,
        memory_filters: Option<Vec<JsMemoryFilter>>,
    ) -> napi::Result<SearchResult> {
        // Validate limit before entering closure to avoid move issues
        let top_k_usize = i32_to_usize(limit.unwrap_or(10))?;
        // Convert exclude_ids from i64 to u64
        let exclude_frame_ids: Vec<u64> = exclude_ids
            .unwrap_or_default()
            .into_iter()
            .filter_map(|id| if id >= 0 { Some(id as u64) } else { None })
            .collect();
        let exclude_uris = exclude_uris.unwrap_or_default();
        // Convert JsMemoryFilter to core MemoryFilter
        let memory_filters_core: Vec<memvid_core::types::MemoryFilter> = memory_filters
            .unwrap_or_default()
            .iter()
            .map(|f| f.to_core())
            .collect();

        self.with_memvid(move |memvid| {
            let request = memvid_core::SearchRequest {
                query,
                top_k: top_k_usize,
                snippet_chars: 200,
                uri,
                scope,
                cursor: None,
                as_of_frame: None,
                as_of_ts: None,
                no_sketch: false,
                exclude_frame_ids,
                exclude_uris,
                memory_filters: memory_filters_core,
            };

            let response = memvid.search(request).map_err(memvid_to_napi_error)?;

            let hits: napi::Result<Vec<SearchHit>> = response
                .hits
                .into_iter()
                .map(|h| {
                    Ok(SearchHit {
                        frame_id: u64_to_i64(h.frame_id)?,
                        score: h.score.map(|s| s as f64),
                        text: h.text,
                        range_start: h.range.0 as i64, // usize, safe on 64-bit
                        range_end: h.range.1 as i64,   // usize, safe on 64-bit
                        title: h.title,
                        uri: Some(h.uri),
                    })
                })
                .collect();

            Ok(SearchResult {
                total_hits: u64_to_i64(response.total_hits as u64)?,
                hits: hits?,
                engine: format!("{:?}", response.engine),
                cursor: response.next_cursor,
            })
        })
    }

    /// Enable lexical (text) search index
    #[napi]
    pub fn enable_lex(&self) -> napi::Result<()> {
        self.with_memvid(|memvid| {
            memvid.enable_lex().map_err(memvid_to_napi_error)?;
            Ok(())
        })
    }

    /// Enable vector (embedding) search index
    ///
    /// Note: Requires the 'vec' feature to be enabled in memvid-core.
    /// Currently disabled due to glibc requirements (needs 2.38+).
    #[napi]
    pub fn enable_vec(&self) -> napi::Result<()> {
        self.with_memvid(|memvid| {
            memvid.enable_vec().map_err(memvid_to_napi_error)?;
            Ok(())
        })
    }

    /// Search by vector similarity
    ///
    /// Returns the top_k most similar frames to the query embedding.
    /// Requires vec index to be enabled.
    /// Supports filtering by exclude_frame_ids and exclude_uris.
    #[napi]
    pub fn vec_search(
        &self,
        query_embedding: Vec<f64>,
        limit: Option<i32>,
        uri: Option<String>,
        scope: Option<String>,
        exclude_ids: Option<Vec<i64>>,
        exclude_uris_param: Option<Vec<String>>,
    ) -> napi::Result<SearchResult> {
        // Validate inputs before entering closure
        validate_embedding_size(&query_embedding)?;
        let limit = i32_to_usize(limit.unwrap_or(10))?;
        // Prepare exclude filters
        let exclude_frame_ids: std::collections::HashSet<u64> = exclude_ids
            .unwrap_or_default()
            .into_iter()
            .filter_map(|id| if id >= 0 { Some(id as u64) } else { None })
            .collect();
        let exclude_uris: std::collections::HashSet<String> =
            exclude_uris_param.unwrap_or_default().into_iter().collect();
        let filter_uri = uri;
        let filter_scope = scope;

        self.with_memvid(move |memvid| {
            // Convert f64 to f32
            let query_f32: Vec<f32> = query_embedding.iter().map(|&x| x as f32).collect();

            // Get more results than needed if filtering, to account for exclusions
            let fetch_limit = if exclude_frame_ids.is_empty()
                && exclude_uris.is_empty()
                && filter_uri.is_none()
                && filter_scope.is_none()
            {
                limit
            } else {
                limit * 3 // Fetch extra to account for filtering
            };

            let vec_hits = memvid
                .search_vec(&query_f32, fetch_limit)
                .map_err(memvid_to_napi_error)?;

            // Get frame info for filtering by URI
            let mut hits: Vec<SearchHit> = Vec::new();
            for h in vec_hits {
                // Apply exclude_frame_ids filter
                if exclude_frame_ids.contains(&h.frame_id) {
                    continue;
                }

                // Get frame info for URI-based filtering
                let frame = memvid.frame_by_id(h.frame_id).ok();
                let frame_uri = frame
                    .as_ref()
                    .and_then(|f| f.uri.clone())
                    .unwrap_or_else(|| format!("mv2://{}", h.frame_id));
                let frame_title = frame.as_ref().and_then(|f| f.title.clone());

                // Apply exclude_uris filter
                if exclude_uris.contains(&frame_uri) {
                    continue;
                }

                // Apply uri filter (exact match)
                if let Some(ref uri) = filter_uri {
                    if &frame_uri != uri {
                        continue;
                    }
                }

                // Apply scope filter (prefix match)
                if let Some(ref scope) = filter_scope {
                    if !frame_uri.starts_with(scope) {
                        continue;
                    }
                }

                hits.push(SearchHit {
                    frame_id: u64_to_i64(h.frame_id)?,
                    score: Some(h.distance as f64),
                    text: String::new(), // VecSearchHit doesn't include text
                    range_start: 0,
                    range_end: 0,
                    title: frame_title,
                    uri: Some(frame_uri),
                });

                if hits.len() >= limit {
                    break;
                }
            }

            Ok(SearchResult {
                total_hits: hits.len() as i64, // Vec length is always safe
                hits,
                engine: "Vec".to_string(),
                cursor: None,
            })
        })
    }

    // ========================================================================
    // CLIP Visual Search Methods
    // ========================================================================

    /// Enable CLIP visual embeddings index
    ///
    /// CLIP allows semantic search across images using natural language queries.
    /// Unlike text vec embeddings (384/768/1536 dims), CLIP embeddings have
    /// fixed 512 dimensions (MobileCLIP-S2) and are stored in a separate index.
    #[napi]
    pub fn enable_clip(&self) -> napi::Result<()> {
        self.with_memvid(|memvid| {
            memvid.enable_clip().map_err(memvid_to_napi_error)?;
            Ok(())
        })
    }

    /// Add a CLIP embedding for a frame
    ///
    /// This adds the visual embedding to the CLIP index for later semantic search.
    /// The frame must already exist. Use an external CLIP model to generate embeddings.
    #[napi]
    pub fn add_clip_embedding(&self, frame_id: i64, embedding: Vec<f64>) -> napi::Result<()> {
        // Validate inputs before entering closure
        validate_embedding_size(&embedding)?;
        let frame_id_u64 = i64_to_usize(frame_id)? as u64;

        self.with_memvid(move |memvid| {
            // Convert f64 to f32
            let embedding_f32: Vec<f32> = embedding.iter().map(|&x| x as f32).collect();

            memvid
                .add_clip_embedding(frame_id_u64, embedding_f32)
                .map_err(memvid_to_napi_error)?;
            Ok(())
        })
    }

    /// Add a CLIP embedding for a frame with page number
    ///
    /// This adds the visual embedding to the CLIP index with page information.
    /// Page is 1-indexed (for PDF pages).
    #[napi]
    pub fn add_clip_embedding_with_page(
        &self,
        frame_id: i64,
        page: i32,
        embedding: Vec<f64>,
    ) -> napi::Result<()> {
        // Validate inputs before entering closure
        validate_embedding_size(&embedding)?;
        let frame_id_u64 = i64_to_usize(frame_id)? as u64;
        let page_u32 = if page > 0 { Some(page as u32) } else { None };

        self.with_memvid(move |memvid| {
            // Convert f64 to f32
            let embedding_f32: Vec<f32> = embedding.iter().map(|&x| x as f32).collect();

            memvid
                .add_clip_embedding_with_page(frame_id_u64, page_u32, embedding_f32)
                .map_err(memvid_to_napi_error)?;
            Ok(())
        })
    }

    /// Search CLIP index with a pre-computed query embedding
    ///
    /// Returns the top_k most similar frames to the query embedding.
    /// Use an external CLIP model to generate the query embedding from text or image.
    /// Results are sorted by distance (lower is more similar).
    #[napi]
    pub fn clip_search(
        &self,
        query_embedding: Vec<f64>,
        limit: Option<i32>,
    ) -> napi::Result<Vec<ClipSearchHitResult>> {
        // Validate inputs before entering closure
        validate_embedding_size(&query_embedding)?;
        let top_k = i32_to_usize(limit.unwrap_or(10))?;

        self.with_memvid(move |memvid| {
            // Convert f64 to f32
            let query_f32: Vec<f32> = query_embedding.iter().map(|&x| x as f32).collect();

            let clip_hits = memvid
                .search_clip(&query_f32, top_k)
                .map_err(memvid_to_napi_error)?;

            // Convert ClipSearchHit to ClipSearchHitResult
            let hits: napi::Result<Vec<ClipSearchHitResult>> = clip_hits
                .into_iter()
                .map(|h| {
                    Ok(ClipSearchHitResult {
                        frame_id: u64_to_i64(h.frame_id)?,
                        page: h.page.map(|p| p as i32),
                        distance: h.distance as f64,
                    })
                })
                .collect();

            hits
        })
    }

    /// Hybrid search using both text query and vector embedding
    ///
    /// Performs vector similarity search using the pre-computed embedding.
    /// The query string is used for snippet generation and metadata.
    /// Requires vec index to be enabled.
    #[napi]
    pub fn hybrid_search(
        &self,
        query: String,
        query_embedding: Vec<f64>,
        limit: Option<i32>,
        options: Option<HybridSearchOptions>,
    ) -> napi::Result<SearchResult> {
        // Validate inputs before entering closure
        validate_embedding_size(&query_embedding)?;
        let top_k = i32_to_usize(limit.unwrap_or(10))?;
        let opts = options.unwrap_or_default();
        let snippet_chars = i32_to_usize(opts.snippet_chars.unwrap_or(200))?;

        self.with_memvid(move |memvid| {
            // Convert f64 to f32
            let embedding_f32: Vec<f32> = query_embedding.iter().map(|&x| x as f32).collect();

            let response = memvid
                .vec_search_with_embedding(
                    &query,
                    &embedding_f32,
                    top_k,
                    snippet_chars,
                    opts.scope.as_deref(),
                )
                .map_err(memvid_to_napi_error)?;

            let hits: napi::Result<Vec<SearchHit>> = response
                .hits
                .into_iter()
                .map(|h| {
                    Ok(SearchHit {
                        frame_id: u64_to_i64(h.frame_id)?,
                        score: h.score.map(|s| s as f64),
                        text: h.text,
                        range_start: h.range.0 as i64,
                        range_end: h.range.1 as i64,
                        title: h.title,
                        uri: Some(h.uri),
                    })
                })
                .collect();

            Ok(SearchResult {
                total_hits: u64_to_i64(response.total_hits as u64)?,
                hits: hits?,
                engine: format!("{:?}", response.engine),
                cursor: response.next_cursor,
            })
        })
    }

    /// Adaptive search using vector similarity with dynamic result cutoff
    ///
    /// Unlike fixed top_k retrieval, adaptive search examines relevancy score distribution
    /// to include all relevant results while excluding noise. This is crucial when:
    /// - Answers span multiple chunks (missing relevant context)
    /// - Score distribution varies by query (some queries have many relevant matches)
    ///
    /// Strategies:
    /// - "relative": Stop when score drops below threshold% of top score
    /// - "absolute": Stop when score drops below absolute threshold
    /// - "cliff": Stop when score drops by more than threshold% from previous
    /// - "elbow": Automatically detect the "knee" in the score curve
    /// - "combined": Use multiple strategies together (default)
    #[napi]
    pub fn search_adaptive(
        &self,
        query: String,
        query_embedding: Vec<f64>,
        options: Option<AdaptiveSearchOptions>,
    ) -> napi::Result<AdaptiveSearchResult> {
        // Validate inputs before entering closure
        validate_embedding_size(&query_embedding)?;
        let opts = options.unwrap_or_default();

        // Build AdaptiveConfig from options
        let enabled = opts.enabled.unwrap_or(true);
        let max_results = i32_to_usize(opts.max_results.unwrap_or(100))?;
        let min_results = i32_to_usize(opts.min_results.unwrap_or(1))?;
        let snippet_chars = i32_to_usize(opts.snippet_chars.unwrap_or(200))?;
        let threshold = opts.threshold.unwrap_or(0.5) as f32;

        // Parse strategy string to CutoffStrategy enum
        let strategy = match opts.strategy.as_deref() {
            Some("relative") => CutoffStrategy::RelativeThreshold {
                min_ratio: threshold,
            },
            Some("absolute") => CutoffStrategy::AbsoluteThreshold {
                min_score: threshold,
            },
            Some("cliff") => CutoffStrategy::ScoreCliff {
                max_drop_ratio: threshold,
            },
            Some("elbow") => CutoffStrategy::Elbow {
                sensitivity: threshold,
            },
            Some("combined") | None => CutoffStrategy::Combined {
                relative_threshold: threshold,
                max_drop_ratio: 0.4,
                absolute_min: 0.3,
            },
            Some(unknown) => {
                return Err(napi::Error::from_reason(format!(
                    "[INVALID_INPUT] Unknown strategy: '{}'. Valid: relative, absolute, cliff, elbow, combined",
                    unknown
                )));
            }
        };

        let config = AdaptiveConfig {
            enabled,
            max_results,
            min_results,
            strategy,
            normalize_scores: true,
        };

        let scope = opts.scope.clone();

        self.with_memvid(move |memvid| {
            // Convert f64 to f32
            let embedding_f32: Vec<f32> = query_embedding.iter().map(|&x| x as f32).collect();

            let result = memvid
                .search_adaptive(
                    &query,
                    &embedding_f32,
                    config,
                    snippet_chars,
                    scope.as_deref(),
                )
                .map_err(memvid_to_napi_error)?;

            // Convert SearchHit results to NAPI SearchHit
            let hits: napi::Result<Vec<SearchHit>> = result
                .results
                .into_iter()
                .map(|h| {
                    Ok(SearchHit {
                        frame_id: u64_to_i64(h.frame_id)?,
                        score: h.score.map(|s| s as f64),
                        text: h.text,
                        range_start: h.range.0 as i64,
                        range_end: h.range.1 as i64,
                        title: h.title,
                        uri: Some(h.uri),
                    })
                })
                .collect();

            // Convert AdaptiveStats to AdaptiveStatsResult
            let stats = AdaptiveStatsResult {
                total_considered: result.stats.total_considered as i64,
                returned: result.stats.returned as i64,
                cutoff_index: result.stats.cutoff_index as i64,
                cutoff_score: result.stats.cutoff_score.map(|s| s as f64),
                top_score: result.stats.top_score.map(|s| s as f64),
                cutoff_ratio: result.stats.cutoff_ratio.map(|s| s as f64),
                triggered_by: result.stats.triggered_by,
            };

            Ok(AdaptiveSearchResult { hits: hits?, stats })
        })
    }

    /// Graph search combining memory cards with vector/lexical search
    ///
    /// Uses QueryPlanner to analyze the query and determine the best execution strategy:
    /// - For simple queries: vector-only search (falls back to lexical)
    /// - For queries referencing entities: hybrid search combining memory cards and lexical search
    ///
    /// This provides intelligent retrieval that leverages structured knowledge (memory cards)
    /// when the query references known entities.
    #[napi]
    pub fn graph_search(
        &self,
        query: String,
        options: Option<GraphSearchOptions>,
    ) -> napi::Result<GraphSearchResult> {
        let opts = options.unwrap_or_default();
        let top_k = i32_to_usize(opts.top_k.unwrap_or(10))?;

        self.with_memvid(move |memvid| {
            // Create query planner and analyze the query
            let planner = QueryPlanner::new();
            let plan = planner.plan(&query, top_k);

            // Capture plan info before moving
            let uses_graph = plan.uses_graph();
            let uses_vector = plan.uses_vector();
            let plan_type = match &plan {
                memvid_core::types::QueryPlan::VectorOnly { .. } => "vector_only".to_string(),
                memvid_core::types::QueryPlan::GraphOnly { .. } => "graph_only".to_string(),
                memvid_core::types::QueryPlan::Hybrid { .. } => "hybrid".to_string(),
            };

            // Execute the hybrid search using the graph_search module
            let hybrid_hits =
                rust_graph_hybrid_search(memvid, &plan).map_err(memvid_to_napi_error)?;

            // Convert HybridSearchHit results to NAPI GraphSearchHit
            let hits: napi::Result<Vec<GraphSearchHit>> = hybrid_hits
                .iter()
                .map(|h| {
                    Ok(GraphSearchHit {
                        frame_id: u64_to_i64(h.frame_id)?,
                        score: h.score as f64,
                        graph_score: h.graph_score as f64,
                        vector_score: h.vector_score as f64,
                        matched_entity: h.matched_entity.clone(),
                        preview: h.preview.clone(),
                    })
                })
                .collect();

            let hits = hits?;
            let total_hits = hits.len() as i64;

            Ok(GraphSearchResult {
                hits,
                plan_type,
                uses_graph,
                uses_vector,
                total_hits,
            })
        })
    }

    /// Ask a question (RAG Q&A with retrieval)
    ///
    /// Retrieves relevant context from the memory and optionally synthesizes an answer.
    /// This is the primary interface for retrieval-augmented generation.
    ///
    /// Note: For the NAPI binding, only lexical mode ("lex") is supported since
    /// semantic/hybrid modes require an embedder. The `mode` field in options is
    /// ignored and defaults to "lex".
    ///
    /// If `context_only` is true, only retrieves context without synthesizing an answer.
    /// The caller can then use the context with their own LLM.
    #[napi]
    pub fn ask(&self, request: AskRequestInput) -> napi::Result<AskResponseOutput> {
        // Validate and convert parameters
        let top_k = i32_to_usize(request.top_k.unwrap_or(5))?;
        let snippet_chars = i32_to_usize(request.snippet_chars.unwrap_or(500))?;
        let context_only = request.context_only.unwrap_or(true); // Default to context_only for NAPI

        // Parse mode (only lex is supported without embedder)
        let mode = match request.mode.as_deref() {
            Some("lex") | None => RustAskMode::Lex,
            Some("sem") | Some("semantic") => {
                return Err(napi::Error::from_reason(
                    "[INVALID_INPUT] Semantic mode requires an embedder. Use 'lex' mode or call ask with pre-computed embeddings.",
                ));
            }
            Some("hybrid") => {
                return Err(napi::Error::from_reason(
                    "[INVALID_INPUT] Hybrid mode requires an embedder. Use 'lex' mode or call ask with pre-computed embeddings.",
                ));
            }
            Some(unknown) => {
                return Err(napi::Error::from_reason(format!(
                    "[INVALID_INPUT] Unknown mode: '{}'. Valid modes: lex, sem, hybrid",
                    unknown
                )));
            }
        };

        // Convert as_of_frame from i64 to u64
        let as_of_frame = request
            .as_of_frame
            .map(|id| if id >= 0 { id as u64 } else { 0 });

        // Build Rust AskRequest
        let rust_request = RustAskRequest {
            question: request.question,
            top_k,
            snippet_chars,
            uri: request.uri,
            scope: request.scope,
            cursor: request.cursor,
            start: request.start,
            end: request.end,
            #[cfg(feature = "temporal_track")]
            temporal: None,
            context_only,
            mode,
            as_of_frame,
            as_of_ts: request.as_of_ts,
            adaptive: None, // Could add adaptive config support in the future
        };

        self.with_memvid(move |memvid| {
            // Call ask without embedder (lex-only mode)
            let response = memvid
                .ask::<NoopEmbedder>(rust_request, None)
                .map_err(memvid_to_napi_error)?;

            // Convert citations
            let citations: napi::Result<Vec<AskCitationResult>> = response
                .citations
                .into_iter()
                .map(|c| {
                    Ok(AskCitationResult {
                        index: c.index as i64,
                        frame_id: u64_to_i64(c.frame_id)?,
                        uri: c.uri,
                        chunk_range_start: c.chunk_range.map(|(start, _)| start as i64),
                        chunk_range_end: c.chunk_range.map(|(_, end)| end as i64),
                        score: c.score.map(|s| s as f64),
                    })
                })
                .collect();

            // Convert context fragments
            let context_fragments: napi::Result<Vec<AskContextFragmentResult>> = response
                .context_fragments
                .into_iter()
                .map(|f| {
                    Ok(AskContextFragmentResult {
                        rank: f.rank as i64,
                        frame_id: u64_to_i64(f.frame_id)?,
                        uri: f.uri,
                        title: f.title,
                        score: f.score.map(|s| s as f64),
                        matches: f.matches as i64,
                        range_start: f.range.map(|(start, _)| start as i64),
                        range_end: f.range.map(|(_, end)| end as i64),
                        chunk_range_start: f.chunk_range.map(|(start, _)| start as i64),
                        chunk_range_end: f.chunk_range.map(|(_, end)| end as i64),
                        text: f.text,
                    })
                })
                .collect();

            // Convert search hits
            let hits: napi::Result<Vec<SearchHit>> = response
                .retrieval
                .hits
                .into_iter()
                .map(|h| {
                    Ok(SearchHit {
                        frame_id: u64_to_i64(h.frame_id)?,
                        score: h.score.map(|s| s as f64),
                        text: h.text,
                        range_start: h.range.0 as i64,
                        range_end: h.range.1 as i64,
                        title: h.title,
                        uri: Some(h.uri),
                    })
                })
                .collect();

            // Build context string from fragments
            let context = context_fragments
                .as_ref()
                .map(|frags| {
                    frags
                        .iter()
                        .map(|f| f.text.as_str())
                        .collect::<Vec<_>>()
                        .join("\n\n---\n\n")
                })
                .unwrap_or_default();

            // Convert mode and retriever to strings
            let mode_str = match response.mode {
                RustAskMode::Lex => "lex",
                RustAskMode::Sem => "sem",
                RustAskMode::Hybrid => "hybrid",
            };

            let retriever_str = match response.retriever {
                memvid_core::types::AskRetriever::Lex => "lex",
                memvid_core::types::AskRetriever::Semantic => "semantic",
                memvid_core::types::AskRetriever::Hybrid => "hybrid",
                memvid_core::types::AskRetriever::LexFallback => "lex_fallback",
                memvid_core::types::AskRetriever::TimelineFallback => "timeline_fallback",
            };

            Ok(AskResponseOutput {
                question: response.question,
                mode: mode_str.to_string(),
                retriever: retriever_str.to_string(),
                context_only: response.context_only,
                answer: response.answer,
                citations: citations?,
                context_fragments: context_fragments?,
                context,
                hits: hits?,
                total_hits: u64_to_i64(response.retrieval.total_hits as u64)?,
                stats: AskStatsResult {
                    retrieval_ms: response.stats.retrieval_ms as i64,
                    synthesis_ms: response.stats.synthesis_ms as i64,
                    latency_ms: response.stats.latency_ms as i64,
                },
            })
        })
    }

    /// Verify file integrity
    #[napi]
    pub fn verify(&self, deep: Option<bool>) -> napi::Result<bool> {
        self.check_closed()?;
        catch_panic(AssertUnwindSafe(|| {
            let path = self.path.clone();
            let result = Memvid::verify(&path, deep.unwrap_or(false));
            match result {
                Ok(_) => Ok(true),
                Err(_) => Ok(false),
            }
        }))
    }

    /// Get timeline entries (chronological view of frames)
    #[napi]
    pub fn timeline(
        &self,
        options: Option<TimelineOptions>,
    ) -> napi::Result<Vec<TimelineEntryResult>> {
        let opts = options.unwrap_or_default();
        // Validate limit before entering closure
        let validated_limit = if let Some(limit) = opts.limit {
            if limit <= 0 {
                None // Ignore non-positive limits
            } else {
                std::num::NonZeroU64::new(limit as u64)
            }
        } else {
            None
        };
        self.with_memvid(move |memvid| {
            let query = memvid_core::TimelineQuery {
                limit: validated_limit,
                since: opts.since,
                until: opts.until,
                reverse: opts.reverse.unwrap_or(false),
            };

            let entries = memvid.timeline(query).map_err(memvid_to_napi_error)?;

            entries
                .into_iter()
                .map(|e| {
                    Ok(TimelineEntryResult {
                        frame_id: u64_to_i64(e.frame_id)?,
                        timestamp: e.timestamp,
                        preview: e.preview,
                        uri: e.uri,
                    })
                })
                .collect()
        })
    }

    /// Get frame content by ID
    #[napi]
    pub fn view(&self, frame_id: i64) -> napi::Result<String> {
        let frame_id_u64 = i64_to_usize(frame_id)? as u64;
        self.with_memvid(move |memvid| {
            let content = memvid
                .frame_text_by_id(frame_id_u64)
                .map_err(memvid_to_napi_error)?;

            Ok(content)
        })
    }

    /// Get frame metadata by ID
    #[napi]
    pub fn frame(&self, frame_id: i64) -> napi::Result<FrameInfo> {
        let frame_id_u64 = i64_to_usize(frame_id)? as u64;
        self.with_memvid(move |memvid| {
            let frame = memvid
                .frame_by_id(frame_id_u64)
                .map_err(memvid_to_napi_error)?;

            Ok(FrameInfo {
                id: u64_to_i64(frame.id)?,
                timestamp: frame.timestamp,
                uri: frame.uri,
                title: frame.title,
                kind: frame.kind,
                payload_length: u64_to_i64(frame.payload_length)?,
            })
        })
    }

    /// Store a document with pre-computed embedding
    ///
    /// The embedding vector should match the dimension expected by the vec index.
    /// Use this when you compute embeddings externally (e.g., via OpenAI API).
    #[napi]
    pub fn put_with_embedding(
        &self,
        content: Buffer,
        embedding: Vec<f64>,
        options: Option<PutOptions>,
    ) -> napi::Result<i64> {
        validate_embedding_size(&embedding)?;
        let content_vec = content.to_vec();
        let opts = options.unwrap_or_default();
        let put_opts = build_put_options(&opts);
        let embedding_f32: Vec<f32> = embedding.iter().map(|&x| x as f32).collect();

        self.with_memvid(move |memvid| {
            let frame_id = memvid
                .put_with_embedding_and_options(&content_vec, embedding_f32, put_opts)
                .map_err(memvid_to_napi_error)?;
            u64_to_i64(frame_id)
        })
    }

    /// Delete a frame (soft delete)
    #[napi]
    pub fn delete(&self, frame_id: i64) -> napi::Result<i64> {
        let frame_id_u64 = i64_to_usize(frame_id)? as u64;
        self.with_memvid(move |memvid| {
            let deleted_id = memvid
                .delete_frame(frame_id_u64)
                .map_err(memvid_to_napi_error)?;

            u64_to_i64(deleted_id)
        })
    }

    /// Update frame metadata
    ///
    /// Updates the title, kind, and/or labels of an existing frame.
    /// Only the fields provided in options will be updated.
    #[napi]
    pub fn update(&self, frame_id: i64, options: UpdateFrameOptions) -> napi::Result<()> {
        let frame_id_u64 = i64_to_usize(frame_id)? as u64;
        self.with_memvid(move |memvid| {
            // Build PutOptions with only the fields we want to update
            let put_opts = memvid_core::PutOptions {
                title: options.title,
                kind: options.kind,
                labels: options.labels.unwrap_or_default(),
                // Disable auto-processing since we're just updating metadata
                auto_tag: false,
                extract_dates: false,
                extract_triplets: false,
                ..Default::default()
            };

            // Call update_frame with no payload change and no embedding change
            memvid
                .update_frame(frame_id_u64, None, put_opts, None)
                .map_err(memvid_to_napi_error)?;

            Ok(())
        })
    }

    // ========================================================================
    // Memory Cards
    // ========================================================================

    /// Add a memory card
    ///
    /// Creates a structured memory card with entity, slot, value, and optional metadata.
    /// Memory cards are used for structured knowledge storage about entities.
    #[napi]
    pub fn put_memory_card(&self, card: MemoryCardInput) -> napi::Result<i64> {
        let rust_card = memory_card_input_to_rust(card)?;
        self.with_memvid(move |memvid| {
            let id = memvid
                .put_memory_card(rust_card)
                .map_err(memvid_to_napi_error)?;
            u64_to_i64(id)
        })
    }

    /// Add multiple memory cards
    ///
    /// Batch insert multiple memory cards. Returns the assigned IDs in order.
    #[napi]
    pub fn put_memory_cards(&self, cards: Vec<MemoryCardInput>) -> napi::Result<Vec<i64>> {
        // Convert all inputs to Rust cards first
        let rust_cards: napi::Result<Vec<MemoryCard>> =
            cards.into_iter().map(memory_card_input_to_rust).collect();
        let rust_cards = rust_cards?;

        self.with_memvid(move |memvid| {
            let ids = memvid
                .put_memory_cards(rust_cards)
                .map_err(memvid_to_napi_error)?;

            ids.into_iter().map(u64_to_i64).collect()
        })
    }

    /// Get current memory for entity:slot
    ///
    /// Returns the most recent, non-retracted memory card for the given entity and slot.
    #[napi]
    pub fn get_current_memory(
        &self,
        entity: String,
        slot: String,
    ) -> napi::Result<Option<MemoryCardResult>> {
        self.with_memvid(
            move |memvid| match memvid.get_current_memory(&entity, &slot) {
                Some(card) => Ok(Some(memory_card_to_result(card)?)),
                None => Ok(None),
            },
        )
    }

    /// Get all memories for an entity
    ///
    /// Returns all memory cards associated with the given entity.
    #[napi]
    pub fn get_entity_memories(&self, entity: String) -> napi::Result<Vec<MemoryCardResult>> {
        self.with_memvid(move |memvid| {
            let cards = memvid.get_entity_memories(&entity);
            cards.into_iter().map(memory_card_to_result).collect()
        })
    }

    /// Get memory statistics
    ///
    /// Returns statistics about the memory cards stored in the file.
    #[napi]
    pub fn memories_stats(&self) -> napi::Result<MemoriesStatsResult> {
        self.with_memvid(|memvid| {
            let stats = memvid.memories_stats();
            Ok(MemoriesStatsResult {
                card_count: stats.card_count as i64,
                entity_count: stats.entity_count as i64,
            })
        })
    }

    /// Get total memory card count
    #[napi]
    pub fn memory_card_count(&self) -> napi::Result<i64> {
        self.with_memvid(|memvid| Ok(memvid.memory_card_count() as i64))
    }

    /// Clear all memory cards
    ///
    /// Removes all memory cards and enrichment records. This is destructive.
    #[napi]
    pub fn clear_memories(&self) -> napi::Result<()> {
        self.with_memvid(|memvid| {
            memvid.clear_memories();
            Ok(())
        })
    }

    // ========================================================================
    // Entity State Lookup
    // ========================================================================

    /// Get current value for entity:slot (O(1) lookup)
    ///
    /// This is a convenience wrapper that returns just the value string.
    #[napi]
    pub fn state(&self, entity: String, slot: String) -> napi::Result<Option<String>> {
        self.with_memvid(move |memvid| {
            Ok(memvid
                .get_current_memory(&entity, &slot)
                .map(|card| card.value.clone()))
        })
    }

    // ========================================================================
    // Enrichment
    // ========================================================================

    /// Get the number of frames pending enrichment
    ///
    /// Returns the count of tasks in the enrichment queue.
    #[napi]
    pub fn enrichment_queue_len(&self) -> napi::Result<i64> {
        self.with_memvid(|memvid| Ok(memvid.enrichment_queue_len() as i64))
    }

    /// Check if any frames need enrichment
    ///
    /// Returns true if there are pending enrichment tasks.
    #[napi]
    pub fn has_pending_enrichment(&self) -> napi::Result<bool> {
        self.with_memvid(|memvid| Ok(memvid.has_pending_enrichment()))
    }

    /// Process all pending enrichment tasks synchronously
    ///
    /// This method processes all frames in the enrichment queue:
    /// - Re-extracts full text for skim frames
    /// - Updates search indexes with enriched content
    /// - Marks frames as enriched when complete
    ///
    /// Returns the number of tasks processed.
    #[napi]
    pub fn process_all_enrichment(&self) -> napi::Result<i64> {
        self.with_memvid(|memvid| Ok(memvid.process_all_enrichment() as i64))
    }

    /// Get enrichment statistics
    ///
    /// Returns statistics about the enrichment state of frames:
    /// - total_frames: Total active frames
    /// - enriched_frames: Frames that have been fully enriched
    /// - pending_frames: Frames in the enrichment queue
    /// - skimmed_frames: Frames that are searchable but not enriched
    #[napi]
    pub fn enrichment_stats(&self) -> napi::Result<EnrichmentStatsResult> {
        self.with_memvid(|memvid| {
            let stats = memvid.enrichment_stats();
            Ok(EnrichmentStatsResult {
                total_frames: stats.total_frames as i64,
                enriched_frames: stats.enriched_frames as i64,
                pending_frames: stats.pending_frames as i64,
                skimmed_frames: stats.searchable_only as i64,
            })
        })
    }

    /// Mark a specific frame as enriched
    ///
    /// Updates the frame's enrichment state to indicate it has been fully processed.
    /// This is useful for manual enrichment workflows.
    #[napi]
    pub fn mark_frame_enriched(&self, frame_id: i64) -> napi::Result<()> {
        let frame_id_u64 = i64_to_usize(frame_id)? as u64;
        self.with_memvid(move |memvid| {
            memvid.mark_frame_enriched(frame_id_u64);
            Ok(())
        })
    }

    /// Get the enrichment queue
    ///
    /// Returns a list of all pending enrichment tasks.
    #[napi]
    pub fn enrichment_queue(&self) -> napi::Result<Vec<EnrichmentTaskResult>> {
        self.with_memvid(|memvid| {
            let tasks: Vec<EnrichmentTaskResult> = memvid
                .enrichment_tasks()
                .iter()
                .map(|task| EnrichmentTaskResult {
                    frame_id: task.frame_id as i64,
                    created_at: task.created_at as i64,
                    chunks_done: task.chunks_done as i64,
                    chunks_total: task.chunks_total as i64,
                })
                .collect();
            Ok(tasks)
        })
    }

    /// Process a batch of enrichment tasks
    ///
    /// Processes up to `batch_size` tasks from the enrichment queue.
    /// Returns details about what was processed.
    #[napi]
    pub fn process_enrichment_batch(&self, batch_size: i32) -> napi::Result<ProcessBatchResult> {
        // Validate batch_size
        if batch_size < 0 {
            return Err(napi::Error::from_reason(
                "[INVALID_INPUT] batch_size must be non-negative",
            ));
        }
        // Check for non-integer (this won't happen from JS, but defensive)
        let batch_size_usize = batch_size as usize;

        self.with_memvid(move |memvid| {
            let mut tasks_processed = 0i64;
            let mut tasks_succeeded = 0i64;
            let mut tasks_failed = 0i64;
            let mut enriched_frame_ids = Vec::new();
            let mut errors = Vec::new();

            // Process up to batch_size tasks
            for _ in 0..batch_size_usize {
                // Get the next task
                let task = match memvid.next_enrichment_task() {
                    Some(t) => t,
                    None => break, // No more tasks
                };

                tasks_processed += 1;

                // Process the task
                let result = memvid.process_enrichment_task(&task);

                // Complete the task (removes from queue)
                memvid.complete_enrichment_task(task.frame_id);

                if let Some(err) = result.error {
                    tasks_failed += 1;
                    errors.push(format!("Frame {}: {}", task.frame_id, err));
                } else {
                    tasks_succeeded += 1;
                    enriched_frame_ids.push(task.frame_id as i64);
                }
            }

            Ok(ProcessBatchResult {
                tasks_processed,
                tasks_succeeded,
                tasks_failed,
                enriched_frame_ids,
                errors,
            })
        })
    }

    // ========================================================================
    // Table Processing
    // ========================================================================

    /// Extract tables from PDF bytes
    #[napi]
    pub fn extract_tables(
        &self,
        pdf_bytes: Buffer,
        filename: String,
        options: Option<TableExtractionOptions>,
    ) -> napi::Result<Vec<ExtractedTableResult>> {
        let pdf_vec = pdf_bytes.to_vec();
        let opts = options.unwrap_or_default();

        // Parse mode string to ExtractionMode enum
        let mode = match opts.mode.as_deref() {
            Some("conservative") | None => ExtractionMode::Conservative,
            Some("aggressive") => ExtractionMode::Aggressive,
            Some("lattice_only") => ExtractionMode::LatticeOnly,
            Some("stream_only") => ExtractionMode::StreamOnly,
            Some("standard") => ExtractionMode::Conservative, // Standard maps to Conservative
            Some(unknown) => {
                return Err(napi::Error::from_reason(format!(
                    "[INVALID_INPUT] Unknown extraction mode: '{}'. Valid: conservative, standard, aggressive, lattice_only, stream_only",
                    unknown
                )));
            }
        };

        // Build Rust options
        let mut rust_opts = RustTableExtractionOptions::builder().mode(mode);

        if let Some(min_rows) = opts.min_rows {
            rust_opts = rust_opts.min_rows(i32_to_usize(min_rows)?);
        }
        if let Some(min_cols) = opts.min_cols {
            rust_opts = rust_opts.min_cols(i32_to_usize(min_cols)?);
        }
        if let Some(merge) = opts.merge_multi_page {
            rust_opts = rust_opts.merge_multi_page(merge);
        }
        if let Some(max_pages) = opts.max_pages {
            rust_opts = rust_opts.max_pages(i32_to_usize(max_pages)?);
        }

        catch_panic(AssertUnwindSafe(|| {
            let result = extract_tables_from_pdf(&pdf_vec, &filename, &rust_opts.build())
                .map_err(memvid_to_napi_error)?;

            // Convert Rust ExtractedTable to NAPI ExtractedTableResult
            result
                .tables
                .into_iter()
                .map(|t| {
                    // Convert rows to Vec<Vec<String>>
                    let rows: Vec<Vec<String>> = t
                        .rows
                        .iter()
                        .filter(|r| !r.is_header_row)
                        .map(|r| r.cells.iter().map(|c| c.text.clone()).collect())
                        .collect();

                    Ok(ExtractedTableResult {
                        table_id: t.table_id,
                        page: t.page_start as i32,
                        headers: t.headers,
                        rows,
                        n_rows: t.n_rows as i64,
                        n_cols: t.n_cols as i64,
                        quality: t.quality.to_string(),
                    })
                })
                .collect()
        }))
    }

    /// List all stored tables
    #[napi]
    pub fn list_tables(&self) -> napi::Result<Vec<TableSummaryResult>> {
        self.with_memvid(|memvid| {
            let summaries = rust_list_tables(memvid).map_err(memvid_to_napi_error)?;

            summaries
                .into_iter()
                .map(|s| {
                    Ok(TableSummaryResult {
                        table_id: s.table_id,
                        title: Some(format!(
                            "Table from {} (pages {}-{})",
                            s.source_file, s.page_start, s.page_end
                        )),
                        n_rows: s.n_rows as i64,
                        n_cols: s.n_cols as i64,
                        headers: s.headers,
                        frame_id: u64_to_i64(s.frame_id)?,
                    })
                })
                .collect()
        })
    }

    /// Get a specific table by ID
    #[napi]
    pub fn get_table(&self, table_id: String) -> napi::Result<Option<ExtractedTableResult>> {
        self.with_memvid(move |memvid| {
            let table = rust_get_table(memvid, &table_id).map_err(memvid_to_napi_error)?;

            match table {
                Some(t) => {
                    // Convert rows to Vec<Vec<String>>
                    let rows: Vec<Vec<String>> = t
                        .rows
                        .iter()
                        .filter(|r| !r.is_header_row)
                        .map(|r| r.cells.iter().map(|c| c.text.clone()).collect())
                        .collect();

                    Ok(Some(ExtractedTableResult {
                        table_id: t.table_id,
                        page: t.page_start as i32,
                        headers: t.headers,
                        rows,
                        n_rows: t.n_rows as i64,
                        n_cols: t.n_cols as i64,
                        quality: t.quality.to_string(),
                    }))
                }
                None => Ok(None),
            }
        })
    }

    /// Export table to CSV format
    #[napi]
    pub fn export_table_csv(&self, table_id: String) -> napi::Result<String> {
        self.with_memvid(move |memvid| {
            let table = rust_get_table(memvid, &table_id).map_err(memvid_to_napi_error)?;

            match table {
                Some(t) => Ok(export_to_csv(&t)),
                None => Err(napi::Error::from_reason(format!(
                    "[FRAME_NOT_FOUND] Table not found: {}",
                    table_id
                ))),
            }
        })
    }

    /// Export table to JSON format
    #[napi]
    pub fn export_table_json(&self, table_id: String) -> napi::Result<String> {
        self.with_memvid(move |memvid| {
            let table = rust_get_table(memvid, &table_id).map_err(memvid_to_napi_error)?;

            match table {
                Some(t) => export_to_json(&t, true).map_err(memvid_to_napi_error),
                None => Err(napi::Error::from_reason(format!(
                    "[FRAME_NOT_FOUND] Table not found: {}",
                    table_id
                ))),
            }
        })
    }

    // ========================================================================
    // Document Processing
    // ========================================================================

    /// Extract text from a document (PDF, DOCX, XLSX, etc.)
    ///
    /// Uses automatic format detection based on filename extension.
    /// Returns extracted text, page count (if applicable), format, and any warnings.
    #[napi]
    pub fn extract_document(
        &self,
        bytes: Buffer,
        filename: String,
    ) -> napi::Result<DocumentExtractionResult> {
        let bytes_vec = bytes.to_vec();

        catch_panic(AssertUnwindSafe(|| {
            // Detect format from filename
            let format = infer_format_from_filename(&filename);

            // Build reader hint
            let magic = bytes_vec.get(0..8);
            let hint = ReaderHint::new(None, format)
                .with_uri(Some(&filename))
                .with_magic(magic);

            // Get registry and find appropriate reader
            let registry = ReaderRegistry::default();
            let reader = registry.find_reader(&hint).ok_or_else(|| {
                napi::Error::from_reason(format!(
                    "[EXTRACTION_FAILED] No reader available for file: {}",
                    filename
                ))
            })?;

            // Extract document
            let output = reader
                .extract(&bytes_vec, &hint)
                .map_err(memvid_to_napi_error)?;

            // Get page count from diagnostics if available
            let page_count = output.diagnostics.pages_processed.map(|p| p as i32);

            Ok(DocumentExtractionResult {
                text: output.document.text.unwrap_or_default(),
                page_count,
                format: format.map(|f| f.label()).unwrap_or("unknown").to_string(),
                warnings: output.diagnostics.warnings,
            })
        }))
    }

    /// Store a document with automatic text extraction
    ///
    /// Detects format from filename and extracts text before storing.
    /// Returns the frame ID of the stored document.
    #[napi]
    pub fn put_document(
        &self,
        bytes: Buffer,
        filename: String,
        options: Option<PutOptions>,
    ) -> napi::Result<i64> {
        let bytes_vec = bytes.to_vec();
        let opts = options.unwrap_or_default();

        self.with_memvid(move |memvid| {
            // Detect format from filename
            let format = infer_format_from_filename(&filename);

            // Build reader hint
            let magic = bytes_vec.get(0..8);
            let hint = ReaderHint::new(None, format)
                .with_uri(Some(&filename))
                .with_magic(magic);

            // Get registry and find appropriate reader
            let registry = ReaderRegistry::default();
            let reader = registry.find_reader(&hint).ok_or_else(|| {
                napi::Error::from_reason(format!(
                    "[EXTRACTION_FAILED] No reader available for file: {}",
                    filename
                ))
            })?;

            // Extract document
            let output = reader
                .extract(&bytes_vec, &hint)
                .map_err(memvid_to_napi_error)?;

            // Build put options with extracted text
            let mut put_opts = memvid_core::PutOptions::builder();

            // Use extracted text as search text if available
            if let Some(ref text) = output.document.text {
                put_opts = put_opts.search_text(text);
            }

            // Use provided title or infer from filename
            if let Some(title) = opts.title {
                put_opts = put_opts.title(title);
            } else {
                // Infer title from filename
                let path = std::path::Path::new(&filename);
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    put_opts = put_opts.title(stem);
                }
            }

            // Use provided URI or use filename
            if let Some(uri) = opts.uri {
                put_opts = put_opts.uri(uri);
            } else {
                put_opts = put_opts.uri(&filename);
            }

            // Set kind from format or use provided
            if let Some(kind) = opts.kind {
                put_opts = put_opts.kind(kind);
            } else if let Some(fmt) = format {
                put_opts = put_opts.kind(fmt.label());
            }

            // Add labels
            if let Some(labels) = opts.labels {
                for label in labels {
                    put_opts = put_opts.label(label);
                }
            }

            // Store the raw bytes (not extracted text)
            let frame_id = memvid
                .put_bytes_with_options(&bytes_vec, put_opts.build())
                .map_err(memvid_to_napi_error)?;

            u64_to_i64(frame_id)
        })
    }

    // ========================================================================
    // Blob/Streaming
    // ========================================================================

    /// Get raw frame content as bytes
    ///
    /// Returns the canonical (decompressed) payload bytes for a frame.
    #[napi]
    pub fn blob(&self, frame_id: i64) -> napi::Result<Buffer> {
        let frame_id_u64 = i64_to_usize(frame_id)? as u64;
        self.with_memvid(move |memvid| {
            let bytes = memvid
                .frame_canonical_payload(frame_id_u64)
                .map_err(memvid_to_napi_error)?;

            Ok(Buffer::from(bytes))
        })
    }

    // ========================================================================
    // Optimization Operations
    // ========================================================================

    /// Vacuum the file to reclaim space from deleted frames
    ///
    /// This operation:
    /// - Commits any pending changes
    /// - Removes deleted frames and their payloads
    /// - Rebuilds indexes with only active frames
    ///
    /// Returns statistics about the vacuum operation.
    #[napi]
    pub fn vacuum(&self) -> napi::Result<VacuumResultOutput> {
        self.with_memvid(|memvid| {
            // Get stats before vacuum
            let stats_before = memvid.stats().map_err(memvid_to_napi_error)?;
            let size_before = stats_before.size_bytes;

            // Perform vacuum
            memvid.vacuum().map_err(memvid_to_napi_error)?;

            // Get stats after vacuum
            let stats_after = memvid.stats().map_err(memvid_to_napi_error)?;
            let size_after = stats_after.size_bytes;

            // Calculate bytes reclaimed
            let bytes_reclaimed = if size_before > size_after {
                size_before - size_after
            } else {
                0
            };

            Ok(VacuumResultOutput {
                bytes_reclaimed: u64_to_i64(bytes_reclaimed)?,
                frames_retained: u64_to_i64(stats_after.active_frame_count)?,
                size_before: u64_to_i64(size_before)?,
                size_after: u64_to_i64(size_after)?,
            })
        })
    }

    /// Compact the write-ahead log
    ///
    /// This operation commits pending changes and compacts the WAL.
    /// In memvid, the WAL is embedded in the file with a fixed size,
    /// so compaction just commits pending changes.
    ///
    /// Returns statistics about the compaction operation.
    #[napi]
    pub fn compact_wal(&self) -> napi::Result<CompactWalResultOutput> {
        self.with_memvid(|memvid| {
            // Get stats to get WAL info
            let stats = memvid.stats().map_err(memvid_to_napi_error)?;

            // In memvid, the WAL is embedded with fixed size.
            // There's no exposed pending count, so we track 0 since
            // commit always clears the pending state.
            let wal_size = stats.wal_bytes;

            // Commit to flush pending changes
            memvid.commit().map_err(memvid_to_napi_error)?;

            // After commit, pending is always 0
            Ok(CompactWalResultOutput {
                records_compacted: 0, // Compact = commit in memvid
                wal_size_before: wal_size as i64,
                wal_size_after: wal_size as i64,
                pending_before: 0,
                pending_after: 0,
            })
        })
    }

    /// Preview how a document would be chunked without storing it
    ///
    /// Returns None if the document is too small to be chunked.
    /// Use this to generate embeddings for each chunk before calling
    /// put_with_chunk_embeddings().
    #[napi]
    pub fn preview_chunks(&self, content: Buffer) -> napi::Result<Option<Vec<String>>> {
        let content_vec = content.to_vec();
        self.with_memvid(move |memvid| Ok(memvid.preview_chunks(&content_vec)))
    }

    /// Store a document with pre-computed chunk embeddings
    ///
    /// Use this when you generate embeddings externally for each chunk.
    /// Call preview_chunks() first to get the chunks, then generate embeddings
    /// for each chunk, then call this method.
    ///
    /// Returns the frame ID of the stored document.
    #[napi]
    pub fn put_with_chunk_embeddings(
        &self,
        content: Buffer,
        parent_embedding: Option<Vec<f64>>,
        chunk_embeddings: Vec<ChunkEmbeddingInput>,
        options: Option<PutOptions>,
    ) -> napi::Result<i64> {
        // Validate parent embedding if provided
        if let Some(ref emb) = parent_embedding {
            validate_embedding_size(emb)?;
        }

        // Validate chunk embeddings
        for (i, chunk) in chunk_embeddings.iter().enumerate() {
            if chunk.embedding.is_empty() {
                return Err(napi::Error::from_reason(format!(
                    "[INVALID_INPUT] Chunk embedding at index {} cannot be empty",
                    i
                )));
            }
            validate_embedding_size(&chunk.embedding)?;
        }

        let content_vec = content.to_vec();
        let opts = options.unwrap_or_default();

        // Convert f64 embeddings to f32
        let parent_emb_f32: Option<Vec<f32>> =
            parent_embedding.map(|e| e.iter().map(|&x| x as f32).collect());

        let chunk_embs_f32: Vec<Vec<f32>> = chunk_embeddings
            .into_iter()
            .map(|c| c.embedding.iter().map(|&x| x as f32).collect())
            .collect();

        self.with_memvid(move |memvid| {
            let mut put_opts = memvid_core::PutOptions::builder();

            if let Some(title) = opts.title {
                put_opts = put_opts.title(title);
            }
            if let Some(uri) = opts.uri {
                put_opts = put_opts.uri(uri);
            }
            if let Some(kind) = opts.kind {
                put_opts = put_opts.kind(kind);
            }
            if let Some(labels) = opts.labels {
                for label in labels {
                    put_opts = put_opts.label(label);
                }
            }

            let frame_id = memvid
                .put_with_chunk_embeddings(
                    &content_vec,
                    parent_emb_f32,
                    chunk_embs_f32,
                    put_opts.build(),
                )
                .map_err(memvid_to_napi_error)?;

            u64_to_i64(frame_id)
        })
    }
}

// ============================================================================
// Path Validation
// ============================================================================

/// Validate a file path for safety (new file creation)
///
/// Checks for:
/// - Path traversal attempts (..)
/// - Null bytes
/// - Required .mv2 extension
/// - Existing symlinks (to prevent overwriting symlink targets)
fn validate_path(path: &str) -> napi::Result<std::path::PathBuf> {
    // Check for null bytes
    if path.contains('\0') {
        return Err(napi::Error::from_reason(
            "[INVALID_PATH] Path contains null bytes",
        ));
    }

    let path_buf = std::path::PathBuf::from(path);

    // Check for path traversal - we reject any component that is ".."
    for component in path_buf.components() {
        if let std::path::Component::ParentDir = component {
            return Err(napi::Error::from_reason(
                "[INVALID_PATH] Path traversal not allowed: '..' in path",
            ));
        }
    }

    // Verify the extension is .mv2
    match path_buf.extension() {
        Some(ext) if ext == "mv2" => {}
        _ => {
            return Err(napi::Error::from_reason(
                "[INVALID_PATH] File must have .mv2 extension",
            ));
        }
    }

    // Security: If path already exists, check if it's a symlink
    // This prevents an attacker from creating a symlink that points to a sensitive file
    // which would then be overwritten when create() is called
    if path_buf.exists() {
        match std::fs::symlink_metadata(&path_buf) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() {
                    return Err(napi::Error::from_reason(
                        "[INVALID_PATH] Cannot create file: path is a symlink",
                    ));
                }
            }
            Err(e) => {
                return Err(napi::Error::from_reason(format!(
                    "[IO_ERROR] Cannot check path metadata: {}",
                    e
                )));
            }
        }
    }

    Ok(path_buf)
}

/// Validate path for opening existing files (with symlink resolution)
///
/// For existing files, we can canonicalize to resolve symlinks and verify
/// the final path still has .mv2 extension.
fn validate_path_for_open(path: &str) -> napi::Result<std::path::PathBuf> {
    // First do basic validation
    let path_buf = validate_path(path)?;

    // For existing files, try to canonicalize to resolve symlinks
    // This ensures we're actually opening a .mv2 file, not a symlink to something else
    match std::fs::canonicalize(&path_buf) {
        Ok(canonical) => {
            // Verify the resolved path also has .mv2 extension
            match canonical.extension() {
                Some(ext) if ext == "mv2" => Ok(canonical),
                _ => Err(napi::Error::from_reason(
                    "[INVALID_PATH] Symlink target must have .mv2 extension",
                )),
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // File doesn't exist yet - return original path
            // This shouldn't happen in open(), but handle gracefully
            Err(napi::Error::from_reason(format!(
                "[IO_ERROR] File not found: {}",
                path
            )))
        }
        Err(e) => Err(napi::Error::from_reason(format!(
            "[IO_ERROR] Cannot access file: {}",
            e
        ))),
    }
}

// ============================================================================
// Module Functions
// ============================================================================

/// Create a new memvid file
///
/// This will create a new .mv2 file at the specified path.
/// If the file already exists, it will be overwritten.
///
/// Security: Path must have .mv2 extension and cannot contain path traversal.
#[napi]
pub fn create(path: String) -> napi::Result<MemvidHandle> {
    catch_panic(AssertUnwindSafe(|| {
        let validated_path = validate_path(&path)?;
        let path_str = validated_path.to_string_lossy().to_string();

        let memvid = Memvid::create(&path_str).map_err(memvid_to_napi_error)?;
        Ok(MemvidHandle {
            inner: Arc::new(Mutex::new(Some(memvid))),
            path: path_str,
            closed: std::sync::atomic::AtomicBool::new(false),
        })
    }))
}

/// Open an existing memvid file
///
/// This will open an existing .mv2 file for reading and writing.
///
/// Security: Path must have .mv2 extension and cannot contain path traversal.
/// Symlinks are resolved and verified to point to .mv2 files.
#[napi]
pub fn open(path: String) -> napi::Result<MemvidHandle> {
    catch_panic(AssertUnwindSafe(|| {
        let validated_path = validate_path_for_open(&path)?;
        let path_str = validated_path.to_string_lossy().to_string();

        let memvid = Memvid::open(&path_str).map_err(memvid_to_napi_error)?;
        Ok(MemvidHandle {
            inner: Arc::new(Mutex::new(Some(memvid))),
            path: path_str,
            closed: std::sync::atomic::AtomicBool::new(false),
        })
    }))
}

/// Get version information
#[napi]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// ============================================================================
// Encryption Functions
// ============================================================================

/// Lock (encrypt) a memvid file with a password
///
/// Creates a .mv2e encrypted file from the input .mv2 file.
/// Returns the path to the encrypted file.
#[napi]
pub fn lock(path: String, password: String) -> napi::Result<String> {
    catch_panic(AssertUnwindSafe(|| {
        // Validate password is not empty
        if password.is_empty() {
            return Err(napi::Error::from_reason(
                "[INVALID_INPUT] Password cannot be empty",
            ));
        }

        // Validate the input path
        let validated_path = validate_path_for_open(&path)?;
        let path_str = validated_path.to_string_lossy().to_string();

        let output_path = lock_file(&path_str, None, password.as_bytes()).map_err(|e| {
            napi::Error::from_reason(format!("[ENCRYPTION_ERROR] Failed to lock file: {}", e))
        })?;

        Ok(output_path.to_string_lossy().to_string())
    }))
}

/// Unlock (decrypt) a memvid file
///
/// Decrypts a .mv2e encrypted file and returns the path to the decrypted .mv2 file.
#[napi]
pub fn unlock(path: String, password: String) -> napi::Result<String> {
    catch_panic(AssertUnwindSafe(|| {
        // Validate password is not empty
        if password.is_empty() {
            return Err(napi::Error::from_reason(
                "[INVALID_INPUT] Password cannot be empty",
            ));
        }

        // Basic path validation (skip extension check since .mv2e files are expected)
        if path.contains('\0') {
            return Err(napi::Error::from_reason(
                "[INVALID_PATH] Path contains null bytes",
            ));
        }

        let path_buf = std::path::PathBuf::from(&path);

        // Check for path traversal
        for component in path_buf.components() {
            if let std::path::Component::ParentDir = component {
                return Err(napi::Error::from_reason(
                    "[INVALID_PATH] Path traversal not allowed: '..' in path",
                ));
            }
        }

        // Verify the file exists and is not a symlink to something unexpected
        match std::fs::canonicalize(&path_buf) {
            Ok(canonical) => {
                // Verify the resolved path has .mv2e extension
                match canonical.extension() {
                    Some(ext) if ext == "mv2e" => {}
                    _ => {
                        return Err(napi::Error::from_reason(
                            "[INVALID_PATH] File must have .mv2e extension for unlock",
                        ));
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Err(napi::Error::from_reason(format!(
                    "[IO_ERROR] File not found: {}",
                    path
                )));
            }
            Err(e) => {
                return Err(napi::Error::from_reason(format!(
                    "[IO_ERROR] Cannot access file: {}",
                    e
                )));
            }
        }

        let output_path = unlock_file(&path, None, password.as_bytes()).map_err(|e| {
            napi::Error::from_reason(format!("[ENCRYPTION_ERROR] Failed to unlock file: {}", e))
        })?;

        Ok(output_path.to_string_lossy().to_string())
    }))
}

// ============================================================================
// Doctor/Repair Functions
// ============================================================================

/// Diagnose and repair a memvid file
///
/// Scans the file for issues and optionally repairs them.
/// When `fix` is false (default), only diagnoses issues without modifying the file.
/// When `fix` is true, attempts to repair detected issues.
///
/// Returns a report with the number of issues found, fixed, and descriptions of actions taken.
#[napi]
pub fn doctor(path: String, fix: Option<bool>) -> napi::Result<DoctorResultOutput> {
    catch_panic(AssertUnwindSafe(|| {
        // Validate the path
        let validated_path = validate_path_for_open(&path)?;
        let path_str = validated_path.to_string_lossy().to_string();

        // Build doctor options
        let options = RustDoctorOptions {
            dry_run: !fix.unwrap_or(false),
            ..Default::default()
        };

        // Run the doctor
        let report = Memvid::doctor(&path_str, options).map_err(memvid_to_napi_error)?;

        // Count issues found (from findings)
        let issues_found = report.findings.len() as i64;

        // Count issues fixed based on status
        let issues_fixed = match report.status {
            DoctorStatus::Clean => 0,
            DoctorStatus::Healed => issues_found,
            DoctorStatus::Partial => {
                // Count executed actions
                report
                    .phases
                    .iter()
                    .flat_map(|p| &p.actions)
                    .filter(|a| {
                        matches!(a.status, memvid_core::types::DoctorActionStatus::Executed)
                    })
                    .count() as i64
            }
            DoctorStatus::Failed => 0,
            DoctorStatus::PlanOnly => 0,
        };

        // Build action descriptions
        let mut actions: Vec<String> = Vec::new();

        // Add findings as actions
        for finding in &report.findings {
            let severity = match finding.severity {
                memvid_core::types::DoctorSeverity::Info => "INFO",
                memvid_core::types::DoctorSeverity::Warning => "WARNING",
                memvid_core::types::DoctorSeverity::Error => "ERROR",
            };
            let mut action = format!("[{}] {}", severity, finding.message);
            if let Some(ref detail) = finding.detail {
                action.push_str(&format!(" - {}", detail));
            }
            actions.push(action);
        }

        // Add executed phase actions
        for phase in &report.phases {
            for action in &phase.actions {
                if matches!(
                    action.status,
                    memvid_core::types::DoctorActionStatus::Executed
                ) {
                    let action_name = format!("{:?}", action.action);
                    if let Some(ref detail) = action.detail {
                        actions.push(format!("Executed: {} - {}", action_name, detail));
                    } else {
                        actions.push(format!("Executed: {}", action_name));
                    }
                }
            }
        }

        Ok(DoctorResultOutput {
            issues_found,
            issues_fixed,
            actions,
        })
    }))
}

// ============================================================================
// PII Masking Functions
// ============================================================================

/// Mask PII (Personally Identifiable Information) in text
///
/// Detects and replaces common PII patterns with placeholder tokens:
/// - Email addresses -> `[EMAIL]`
/// - US Social Security Numbers -> `[SSN]`
/// - Phone numbers (various formats) -> `[PHONE]`
/// - Credit card numbers -> `[CREDIT_CARD]`
/// - IPv4 addresses -> `[IP_ADDRESS]`
/// - API keys/tokens (common patterns) -> `[API_KEY]`
///
/// The original data in the .mv2 file remains unchanged and fully searchable.
/// This is useful for sanitizing text before sending to LLMs or external services.
#[napi]
pub fn mask_pii(text: String) -> String {
    pii::mask_pii(&text)
}

/// Check if text contains any detectable PII
///
/// Returns `true` if any PII pattern is found, `false` otherwise.
/// Useful for checking whether masking is needed before calling `maskPii`.
#[napi]
pub fn contains_pii(text: String) -> bool {
    pii::contains_pii(&text)
}
