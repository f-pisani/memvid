use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};

use fs2::{FileExt, lock_contended_error};

use crate::error::{MemvidError, Result};
use crate::registry;

#[derive(Debug)]
pub(crate) struct SnapshotLock {
    file: File,
}

impl Drop for SnapshotLock {
    fn drop(&mut self) {
        let _ = self.file.unlock();
    }
}

fn lock_path(path: &Path) -> Result<PathBuf> {
    let file_id = registry::compute_file_id(path)?;
    registry::snapshot_lock_path(&file_id)
}

pub(crate) fn acquire_shared(path: &Path) -> Result<SnapshotLock> {
    let lock_path = lock_path(path)?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(&lock_path)?;
    file.lock_shared()
        .map_err(|err| MemvidError::Lock(err.to_string()))?;
    Ok(SnapshotLock { file })
}

pub(crate) fn try_acquire_exclusive(path: &Path) -> Result<Option<SnapshotLock>> {
    let lock_path = lock_path(path)?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(&lock_path)?;
    let contended_kind = lock_contended_error().kind();
    loop {
        match file.try_lock_exclusive() {
            Ok(()) => {
                return Ok(Some(SnapshotLock { file }));
            }
            Err(err) if err.kind() == std::io::ErrorKind::Interrupted => {}
            Err(err) if err.kind() == contended_kind => return Ok(None),
            Err(err) => return Err(MemvidError::Lock(err.to_string())),
        }
    }
}
