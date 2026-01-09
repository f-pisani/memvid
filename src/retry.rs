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
#[derive(Debug, Clone)]
pub struct RetryConfig {
    /// Maximum number of retry attempts (default: 5)
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
    /// Configuration for Tantivy index operations.
    pub fn for_tantivy() -> Self {
        Self::default()
    }
}

/// Returns true if a `MemvidError` is likely transient on Windows.
///
/// Transient errors include:
/// - Permission denied (often caused by antivirus scanning)
/// - "Access is denied" in Tantivy error messages
/// - Sharing violations
#[cfg(windows)]
fn is_transient(err: &MemvidError) -> bool {
    match err {
        MemvidError::Io { source, .. } => {
            use std::io::ErrorKind;
            matches!(
                source.kind(),
                ErrorKind::PermissionDenied | ErrorKind::WouldBlock
            ) || matches!(source.raw_os_error(), Some(5) | Some(32) | Some(33))
            // 5 = ERROR_ACCESS_DENIED
            // 32 = ERROR_SHARING_VIOLATION
            // 33 = ERROR_LOCK_VIOLATION
        }
        MemvidError::Tantivy { reason } => {
            reason.contains("Access is denied")
                || reason.contains("os error 5")
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
/// # Example
/// ```ignore
/// use memvid_core::retry::{retry_transient, RetryConfig};
///
/// retry_transient(RetryConfig::for_tantivy(), || {
///     writer.commit().map_err(|e| MemvidError::Tantivy { reason: e.to_string() })
/// })?;
/// ```
#[cfg(windows)]
pub fn retry_transient<T, F>(config: RetryConfig, operation: F) -> Result<T>
where
    F: FnMut() -> Result<T>,
{
    use backon::{BlockingRetryable, ExponentialBuilder};

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
#[cfg(not(windows))]
pub fn retry_transient<T, F>(config: RetryConfig, mut operation: F) -> Result<T>
where
    F: FnMut() -> Result<T>,
{
    let _ = config; // Suppress unused warning
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
        // On Windows, permanent errors don't retry; on other platforms, only one attempt
        #[cfg(not(windows))]
        assert_eq!(attempts, 1);
    }
}
