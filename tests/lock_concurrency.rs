//! Cross-process lock contention tests.

use fs2::FileExt;
use memvid_core::{Memvid, MemvidError};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::thread;
use std::time::{Duration, Instant};
use tempfile::TempDir;

fn wait_for_file(path: &Path, timeout: Duration) -> Result<(), String> {
    let start = Instant::now();
    while !path.exists() {
        if start.elapsed() > timeout {
            return Err(format!("Timed out waiting for {}", path.display()));
        }
        thread::sleep(Duration::from_millis(25));
    }
    Ok(())
}

fn wait_for_exit(child: &mut Child, timeout: Duration) -> Result<(), String> {
    let start = Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            if status.success() {
                return Ok(());
            }
            return Err(format!("Lock holder exited with status {status}"));
        }
        if start.elapsed() > timeout {
            let _ = child.kill();
            return Err("Timed out waiting for lock holder exit".to_string());
        }
        thread::sleep(Duration::from_millis(25));
    }
}

fn spawn_lock_holder(
    mode: &str,
    path: &Path,
    dir: &TempDir,
) -> Result<(Child, PathBuf, PathBuf), String> {
    let token = fastrand::u64(..);
    let ready_path = dir.path().join(format!("ready_{token}"));
    let release_path = dir.path().join(format!("release_{token}"));
    let mut child = Command::new(env!("CARGO_BIN_EXE_lock_helper"))
        .args([
            "--path",
            path.to_string_lossy().as_ref(),
            "--mode",
            mode,
            "--ready",
            ready_path.to_string_lossy().as_ref(),
            "--release",
            release_path.to_string_lossy().as_ref(),
            "--timeout-ms",
            "30000",
        ])
        .spawn()
        .map_err(|e| e.to_string())?;
    if let Err(err) = wait_for_file(&ready_path, Duration::from_secs(5)) {
        let _ = child.kill();
        return Err(err);
    }
    Ok((child, ready_path, release_path))
}

fn expect_lock_error(result: memvid_core::Result<Memvid>) {
    match result {
        Ok(mem) => {
            drop(mem);
            panic!("expected lock error");
        }
        Err(MemvidError::Lock(_)) | Err(MemvidError::Locked(_)) => {}
        Err(err) => panic!("unexpected error: {err:?}"),
    }
}

#[test]
fn shared_lock_allows_shared_blocks_exclusive() {
    let dir = TempDir::new().expect("tmp");
    let path = dir.path().join("mem.mv2");
    {
        let mut mem = Memvid::create(&path).expect("create");
        mem.commit().expect("commit");
    }

    let (mut child, _ready, release) =
        spawn_lock_holder("shared", &path, &dir).expect("spawn lock holder");

    let probe = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&path)
        .expect("open probe");
    assert!(
        probe.try_lock_exclusive().is_err(),
        "lock should be contended"
    );

    let shared = Memvid::open_read_only(&path).expect("shared open");
    assert!(shared.is_read_only());
    drop(shared);

    let open_result = Memvid::open(&path);
    fs::write(&release, b"release").expect("release");
    wait_for_exit(&mut child, Duration::from_secs(5)).expect("child exit");
    expect_lock_error(open_result);
}

#[test]
fn exclusive_lock_blocks_shared() {
    let dir = TempDir::new().expect("tmp");
    let path = dir.path().join("mem.mv2");
    {
        let mut mem = Memvid::create(&path).expect("create");
        mem.commit().expect("commit");
    }

    let (mut child, _ready, release) =
        spawn_lock_holder("exclusive", &path, &dir).expect("spawn lock holder");

    let probe = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&path)
        .expect("open probe");
    assert!(probe.try_lock_shared().is_err(), "lock should be contended");

    let open_result = Memvid::open_read_only(&path);
    fs::write(&release, b"release").expect("release");
    wait_for_exit(&mut child, Duration::from_secs(5)).expect("child exit");
    expect_lock_error(open_result);
}

#[test]
fn snapshot_open_allows_concurrent_writer() {
    let dir = TempDir::new().expect("tmp");
    let path = dir.path().join("mem.mv2");
    {
        let mut mem = Memvid::create(&path).expect("create");
        mem.commit().expect("commit");
    }

    let (mut child, _ready, release) =
        spawn_lock_holder("exclusive", &path, &dir).expect("spawn lock holder");

    let snapshot = Memvid::open_snapshot(&path).expect("snapshot open");
    assert!(snapshot.is_read_only());
    drop(snapshot);

    fs::write(&release, b"release").expect("release");
    wait_for_exit(&mut child, Duration::from_secs(5)).expect("child exit");
}
