use std::convert::TryFrom;
use std::env;
use std::fmt;
use std::io::ErrorKind;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use blake3::Hasher;
use fs_err::{self as fs, File, OpenOptions};
use same_file::Handle;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::error::{LockOwnerHint, Result};

const HEADER_SAMPLE_BYTES: usize = 4 * 1024;
const REGISTRY_SUBDIR: &str = "locks";
const SNAPSHOT_SUBDIR: &str = "snapshots";
const FILE_LOCK_SUBDIR: &str = "file_locks";
const ROOT_DIR: &str = ".memvid";

/// Cached registry root path (initialized once per process).
///
/// # Caching Behavior
/// This is initialized on first access and cached for the process lifetime.
/// Changes to `MEMVID_LOCK_REGISTRY_DIR` environment variable after first
/// access are ignored. Configure the environment at process startup.
///
/// # Thread Safety
/// Multiple threads may race to initialize; the first to complete wins.
/// All threads will use the same cached path regardless of initialization order.
static REGISTRY_ROOT: OnceLock<PathBuf> = OnceLock::new();

/// Cached file lock directory path (initialized once per process).
/// See [`REGISTRY_ROOT`] for caching semantics.
static FILE_LOCK_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Cached snapshot lock directory path (initialized once per process).
/// See [`REGISTRY_ROOT`] for caching semantics.
static SNAPSHOT_LOCK_DIR: OnceLock<PathBuf> = OnceLock::new();

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct FileId {
    raw: String,
}

impl FileId {
    fn new(raw: String) -> Self {
        Self { raw }
    }

    pub fn as_str(&self) -> &str {
        &self.raw
    }
}

impl fmt::Display for FileId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.raw)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LockRecord {
    pub pid: u32,
    pub cmd: String,
    pub started_at: String,
    pub file_path: String,
    pub file_id: String,
    pub heartbeat_ms: u64,
    pub last_heartbeat: String,
}

impl LockRecord {
    pub fn new(file_id: &FileId, file_path: &Path, cmd: String, heartbeat_ms: u64) -> Result<Self> {
        let started_at = current_timestamp()?;
        Ok(Self {
            pid: std::process::id(),
            cmd,
            started_at: started_at.clone(),
            file_path: file_path.display().to_string(),
            file_id: file_id.as_str().to_string(),
            heartbeat_ms,
            last_heartbeat: started_at,
        })
    }

    #[allow(dead_code)]
    pub fn touch(&mut self) -> Result<()> {
        self.last_heartbeat = current_timestamp()?;
        Ok(())
    }

    pub fn to_owner_hint(&self) -> LockOwnerHint {
        LockOwnerHint {
            pid: Some(self.pid),
            cmd: Some(self.cmd.clone()),
            started_at: Some(self.started_at.clone()),
            file_path: Some(PathBuf::from(&self.file_path)),
            file_id: Some(self.file_id.clone()),
            last_heartbeat: Some(self.last_heartbeat.clone()),
            heartbeat_ms: Some(self.heartbeat_ms),
        }
    }
}

fn current_timestamp() -> Result<String> {
    let now = OffsetDateTime::now_utc();
    now.format(&Rfc3339)
        .map_err(|err| io::Error::new(io::ErrorKind::Other, err))
        .map_err(Into::into)
}

pub fn compute_file_id(path: &Path) -> Result<FileId> {
    let handle = Handle::from_path(path)?;
    let mut file = File::open(path)?;
    let mut sample = [0u8; HEADER_SAMPLE_BYTES];
    let read = file.read(&mut sample)?;
    let mut hasher = Hasher::new();
    hasher.update(&sample[..read]);

    #[cfg(unix)]
    let prefix = format!(
        "unix-{dev:016x}-{ino:016x}",
        dev = handle.dev(),
        ino = handle.ino()
    );

    #[cfg(windows)]
    let prefix = {
        // Use stable APIs only: canonicalized path + metadata for deterministic ID.
        // The unstable volume_serial_number/file_index_high/file_index_low APIs
        // require nightly (windows_by_handle feature), so we use a hash-based fallback.
        use std::os::windows::fs::MetadataExt;

        let canonical_path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
        let metadata = handle.as_file().metadata()?;

        // Build a deterministic identifier from stable metadata:
        // - Canonicalized path (primary identifier)
        // - File size (file_size() is stable on Windows)
        // - Creation time (creation_time() is stable on Windows)
        // - Last write time (last_write_time() is stable on Windows)
        let mut path_hasher = Hasher::new();
        path_hasher.update(canonical_path.to_string_lossy().as_bytes());
        path_hasher.update(&metadata.file_size().to_le_bytes());
        path_hasher.update(&metadata.creation_time().to_le_bytes());
        path_hasher.update(&metadata.last_write_time().to_le_bytes());

        let path_hash = path_hasher.finalize();
        format!("win-{}", &path_hash.to_hex()[..32])
    };

    #[cfg(not(any(unix, windows)))]
    let prefix = "other".to_string();

    let identifier = format!("{}-{}", prefix, hasher.finalize().to_hex());
    Ok(FileId::new(identifier))
}

pub fn compute_file_id_with_file(path: &Path, _file: &std::fs::File) -> Result<FileId> {
    let canonical_path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let mut path_hasher = Hasher::new();
    path_hasher.update(canonical_path.to_string_lossy().as_bytes());
    let identifier = format!("path-{}", &path_hasher.finalize().to_hex()[..32]);
    Ok(FileId::new(identifier))
}

fn registry_root() -> Result<PathBuf> {
    // Use cached path if available to avoid repeated directory operations.
    if let Some(cached) = REGISTRY_ROOT.get() {
        return Ok(cached.clone());
    }

    let mut last_err: Option<io::Error> = None;

    for candidate in registry_candidates() {
        match ensure_directory(candidate) {
            Ok(path) => {
                // Cache the successful path for future calls.
                let _ = REGISTRY_ROOT.set(path.clone());
                return Ok(path);
            }
            Err(err) if recoverable_dir_error(&err) => {
                last_err = Some(err);
            }
            Err(err) => return Err(err.into()),
        }
    }

    Err(last_err
        .unwrap_or_else(|| {
            io::Error::new(
                io::ErrorKind::Other,
                "failed to establish memvid lock registry directory",
            )
        })
        .into())
}

fn registry_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(override_root) = env::var_os("MEMVID_LOCK_REGISTRY_DIR") {
        candidates.push(PathBuf::from(override_root));
    }

    candidates.push(env::temp_dir().join(ROOT_DIR).join(REGISTRY_SUBDIR));

    if let Some(home) = dirs_next::home_dir() {
        candidates.push(home.join(ROOT_DIR).join(REGISTRY_SUBDIR));
    }

    if let Ok(cwd) = env::current_dir() {
        candidates.push(cwd.join(ROOT_DIR).join(REGISTRY_SUBDIR));
    }

    candidates
}

pub(crate) fn ensure_directory(path: PathBuf) -> io::Result<PathBuf> {
    fs::create_dir_all(&path)?;
    let mut attempts = 0;
    loop {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let sentinel = path.join(format!(".write_test.{}.{}", std::process::id(), nanos));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&sentinel)
        {
            Ok(_) => {
                let _ = fs::remove_file(sentinel);
                return Ok(path);
            }
            Err(err)
                if matches!(
                    err.kind(),
                    io::ErrorKind::AlreadyExists | io::ErrorKind::PermissionDenied
                ) && attempts < 3 =>
            {
                attempts += 1;
                thread::sleep(Duration::from_millis(10));
            }
            Err(err) => return Err(err),
        }
    }
}

fn recoverable_dir_error(err: &io::Error) -> bool {
    matches!(
        err.kind(),
        ErrorKind::PermissionDenied | ErrorKind::NotFound | ErrorKind::ReadOnlyFilesystem
    )
}

fn record_path(file_id: &FileId) -> Result<PathBuf> {
    Ok(registry_root()?.join(format!("{}.json", file_id.as_str())))
}

pub fn snapshot_lock_path(file_id: &FileId) -> Result<PathBuf> {
    // Use cached directory path to avoid repeated ensure_directory calls.
    let snapshot_root = if let Some(cached) = SNAPSHOT_LOCK_DIR.get() {
        cached.clone()
    } else {
        let path = ensure_directory(registry_root()?.join(SNAPSHOT_SUBDIR))?;
        let _ = SNAPSHOT_LOCK_DIR.set(path.clone());
        path
    };
    Ok(snapshot_root.join(format!("{}.snapshot.lock", file_id.as_str())))
}

pub fn file_lock_path(file_id: &FileId) -> Result<PathBuf> {
    // Use cached directory path to avoid repeated ensure_directory calls.
    let lock_root = if let Some(cached) = FILE_LOCK_DIR.get() {
        cached.clone()
    } else {
        let path = ensure_directory(registry_root()?.join(FILE_LOCK_SUBDIR))?;
        let _ = FILE_LOCK_DIR.set(path.clone());
        path
    };
    Ok(lock_root.join(format!("{}.file.lock", file_id.as_str())))
}

pub fn write_record(record: &LockRecord) -> Result<()> {
    let path = record_path(&FileId::new(record.file_id.clone()))?;
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(path)?;
    serde_json::to_writer(&mut file, record)
        .map_err(|err| io::Error::new(io::ErrorKind::Other, err))?;
    file.flush()?;
    file.sync_all()?;
    Ok(())
}

#[allow(dead_code)]
pub fn heartbeat(file_id: &FileId) -> Result<Option<LockRecord>> {
    let Some(mut record) = read_record(file_id)? else {
        return Ok(None);
    };
    record.touch()?;
    write_record(&record)?;
    Ok(Some(record))
}

pub fn read_record(file_id: &FileId) -> Result<Option<LockRecord>> {
    let path = record_path(file_id)?;
    let file = match File::open(&path) {
        Ok(file) => file,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(err.into()),
    };
    let record: LockRecord =
        serde_json::from_reader(file).map_err(|err| io::Error::new(io::ErrorKind::Other, err))?;
    Ok(Some(record))
}

pub fn remove_record(file_id: &FileId) -> Result<()> {
    let path = record_path(file_id)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err.into()),
    }
}

pub fn is_stale(record: &LockRecord, grace: Duration) -> bool {
    match OffsetDateTime::parse(&record.last_heartbeat, &Rfc3339) {
        Ok(last) => match Duration::try_from(OffsetDateTime::now_utc() - last) {
            Ok(elapsed) => elapsed > grace,
            Err(_) => false,
        },
        Err(_) => true,
    }
}

pub fn to_owner_hint(record: Option<LockRecord>) -> Option<LockOwnerHint> {
    record.map(|r| r.to_owner_hint())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;

    /// Verify that registry_root returns consistent results across multiple calls.
    /// This tests the OnceLock caching behavior.
    #[test]
    fn registry_root_returns_consistent_path() {
        let path1 = registry_root().expect("first call");
        let path2 = registry_root().expect("second call");
        let path3 = registry_root().expect("third call");

        assert_eq!(path1, path2, "registry_root should return same path");
        assert_eq!(path2, path3, "registry_root should return same path");
    }

    /// Verify that file_lock_path returns consistent directory across calls.
    #[test]
    fn file_lock_path_uses_cached_directory() {
        let file_id_1 = FileId::new("test-file-1".to_string());
        let file_id_2 = FileId::new("test-file-2".to_string());

        let path1 = file_lock_path(&file_id_1).expect("first file");
        let path2 = file_lock_path(&file_id_2).expect("second file");

        // Both should be in the same directory (cached)
        assert_eq!(
            path1.parent(),
            path2.parent(),
            "lock files should be in same cached directory"
        );
    }

    /// Verify that snapshot_lock_path returns consistent directory across calls.
    #[test]
    fn snapshot_lock_path_uses_cached_directory() {
        let file_id_1 = FileId::new("test-snap-1".to_string());
        let file_id_2 = FileId::new("test-snap-2".to_string());

        let path1 = snapshot_lock_path(&file_id_1).expect("first snapshot");
        let path2 = snapshot_lock_path(&file_id_2).expect("second snapshot");

        assert_eq!(
            path1.parent(),
            path2.parent(),
            "snapshot locks should be in same cached directory"
        );
    }

    /// Test concurrent calls to registry_root from multiple threads.
    /// All threads should get the same cached path.
    #[test]
    fn concurrent_registry_root_returns_same_path() {
        const NUM_THREADS: usize = 10;

        let results: Arc<std::sync::Mutex<Vec<PathBuf>>> =
            Arc::new(std::sync::Mutex::new(Vec::with_capacity(NUM_THREADS)));

        let handles: Vec<_> = (0..NUM_THREADS)
            .map(|_| {
                let results = Arc::clone(&results);
                thread::spawn(move || {
                    let path = registry_root().expect("registry_root should succeed");
                    results.lock().unwrap().push(path);
                })
            })
            .collect();

        for handle in handles {
            handle.join().expect("thread should complete");
        }

        let paths = results.lock().unwrap();
        assert_eq!(paths.len(), NUM_THREADS);

        // All paths should be identical
        let first = &paths[0];
        for (i, path) in paths.iter().enumerate() {
            assert_eq!(
                path, first,
                "thread {} got different path: {:?} vs {:?}",
                i, path, first
            );
        }
    }

    /// Test concurrent calls to file_lock_path from multiple threads.
    /// All threads should use the same cached directory.
    #[test]
    fn concurrent_file_lock_path_uses_same_directory() {
        const NUM_THREADS: usize = 10;

        let results: Arc<std::sync::Mutex<Vec<PathBuf>>> =
            Arc::new(std::sync::Mutex::new(Vec::with_capacity(NUM_THREADS)));

        let handles: Vec<_> = (0..NUM_THREADS)
            .map(|i| {
                let results = Arc::clone(&results);
                thread::spawn(move || {
                    let file_id = FileId::new(format!("concurrent-test-{}", i));
                    let path = file_lock_path(&file_id).expect("file_lock_path should succeed");
                    results.lock().unwrap().push(path);
                })
            })
            .collect();

        for handle in handles {
            handle.join().expect("thread should complete");
        }

        let paths = results.lock().unwrap();
        assert_eq!(paths.len(), NUM_THREADS);

        // All paths should have the same parent directory
        let first_parent = paths[0].parent().unwrap();
        for (i, path) in paths.iter().enumerate() {
            assert_eq!(
                path.parent().unwrap(),
                first_parent,
                "thread {} got different directory: {:?} vs {:?}",
                i,
                path.parent(),
                first_parent
            );
        }
    }

    /// Test that compute_file_id_with_file produces consistent IDs for the same path.
    #[test]
    fn compute_file_id_is_deterministic() {
        use std::io::Write;
        use tempfile::NamedTempFile;

        let mut temp = NamedTempFile::new().expect("create temp file");
        writeln!(temp, "test content").expect("write content");
        let path = temp.path();

        let file1 = std::fs::File::open(path).expect("open file 1");
        let file2 = std::fs::File::open(path).expect("open file 2");

        let id1 = compute_file_id_with_file(path, &file1).expect("compute id 1");
        let id2 = compute_file_id_with_file(path, &file2).expect("compute id 2");

        assert_eq!(
            id1, id2,
            "same file should produce same ID across different handles"
        );
    }

    /// Test that different files produce different IDs.
    #[test]
    fn compute_file_id_differs_for_different_files() {
        use std::io::Write;
        use tempfile::NamedTempFile;

        let mut temp1 = NamedTempFile::new().expect("create temp file 1");
        let mut temp2 = NamedTempFile::new().expect("create temp file 2");

        writeln!(temp1, "content 1").expect("write content 1");
        writeln!(temp2, "content 2").expect("write content 2");

        let file1 = std::fs::File::open(temp1.path()).expect("open file 1");
        let file2 = std::fs::File::open(temp2.path()).expect("open file 2");

        let id1 = compute_file_id_with_file(temp1.path(), &file1).expect("compute id 1");
        let id2 = compute_file_id_with_file(temp2.path(), &file2).expect("compute id 2");

        assert_ne!(id1, id2, "different files should produce different IDs");
    }

    /// Test ensure_directory creates directory and handles concurrent calls.
    #[test]
    fn ensure_directory_handles_concurrent_calls() {
        use tempfile::TempDir;

        let temp_dir = TempDir::new().expect("create temp dir");
        let test_path = temp_dir.path().join("concurrent_test_dir");

        const NUM_THREADS: usize = 5;

        let path = test_path.clone();
        let handles: Vec<_> = (0..NUM_THREADS)
            .map(|_| {
                let path = path.clone();
                thread::spawn(move || ensure_directory(path))
            })
            .collect();

        let results: Vec<_> = handles
            .into_iter()
            .map(|h| h.join().expect("thread should complete"))
            .collect();

        // All should succeed and return the same path
        for result in &results {
            assert!(result.is_ok(), "ensure_directory should succeed");
        }

        let paths: Vec<_> = results.into_iter().map(|r| r.unwrap()).collect();
        let first = &paths[0];
        for path in &paths {
            assert_eq!(path, first, "all threads should return same path");
        }

        // Directory should exist
        assert!(test_path.is_dir(), "directory should exist");
    }
}
