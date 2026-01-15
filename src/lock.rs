use std::fs::{File, OpenOptions};
use std::path::Path;
use std::thread;
use std::time::Duration;

use fs2::{FileExt, lock_contended_error};

use crate::error::{MemvidError, Result};
#[cfg(windows)]
use crate::registry;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LockMode {
    None,
    Shared,
    Exclusive,
}

/// File lock guard that can hold either a shared or exclusive OS lock.
pub struct FileLock {
    file: File,
    mode: LockMode,
    #[cfg(windows)]
    lock_file: Option<File>,
}

impl FileLock {
    #[cfg(windows)]
    fn open_lock_file(path: &Path, file: &File) -> Result<File> {
        let file_id = registry::compute_file_id_with_file(path, file)?;
        let lock_path = registry::file_lock_path(&file_id)?;
        let lock_file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .open(&lock_path)?;
        Ok(lock_file)
    }

    fn lock_handle(&self) -> &File {
        #[cfg(windows)]
        {
            self.lock_file.as_ref().unwrap_or(&self.file)
        }
        #[cfg(not(windows))]
        {
            &self.file
        }
    }

    /// Opens a file at `path` with read/write permissions and acquires an exclusive lock.
    pub fn open_and_lock(path: &Path) -> Result<(File, Self)> {
        let file = OpenOptions::new().read(true).write(true).open(path)?;
        let guard = Self::acquire_with_mode(&file, path, LockMode::Exclusive)?;
        Ok((file, guard))
    }

    /// Opens a file at `path` with read/write permissions and acquires a shared lock.
    pub fn open_read_only(path: &Path) -> Result<(File, Self)> {
        let file = OpenOptions::new().read(true).write(true).open(path)?;
        let guard = Self::acquire_with_mode(&file, path, LockMode::Shared)?;
        Ok((file, guard))
    }

    /// Returns a non-locking guard for callers that only require a stable clone handle.
    pub fn unlocked(file: &File) -> Result<Self> {
        Ok(Self {
            file: file.try_clone()?,
            mode: LockMode::None,
            #[cfg(windows)]
            lock_file: None,
        })
    }

    /// Clones the provided file handle and locks it exclusively.
    pub fn acquire(file: &File, path: &Path) -> Result<Self> {
        Self::acquire_with_mode(file, path, LockMode::Exclusive)
    }

    /// Attempts a non-blocking exclusive lock, returning None if already locked.
    ///
    /// IMPORTANT: We clone the data handle so callers get a stable file object.
    /// On Windows we lock a registry lock file instead of the `.mv2` itself to
    /// avoid mandatory lock violations on concurrent readers.
    pub fn try_acquire(file: &File, path: &Path) -> Result<Option<Self>> {
        #[cfg(not(windows))]
        let _ = path;

        let clone = file.try_clone()?;
        #[cfg(windows)]
        let lock_file = Self::open_lock_file(path, file)?;
        let contended_kind = lock_contended_error().kind();

        loop {
            #[cfg(windows)]
            let result = lock_file.try_lock_exclusive();
            #[cfg(not(windows))]
            let result = clone.try_lock_exclusive();

            match result {
                Ok(()) => {
                    return Ok(Some(Self {
                        file: clone,
                        mode: LockMode::Exclusive,
                        #[cfg(windows)]
                        lock_file: Some(lock_file),
                    }));
                }
                Err(err) if err.kind() == std::io::ErrorKind::Interrupted => {}
                Err(err) if err.kind() == contended_kind => return Ok(None),
                Err(err) => return Err(MemvidError::Lock(err.to_string())),
            }
        }
    }

    /// Releases the underlying OS file lock.
    pub fn unlock(&mut self) -> Result<()> {
        if self.mode == LockMode::None {
            return Ok(());
        }
        self.lock_handle()
            .unlock()
            .map_err(|err| MemvidError::Lock(err.to_string()))
    }

    /// Exposes a clone of the locked handle for buffered operations.
    pub fn clone_handle(&self) -> Result<File> {
        Ok(self.file.try_clone()?)
    }

    pub fn mode(&self) -> LockMode {
        self.mode
    }

    pub fn downgrade_to_shared(&mut self) -> Result<()> {
        if self.mode == LockMode::None {
            return Err(MemvidError::Lock(
                "cannot downgrade an unlocked file handle".to_string(),
            ));
        }
        if self.mode == LockMode::Shared {
            return Ok(());
        }
        let lock_handle = self.lock_handle();
        lock_handle
            .unlock()
            .map_err(|err| MemvidError::Lock(err.to_string()))?;
        Self::lock_with_retry(lock_handle, LockMode::Shared)?;
        self.mode = LockMode::Shared;
        Ok(())
    }

    pub fn upgrade_to_exclusive(&mut self) -> Result<()> {
        if self.mode == LockMode::None {
            return Err(MemvidError::Lock(
                "cannot upgrade an unlocked file handle".to_string(),
            ));
        }
        if self.mode == LockMode::Exclusive {
            return Ok(());
        }
        let lock_handle = self.lock_handle();
        lock_handle
            .unlock()
            .map_err(|err| MemvidError::Lock(err.to_string()))?;
        Self::lock_with_retry(lock_handle, LockMode::Exclusive)?;
        self.mode = LockMode::Exclusive;
        Ok(())
    }

    pub(crate) fn acquire_with_mode(file: &File, path: &Path, mode: LockMode) -> Result<Self> {
        #[cfg(not(windows))]
        let _ = path;

        let clone = file.try_clone()?;
        #[cfg(windows)]
        let lock_file = if mode == LockMode::None {
            None
        } else {
            Some(Self::open_lock_file(path, file)?)
        };

        #[cfg(windows)]
        if let Some(handle) = lock_file.as_ref() {
            Self::lock_with_retry(handle, mode)?;
        }
        #[cfg(not(windows))]
        Self::lock_with_retry(&clone, mode)?;

        Ok(Self {
            file: clone,
            mode,
            #[cfg(windows)]
            lock_file,
        })
    }

    fn lock_with_retry(file: &File, mode: LockMode) -> Result<()> {
        const MAX_ATTEMPTS: u32 = 200; // ~10 seconds with 50ms backoff
        const BACKOFF: Duration = Duration::from_millis(50);
        let contended_kind = lock_contended_error().kind();
        let mut attempts = 0;
        loop {
            let result = match mode {
                LockMode::None => return Ok(()),
                LockMode::Exclusive => file.try_lock_exclusive(),
                LockMode::Shared => FileExt::try_lock_shared(file),
            };
            match result {
                Ok(()) => return Ok(()),
                Err(err) if err.kind() == std::io::ErrorKind::Interrupted => {}
                Err(err) if err.kind() == contended_kind => {
                    if attempts >= MAX_ATTEMPTS {
                        return Err(MemvidError::Lock(
                            "exclusive access unavailable; file is in use by another process"
                                .to_string(),
                        ));
                    }
                    attempts += 1;
                    thread::sleep(BACKOFF);
                }
                Err(err) => return Err(MemvidError::Lock(err.to_string())),
            }
        }
    }
}

impl Drop for FileLock {
    /// Releases the file lock and associated resources.
    ///
    /// # Windows Behavior
    /// On Windows, the lock file handle is explicitly dropped immediately after
    /// unlocking to ensure the OS releases all resources synchronously. This
    /// prevents race conditions when the same file is reopened quickly in
    /// concurrent scenarios (e.g., parallel tests, multi-threaded applications).
    ///
    /// Without explicit drop, Windows may delay releasing the lock file handle
    /// until after struct field drops complete, causing subsequent lock
    /// acquisitions to fail with "file in use" errors.
    fn drop(&mut self) {
        if self.mode != LockMode::None {
            let _ = self.lock_handle().unlock();
        }
        #[cfg(windows)]
        {
            // Explicitly close the lock file handle to ensure OS releases
            // all resources before this drop returns. Required for Windows
            // mandatory locking semantics.
            drop(self.lock_file.take());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn acquiring_lock_blocks_second_writer() {
        let temp = NamedTempFile::new().expect("temp file");
        let path = temp.path();
        writeln!(&mut temp.as_file().try_clone().unwrap(), "seed").unwrap();

        // First handle acquires the lock
        let file1 = OpenOptions::new()
            .read(true)
            .write(true)
            .open(path)
            .expect("open file 1");
        let guard = FileLock::acquire(&file1, path).expect("first lock succeeds");

        // Second handle (separate open, simulating another process) should be blocked
        let file2 = OpenOptions::new()
            .read(true)
            .write(true)
            .open(path)
            .expect("open file 2");
        let second = FileLock::try_acquire(&file2, path).expect("second lock attempt");
        assert!(second.is_none(), "lock should already be held");

        // After dropping the first lock, third attempt should succeed
        drop(guard);
        let third = FileLock::try_acquire(&file2, path).expect("third lock attempt");
        assert!(third.is_some(), "lock released after drop");
    }
}
