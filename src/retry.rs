//! Windows-aware retry utilities for transient file system errors.
//!
//! On Windows, file operations can fail transiently due to:
//! - Antivirus/Windows Defender scanning newly created files
//! - Delayed release of mmap file handles
//! - File system indexers holding brief locks
//!
//! This module provides idiomatic retry wrappers using exponential backoff.
//! On non-Windows platforms, operations execute directly without retry overhead.

use std::time::Duration;

#[cfg(windows)]
use crate::error::MemvidError;
use crate::error::Result;

/// Configuration for retry behavior.
///
/// On non-Windows platforms, fields other than `max_attempts` are unused
/// since operations execute directly without retry.
#[derive(Debug, Clone)]
#[allow(dead_code)] // Fields used only on Windows
pub struct RetryConfig {
    /// Maximum number of retry attempts (must be >= 1)
    pub max_attempts: usize,
    /// Initial delay between retries (default: 50ms)
    pub initial_delay: Duration,
    /// Maximum delay between retries (default: 1600ms)
    pub max_delay: Duration,
    /// Exponential backoff factor (default: 2.0)
    pub factor: f32,
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_attempts: 5,
            initial_delay: Duration::from_millis(50),
            max_delay: Duration::from_millis(1600),
            factor: 2.0,
        }
    }
}

impl RetryConfig {
    /// Returns retry configuration tuned for Tantivy index operations.
    ///
    /// Uses 5 attempts with 50ms-1600ms exponential backoff, which handles
    /// typical Windows Defender scanning delays (~100-500ms).
    pub fn for_tantivy() -> Self {
        Self::default()
    }
}

/// Returns true if a `MemvidError` is likely transient on Windows.
///
/// Transient errors include:
/// - Permission denied (often caused by antivirus scanning)
/// - "Access is denied" in Tantivy error messages
/// - Sharing violations and lock violations
///
/// Windows error codes detected:
/// - 5: ERROR_ACCESS_DENIED
/// - 6: ERROR_INVALID_HANDLE (can occur during mmap transitions)
/// - 32: ERROR_SHARING_VIOLATION
/// - 33: ERROR_LOCK_VIOLATION
/// - 108: ERROR_DRIVE_LOCKED
/// - 212: ERROR_LOCKED (file segment locked)
#[cfg(windows)]
fn is_transient(err: &MemvidError) -> bool {
    match err {
        MemvidError::Io { source, .. } => {
            use std::io::ErrorKind;
            // Only retry on PermissionDenied (not WouldBlock - that's for non-blocking I/O)
            source.kind() == ErrorKind::PermissionDenied
                || matches!(
                    source.raw_os_error(),
                    Some(5) | Some(6) | Some(32) | Some(33) | Some(108) | Some(212)
                )
        }
        MemvidError::Tantivy { reason } => {
            reason.contains("Access is denied")
                || reason.contains("os error 5")
                || reason.contains("os error 32")
                || reason.contains("sharing violation")
                || reason.contains("being used by another process")
        }
        _ => false,
    }
}

/// Execute an operation with retry on transient errors (Windows-only).
///
/// On non-Windows platforms, this simply executes the operation once.
///
/// # Panics
///
/// Panics in debug builds if `config.max_attempts` is 0.
#[cfg(windows)]
pub fn retry_transient<T, F>(config: RetryConfig, operation: F) -> Result<T>
where
    F: FnMut() -> Result<T>,
{
    use backon::{BlockingRetryable, ExponentialBuilder};

    debug_assert!(
        config.max_attempts > 0,
        "RetryConfig.max_attempts must be at least 1"
    );

    let backoff = ExponentialBuilder::default()
        .with_min_delay(config.initial_delay)
        .with_max_delay(config.max_delay)
        .with_factor(config.factor)
        .with_max_times(config.max_attempts);

    operation
        .retry(backoff)
        .when(|e| is_transient(e))
        .notify(|err, dur| {
            tracing::debug!(
                "Transient error, retrying after {:?}: {}",
                dur,
                err
            );
        })
        .call()
}

/// Execute an operation with retry on transient errors (Windows-only).
///
/// On non-Windows platforms, this simply executes the operation once.
///
/// # Panics
///
/// Panics in debug builds if `config.max_attempts` is 0.
#[cfg(not(windows))]
pub fn retry_transient<T, F>(config: RetryConfig, mut operation: F) -> Result<T>
where
    F: FnMut() -> Result<T>,
{
    debug_assert!(
        config.max_attempts > 0,
        "RetryConfig.max_attempts must be at least 1"
    );
    let _ = config; // Suppress unused warning (already used in debug_assert)
    operation()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::MemvidError;

    #[test]
    fn test_retry_config_defaults() {
        let config = RetryConfig::default();
        assert_eq!(config.max_attempts, 5);
        assert_eq!(config.initial_delay, Duration::from_millis(50));
        assert_eq!(config.max_delay, Duration::from_millis(1600));
    }

    #[test]
    fn test_retry_success_first_try() {
        let result = retry_transient(RetryConfig::default(), || Ok::<_, MemvidError>(42));
        assert_eq!(result.unwrap(), 42);
    }

    #[test]
    fn test_retry_permanent_error_no_retry() {
        let mut attempts = 0;
        let result = retry_transient(RetryConfig::default(), || {
            attempts += 1;
            Err::<i32, _>(MemvidError::Tantivy {
                reason: "some permanent error".into(),
            })
        });
        assert!(result.is_err());
        // Permanent errors should not trigger retries on any platform
        assert_eq!(attempts, 1);
    }

    #[cfg(windows)]
    #[test]
    fn test_retry_transient_error_retries() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let attempts = AtomicUsize::new(0);
        let config = RetryConfig {
            max_attempts: 3,
            initial_delay: Duration::from_millis(1), // Fast for testing
            max_delay: Duration::from_millis(10),
            factor: 2.0,
        };

        let result = retry_transient(config, || {
            let n = attempts.fetch_add(1, Ordering::SeqCst);
            if n < 2 {
                // Simulate transient "Access is denied" error
                Err(MemvidError::Tantivy {
                    reason: "Access is denied (os error 5)".into(),
                })
            } else {
                Ok(42)
            }
        });

        assert_eq!(result.unwrap(), 42);
        assert_eq!(attempts.load(Ordering::SeqCst), 3); // Should have taken 3 attempts
    }

    #[cfg(windows)]
    #[test]
    fn test_is_transient_detects_access_denied() {
        // Test Tantivy error with "Access is denied"
        let err = MemvidError::Tantivy {
            reason: "IOError: Access is denied (os error 5)".into(),
        };
        assert!(is_transient(&err));

        // Test Tantivy error with sharing violation
        let err = MemvidError::Tantivy {
            reason: "The process cannot access the file because it is being used by another process".into(),
        };
        assert!(is_transient(&err));

        // Test non-transient error
        let err = MemvidError::Tantivy {
            reason: "Index corrupted".into(),
        };
        assert!(!is_transient(&err));
    }
}
