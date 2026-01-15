use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::path::Path;
use std::sync::{Mutex, OnceLock};

use fs2::{FileExt, lock_contended_error};

use crate::error::{MemvidError, Result};
use crate::registry;

#[derive(Debug)]
pub(crate) struct SnapshotLock {
    file: File,
    file_id: String,
}

fn reader_counts() -> &'static Mutex<HashMap<String, usize>> {
    static COUNTS: OnceLock<Mutex<HashMap<String, usize>>> = OnceLock::new();
    COUNTS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn track_reader(file_id: &str) {
    let mut counts = reader_counts()
        .lock()
        .expect("snapshot reader counts poisoned");
    *counts.entry(file_id.to_string()).or_insert(0) += 1;
}

fn untrack_reader(file_id: &str) {
    let mut counts = reader_counts()
        .lock()
        .expect("snapshot reader counts poisoned");
    let Some(count) = counts.get_mut(file_id) else {
        return;
    };
    if *count <= 1 {
        counts.remove(file_id);
    } else {
        *count -= 1;
    }
}

fn has_in_process_readers(file_id: &str) -> bool {
    let counts = reader_counts()
        .lock()
        .expect("snapshot reader counts poisoned");
    counts.get(file_id).copied().unwrap_or(0) > 0
}

impl Drop for SnapshotLock {
    fn drop(&mut self) {
        untrack_reader(&self.file_id);
        let _ = self.file.unlock();
    }
}

pub(crate) fn acquire_shared(path: &Path, file: &mut File) -> Result<SnapshotLock> {
    let file_id = registry::compute_file_id_with_file(path, file)?;
    let lock_path = registry::snapshot_lock_path(&file_id)?;
    let lock_file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(&lock_path)?;
    lock_file
        .lock_shared()
        .map_err(|err| MemvidError::Lock(err.to_string()))?;
    let file_id = file_id.as_str().to_string();
    track_reader(&file_id);
    Ok(SnapshotLock {
        file: lock_file,
        file_id,
    })
}

pub(crate) fn try_acquire_exclusive(path: &Path, file: &mut File) -> Result<Option<SnapshotLock>> {
    let file_id = registry::compute_file_id_with_file(path, file)?;
    if has_in_process_readers(file_id.as_str()) {
        return Ok(None);
    }
    let lock_path = registry::snapshot_lock_path(&file_id)?;
    let lock_file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(&lock_path)?;
    let contended_kind = lock_contended_error().kind();
    loop {
        match lock_file.try_lock_exclusive() {
            Ok(()) => {
                let file_id = file_id.as_str().to_string();
                return Ok(Some(SnapshotLock {
                    file: lock_file,
                    file_id,
                }));
            }
            Err(err) if err.kind() == std::io::ErrorKind::Interrupted => {}
            Err(err) if err.kind() == contended_kind => return Ok(None),
            Err(err) => return Err(MemvidError::Lock(err.to_string())),
        }
    }
}
