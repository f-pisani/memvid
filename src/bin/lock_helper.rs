use std::env;
use std::fs;
use std::path::PathBuf;
use std::thread;
use std::time::{Duration, Instant};

use memvid_core::FileLock;

#[derive(Debug, Clone, Copy)]
enum LockMode {
    Shared,
    Exclusive,
}

struct Config {
    path: PathBuf,
    mode: LockMode,
    ready_path: PathBuf,
    release_path: PathBuf,
    timeout: Duration,
}

fn parse_args() -> Result<Config, String> {
    let mut args = env::args().skip(1);
    let mut path: Option<PathBuf> = None;
    let mut mode: Option<LockMode> = None;
    let mut ready_path: Option<PathBuf> = None;
    let mut release_path: Option<PathBuf> = None;
    let mut timeout_ms: Option<u64> = None;

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--path" => {
                path = args.next().map(PathBuf::from);
            }
            "--mode" => {
                let value = args.next().unwrap_or_default();
                mode = match value.as_str() {
                    "shared" => Some(LockMode::Shared),
                    "exclusive" => Some(LockMode::Exclusive),
                    _ => return Err(format!("Unknown mode: {value}")),
                };
            }
            "--ready" => {
                ready_path = args.next().map(PathBuf::from);
            }
            "--release" => {
                release_path = args.next().map(PathBuf::from);
            }
            "--timeout-ms" => {
                timeout_ms = args.next().and_then(|value| value.parse::<u64>().ok());
            }
            other => return Err(format!("Unknown argument: {other}")),
        }
    }

    let path = path.ok_or_else(|| "Missing --path".to_string())?;
    let mode = mode.ok_or_else(|| "Missing --mode".to_string())?;
    let ready_path = ready_path.ok_or_else(|| "Missing --ready".to_string())?;
    let release_path = release_path.ok_or_else(|| "Missing --release".to_string())?;
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(10_000));

    Ok(Config {
        path,
        mode,
        ready_path,
        release_path,
        timeout,
    })
}

fn main() -> Result<(), String> {
    let config = parse_args()?;

    let (file, lock) = match config.mode {
        LockMode::Shared => FileLock::open_read_only(&config.path),
        LockMode::Exclusive => FileLock::open_and_lock(&config.path),
    }
    .map_err(|e| e.to_string())?;

    fs::write(&config.ready_path, b"ready").map_err(|e| e.to_string())?;

    let start = Instant::now();
    while !config.release_path.exists() {
        if start.elapsed() > config.timeout {
            return Err("Timed out waiting for release".to_string());
        }
        thread::sleep(Duration::from_millis(25));
    }

    drop(lock);
    drop(file);
    Ok(())
}
