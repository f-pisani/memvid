//! Node.js bindings for memvid-core
//!
//! This module provides NAPI bindings to expose memvid-core functionality to Node.js.
//! All operations are thread-safe via Arc<Mutex<>> and panic-safe via catch_unwind.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Mutex};

use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde::{Deserialize, Serialize};

use memvid_core::Memvid;

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
                .put_bytes_with_options(&content_vec, put_opts.build())
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
    /// Supports filtering by URI, scope, and exclusions.
    #[napi]
    pub fn find(
        &self,
        query: String,
        limit: Option<i32>,
        uri: Option<String>,
        scope: Option<String>,
        exclude_ids: Option<Vec<i64>>,
        exclude_uris: Option<Vec<String>>,
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
        let exclude_uris: std::collections::HashSet<String> = exclude_uris_param
            .unwrap_or_default()
            .into_iter()
            .collect();
        let filter_uri = uri;
        let filter_scope = scope;

        self.with_memvid(move |memvid| {
            // Convert f64 to f32
            let query_f32: Vec<f32> = query_embedding.iter().map(|&x| x as f32).collect();

            // Get more results than needed if filtering, to account for exclusions
            let fetch_limit = if exclude_frame_ids.is_empty() && exclude_uris.is_empty()
                && filter_uri.is_none() && filter_scope.is_none() {
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
                let frame_uri = frame.as_ref().and_then(|f| f.uri.clone())
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
            let mut query = memvid_core::TimelineQuery::default();
            query.limit = validated_limit;
            if let Some(since) = opts.since {
                query.since = Some(since);
            }
            if let Some(until) = opts.until {
                query.until = Some(until);
            }
            query.reverse = opts.reverse.unwrap_or(false);

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
        // Validate embedding size to prevent DoS
        validate_embedding_size(&embedding)?;
        let content_vec = content.to_vec();
        let opts = options.unwrap_or_default();
        // Convert f64 to f32 for Rust
        let embedding_f32: Vec<f32> = embedding.iter().map(|&x| x as f32).collect();

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
                .put_with_embedding_and_options(
                    &content_vec,
                    embedding_f32.clone(),
                    put_opts.build(),
                )
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
