use super::query;
use super::schema::{build_schema, initialise_tokenizer};
use super::util::to_search_value;
use crate::retry::{RetryConfig, retry_transient};
use crate::search::parser::ParsedQuery;
use crate::types::{Frame, FrameId};
use crate::{MemvidError, Result};
use blake3::{Hasher, hash};
use std::mem::ManuallyDrop;
use std::path::Path;
use tantivy::collector::TopDocs;
use tantivy::indexer::IndexWriter;
use tantivy::schema::{Field, OwnedValue, Schema, TantivyDocument};
use tantivy::{Index, IndexReader, Term, doc};
use tempfile::TempDir;

/// Read a file's contents with proper sharing flags for Windows compatibility.
///
/// On Windows, memory-mapped files (like those used by Tantivy) cannot be read
/// using `std::fs::read()` because it opens files without sharing flags. This
/// causes "Access is denied (os error 5)" errors when reading segment files
/// that Tantivy has open via mmap.
///
/// This function uses `FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE`
/// on Windows to allow reading files that are memory-mapped by other handles.
#[cfg(windows)]
fn read_file_shared(path: &Path) -> std::io::Result<Vec<u8>> {
    use std::fs::OpenOptions;
    use std::io::Read;
    use std::os::windows::fs::OpenOptionsExt;

    // FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE = 0x7
    const FILE_SHARE_ALL: u32 = 0x1 | 0x2 | 0x4;

    let mut file = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_ALL)
        .open(path)?;

    let mut contents = Vec::new();
    file.read_to_end(&mut contents)?;
    Ok(contents)
}

/// Read a file's contents - standard implementation for non-Windows platforms.
#[cfg(not(windows))]
fn read_file_shared(path: &Path) -> std::io::Result<Vec<u8>> {
    std::fs::read(path)
}

/// Tantivy-backed search index used when the `lex` feature is enabled.
///
/// IMPORTANT: Windows compatibility requires careful drop order management.
/// Tantivy uses mmap which holds exclusive file locks on Windows.
/// When TempDir::drop() tries to delete files that are still mmaped,
/// Windows returns "Access is denied (os error 5)".
///
/// Solution: Use ManuallyDrop for the Index and IndexReader so we can
/// explicitly drop them in our Drop impl BEFORE TempDir cleanup.
/// The custom Drop impl ensures all mmap handles are released first.
pub struct TantivyEngine {
    // IndexWriter wrapped in Option so we can take() it in Drop
    pub(super) index_writer: Option<IndexWriter>,
    // ManuallyDrop allows us to control when these are dropped
    // We drop them explicitly in Drop impl before TempDir cleanup
    pub(super) reader: ManuallyDrop<IndexReader>,
    pub(super) index: ManuallyDrop<Index>,
    // Schema and field handles - no file handles
    pub(super) _schema: Schema,
    pub(super) content: Field,
    pub(super) tags: Field,
    pub(super) labels: Field,
    pub(super) track: Field,
    pub(super) timestamp: Field,
    pub(super) uri: Field,
    pub(super) frame_id: Field,
    pub(super) tokenizer: Option<String>,
    // TempDir is dropped last (after ManuallyDrop fields are explicitly dropped)
    pub(super) work_dir: TempDir,
}

/// Search hit returned from Tantivy queries.
pub struct TantivyDocHit {
    pub frame_id: u64,
    pub score: f32,
    pub content: String,
}

#[derive(Debug, Clone)]
pub struct TantivySnapshot {
    pub doc_count: u64,
    pub checksum: [u8; 32],
    pub segments: Vec<TantivySegmentBlob>,
}

#[derive(Debug, Clone)]
pub struct TantivySegmentBlob {
    pub path: String,
    pub bytes: Vec<u8>,
    pub checksum: [u8; 32],
}

impl TantivyEngine {
    pub fn create() -> Result<Self> {
        let dir = TempDir::new().map_err(|err| MemvidError::Tantivy {
            reason: format!("failed to allocate Tantivy work directory: {}", err),
        })?;
        let schema = build_schema();
        let index = Index::create_in_dir(dir.path(), schema.clone()).map_err(|err| {
            MemvidError::Tantivy {
                reason: err.to_string(),
            }
        })?;
        initialise_tokenizer(&index);
        Self::from_parts(dir, index, schema)
    }

    pub fn open_from_dir(dir: TempDir) -> Result<Self> {
        let index = Index::open_in_dir(dir.path()).map_err(|err| MemvidError::Tantivy {
            reason: err.to_string(),
        })?;
        initialise_tokenizer(&index);
        let schema = index.schema();
        Self::from_parts(dir, index, schema)
    }

    fn from_parts(dir: TempDir, index: Index, schema: Schema) -> Result<Self> {
        let content = schema
            .get_field("content")
            .map_err(|err| MemvidError::Tantivy {
                reason: err.to_string(),
            })?;
        let tags = schema
            .get_field("tags")
            .map_err(|err| MemvidError::Tantivy {
                reason: err.to_string(),
            })?;
        let labels = schema
            .get_field("labels")
            .map_err(|err| MemvidError::Tantivy {
                reason: err.to_string(),
            })?;
        let track = schema
            .get_field("track")
            .map_err(|err| MemvidError::Tantivy {
                reason: err.to_string(),
            })?;
        let timestamp = schema
            .get_field("timestamp")
            .map_err(|err| MemvidError::Tantivy {
                reason: err.to_string(),
            })?;
        let uri = schema
            .get_field("uri")
            .map_err(|err| MemvidError::Tantivy {
                reason: err.to_string(),
            })?;
        let frame_id = schema
            .get_field("frame_id")
            .map_err(|err| MemvidError::Tantivy {
                reason: err.to_string(),
            })?;

        let writer = index
            .writer(50_000_000)
            .map_err(|err| MemvidError::Tantivy {
                reason: err.to_string(),
            })?;
        let reader = index.reader().map_err(|err| MemvidError::Tantivy {
            reason: err.to_string(),
        })?;

        Ok(Self {
            index_writer: Some(writer),
            // Wrap in ManuallyDrop for explicit drop control on Windows
            reader: ManuallyDrop::new(reader),
            index: ManuallyDrop::new(index),
            // Schema and field handles
            _schema: schema,
            content,
            tags,
            labels,
            track,
            timestamp,
            uri,
            frame_id,
            tokenizer: Some("memvid_default".to_string()),
            // TempDir is dropped after ManuallyDrop fields in custom Drop impl
            work_dir: dir,
        })
    }

    fn take_writer(&mut self) -> Result<IndexWriter> {
        self.index_writer.take().ok_or(MemvidError::Tantivy {
            reason: "tantivy index writer unavailable".into(),
        })
    }

    fn writer_mut(&mut self) -> Result<&mut IndexWriter> {
        self.index_writer.as_mut().ok_or(MemvidError::Tantivy {
            reason: "tantivy index writer unavailable".into(),
        })
    }

    fn create_writer(&self) -> Result<IndexWriter> {
        // Use single thread for deterministic index generation
        self.index
            .writer_with_num_threads(1, 50_000_000)
            .map_err(|err| MemvidError::Tantivy {
                reason: err.to_string(),
            })
    }

    pub fn add_frame(&mut self, frame: &Frame, content: &str) -> Result<()> {
        if content.trim().is_empty() {
            return Ok(());
        }
        if frame.id <= 20 || (frame.id % 100 == 0) {}
        let mut document = doc!(
            self.content => content,
            self.timestamp => frame.timestamp,
            self.frame_id => frame.id,
        );
        for tag in &frame.tags {
            document.add_text(self.tags, to_search_value(tag));
        }
        for label in &frame.labels {
            document.add_text(self.labels, to_search_value(label));
        }
        if let Some(track) = &frame.track {
            document.add_text(self.track, to_search_value(track));
        }
        if let Some(uri) = &frame.uri {
            document.add_text(self.uri, to_search_value(uri));
        }
        self.writer_mut()?
            .add_document(document)
            .map_err(|err| MemvidError::Tantivy {
                reason: err.to_string(),
            })?;
        Ok(())
    }

    pub fn delete_frame(&mut self, frame_id: FrameId) -> Result<()> {
        let term = Term::from_field_u64(self.frame_id, frame_id);
        if let Some(writer) = self.index_writer.as_mut() {
            writer.delete_term(term);
        }
        Ok(())
    }

    pub fn commit(&mut self) -> Result<()> {
        let mut writer = self.take_writer()?;

        retry_transient(RetryConfig::for_tantivy(), || {
            writer.commit().map_err(|err| MemvidError::Tantivy {
                reason: err.to_string(),
            })
        })?;

        writer
            .wait_merging_threads()
            .map_err(|err| MemvidError::Tantivy {
                reason: err.to_string(),
            })?;
        self.index_writer = Some(self.create_writer()?);
        self.reload_reader()?;
        Ok(())
    }

    /// Reload the reader with retry logic for transient file access failures on Windows.
    fn reload_reader(&self) -> Result<()> {
        retry_transient(RetryConfig::for_tantivy(), || {
            self.reader.reload().map_err(|err| MemvidError::Tantivy {
                reason: err.to_string(),
            })
        })
    }

    /// Soft commit that makes documents searchable immediately without waiting for merge.
    /// Used for instant indexing during progressive ingestion (Phase 1).
    /// This is faster than full commit() but leaves segments unmerged.
    pub fn soft_commit(&mut self) -> Result<()> {
        let writer = self.writer_mut()?;

        retry_transient(RetryConfig::for_tantivy(), || {
            writer.commit().map_err(|err| MemvidError::Tantivy {
                reason: err.to_string(),
            })
        })?;

        // Don't wait for merge threads - let them run in background
        // Reload reader to make new documents searchable immediately
        self.reload_reader()?;
        Ok(())
    }

    /// Add frame and make it searchable immediately via soft commit.
    /// Returns Ok(true) if the frame was indexed, Ok(false) if skipped (empty content).
    #[allow(dead_code)]
    pub fn add_frame_immediate(&mut self, frame: &Frame, content: &str) -> Result<bool> {
        if content.trim().is_empty() {
            return Ok(false);
        }
        self.add_frame(frame, content)?;
        self.soft_commit()?;
        Ok(true)
    }

    pub fn reset(&mut self) -> Result<()> {
        let mut writer = self.take_writer()?;
        writer
            .delete_all_documents()
            .map_err(|err| MemvidError::Tantivy {
                reason: err.to_string(),
            })?;

        retry_transient(RetryConfig::for_tantivy(), || {
            writer.commit().map_err(|err| MemvidError::Tantivy {
                reason: err.to_string(),
            })
        })?;

        writer
            .wait_merging_threads()
            .map_err(|err| MemvidError::Tantivy {
                reason: err.to_string(),
            })?;
        self.index_writer = Some(self.create_writer()?);
        self.reload_reader()?;
        Ok(())
    }

    pub fn search_documents(
        &self,
        parsed: &ParsedQuery,
        uri_filter: Option<&str>,
        scope_filter: Option<&str>,
        frame_filter: Option<&[u64]>,
        limit: usize,
    ) -> Result<Vec<TantivyDocHit>> {
        if let Some(ids) = frame_filter {
            if ids.is_empty() {
                return Ok(Vec::new());
            }
        }

        let query = query::build_root_query(self, parsed, uri_filter, scope_filter, frame_filter)?;
        let doc_limit = limit.max(1);
        let searcher = self.reader.searcher();
        let top_docs = searcher
            .search(&query, &TopDocs::with_limit(doc_limit))
            .map_err(|err| MemvidError::Tantivy {
                reason: err.to_string(),
            })?;
        let mut results = Vec::new();
        for (score, address) in top_docs {
            let document: TantivyDocument =
                searcher.doc(address).map_err(|err| MemvidError::Tantivy {
                    reason: err.to_string(),
                })?;
            let frame_id = match document.get_first(self.frame_id) {
                Some(value) => match OwnedValue::from(value) {
                    OwnedValue::U64(id) => id,
                    _ => {
                        return Err(MemvidError::Tantivy {
                            reason: "tantivy doc missing frame_id".into(),
                        });
                    }
                },
                None => {
                    return Err(MemvidError::Tantivy {
                        reason: "tantivy doc missing frame_id".into(),
                    });
                }
            };
            let content = match document.get_first(self.content) {
                Some(value) => match OwnedValue::from(value) {
                    OwnedValue::Str(text) => text,
                    _ => String::new(),
                },
                None => String::new(),
            };
            results.push(TantivyDocHit {
                frame_id,
                score,
                content,
            });
        }
        Ok(results)
    }

    pub fn snapshot_segments(&self) -> Result<TantivySnapshot> {
        let mut entries =
            std::fs::read_dir(self.work_dir.path()).map_err(|err| MemvidError::Tantivy {
                reason: format!(
                    "failed to read Tantivy index directory {}: {}",
                    self.work_dir.path().display(),
                    err
                ),
            })?;
        let mut file_names: Vec<String> = Vec::new();
        while let Some(entry) = entries.next() {
            let entry = entry.map_err(|err| MemvidError::Tantivy {
                reason: format!(
                    "failed to iterate Tantivy index directory {}: {}",
                    self.work_dir.path().display(),
                    err
                ),
            })?;
            let file_type = entry.file_type().map_err(|err| MemvidError::Tantivy {
                reason: format!(
                    "failed to inspect Tantivy index entry {}: {}",
                    entry.path().display(),
                    err
                ),
            })?;
            if file_type.is_file() {
                let name = entry.file_name().to_string_lossy().into_owned();
                // Skip Tantivy lock files - they're held open and cause Windows errors
                if name.starts_with(".tantivy-") {
                    continue;
                }
                file_names.push(name);
            }
        }
        file_names.sort();

        let mut segments = Vec::with_capacity(file_names.len());
        let mut index_hasher = Hasher::new();

        for name in file_names {
            let path = self.work_dir.path().join(&name);
            // Use read_file_shared for Windows compatibility with mmap'd files
            let bytes = read_file_shared(&path).map_err(|err| MemvidError::Tantivy {
                reason: format!("failed to read Tantivy segment {}: {}", path.display(), err),
            })?;
            let checksum = *hash(&bytes).as_bytes();
            index_hasher.update(&checksum);
            index_hasher.update(name.as_bytes());
            segments.push(TantivySegmentBlob {
                path: name,
                bytes,
                checksum,
            });
        }

        let checksum = *index_hasher.finalize().as_bytes();
        Ok(TantivySnapshot {
            doc_count: self.reader.searcher().num_docs(),
            checksum,
            segments,
        })
    }

    pub(crate) fn analyse_text(&self, text: &str) -> Vec<String> {
        if let Some(name) = &self.tokenizer {
            if let Some(mut analyzer) = self.index.tokenizers().get(name) {
                let mut stream = analyzer.token_stream(text);
                let mut tokens = Vec::new();
                while stream.advance() {
                    tokens.push(stream.token().text.to_string());
                }
                return tokens;
            }
        }
        if text.trim().is_empty() {
            Vec::new()
        } else {
            vec![text.to_ascii_lowercase()]
        }
    }

    pub fn num_docs(&self) -> u64 {
        self.reader.searcher().num_docs()
    }
}

impl Drop for TantivyEngine {
    fn drop(&mut self) {
        // CRITICAL: Windows compatibility requires explicit drop ordering.
        //
        // On Windows, Tantivy uses mmap which holds exclusive file locks.
        // When TempDir::drop() tries to delete files that are still mmaped,
        // Windows returns "Access is denied (os error 5)".
        //
        // We MUST drop all Tantivy components that hold mmap handles BEFORE
        // the TempDir is dropped. The order is:
        // 1. IndexWriter - has background merge threads that hold file handles
        // 2. IndexReader - holds mmap handles via its Searcher
        // 3. Index - holds directory handles
        // 4. TempDir - can now safely delete all files

        // Step 1: Take and properly shut down the IndexWriter
        if let Some(writer) = self.index_writer.take() {
            // wait_merging_threads() consumes the writer and blocks until all
            // background merge operations complete, releasing all file handles.
            if let Err(err) = writer.wait_merging_threads() {
                tracing::warn!(
                    "TantivyEngine drop: failed to wait for merging threads: {}",
                    err
                );
            }
        }

        // Step 2: Explicitly drop the IndexReader to release its mmap handles
        // SAFETY: We own the ManuallyDrop and this is the only place we drop it.
        // After this, self.reader is in an undefined state, but that's OK since
        // we're in Drop and won't access it again.
        unsafe {
            ManuallyDrop::drop(&mut self.reader);
        }

        // Step 3: Explicitly drop the Index to release directory handles
        // SAFETY: Same as above - we own it and this is the only drop point.
        unsafe {
            ManuallyDrop::drop(&mut self.index);
        }

        // Step 4: TempDir (work_dir) will be dropped automatically after this
        // function returns, and all file handles are now released.
    }
}
