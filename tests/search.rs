//! Integration tests for Memvid search operations.
//! Tests: search (lex), timeline queries

use memvid_core::{Memvid, PutOptions, SearchRequest, TimelineQuery};
use std::num::NonZeroU64;
use tempfile::TempDir;

/// Helper to create a memory with searchable content.
fn create_searchable_memory(path: &std::path::Path) {
    let mut mem = Memvid::create(path).unwrap();
    mem.enable_lex().unwrap();

    let docs = vec![
        (
            "mv2://physics/quantum",
            "Quantum Physics",
            "Quantum mechanics describes the behavior of particles at the atomic scale",
        ),
        (
            "mv2://physics/classical",
            "Classical Mechanics",
            "Classical mechanics describes motion of macroscopic objects",
        ),
        (
            "mv2://biology/cells",
            "Cell Biology",
            "Cells are the basic building blocks of all living organisms",
        ),
        (
            "mv2://chemistry/atoms",
            "Atomic Chemistry",
            "Atoms combine to form molecules through chemical bonds",
        ),
        (
            "mv2://math/calculus",
            "Calculus",
            "Calculus studies continuous change and rates of change",
        ),
    ];

    for (uri, title, content) in docs {
        let opts = PutOptions {
            uri: Some(uri.to_string()),
            title: Some(title.to_string()),
            search_text: Some(content.to_string()),
            timestamp: Some(1700000000),
            ..Default::default()
        };
        mem.put_bytes_with_options(content.as_bytes(), opts)
            .unwrap();
    }

    mem.commit().unwrap();
}

/// Test basic lexical search.
#[test]
#[cfg(feature = "lex")]
fn search_basic_query() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("test.mv2");

    create_searchable_memory(&path);

    let mut mem = Memvid::open_read_only(&path).unwrap();
    let results = mem
        .search(SearchRequest {
            query: "quantum".to_string(),
            top_k: 10,
            snippet_chars: 200,
            uri: None,
            scope: None,
            cursor: None,
            #[cfg(feature = "temporal_track")]
            temporal: None,
            as_of_frame: None,
            as_of_ts: None,
            no_sketch: false,
            ..Default::default()
        })
        .unwrap();

    assert!(results.hits.len() > 0, "Should find quantum document");
    assert!(
        results.hits[0].uri.contains("quantum"),
        "Top result should be quantum physics"
    );
}

/// Test search with multiple results.
#[test]
#[cfg(feature = "lex")]
fn search_multiple_results() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("test.mv2");

    create_searchable_memory(&path);

    let mut mem = Memvid::open_read_only(&path).unwrap();

    // Search for "mechanics" should find both quantum and classical
    let results = mem
        .search(SearchRequest {
            query: "mechanics".to_string(),
            top_k: 10,
            snippet_chars: 200,
            uri: None,
            scope: None,
            cursor: None,
            #[cfg(feature = "temporal_track")]
            temporal: None,
            as_of_frame: None,
            as_of_ts: None,
            no_sketch: false,
            ..Default::default()
        })
        .unwrap();

    assert_eq!(
        results.hits.len(),
        2,
        "Should find both mechanics documents"
    );
}

/// Test search with top_k limit.
#[test]
#[cfg(feature = "lex")]
fn search_respects_top_k() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("test.mv2");

    // Create memory with many documents
    {
        let mut mem = Memvid::create(&path).unwrap();
        mem.enable_lex().unwrap();

        for i in 0..20 {
            let opts = PutOptions {
                uri: Some(format!("mv2://doc{}", i)),
                title: Some(format!("Document {}", i)),
                search_text: Some(format!(
                    "This document contains searchable content number {}",
                    i
                )),
                ..Default::default()
            };
            mem.put_bytes_with_options(format!("Content {}", i).as_bytes(), opts)
                .unwrap();
        }
        mem.commit().unwrap();
    }

    let mut mem = Memvid::open_read_only(&path).unwrap();
    let results = mem
        .search(SearchRequest {
            query: "document".to_string(),
            top_k: 5,
            snippet_chars: 200,
            uri: None,
            scope: None,
            cursor: None,
            #[cfg(feature = "temporal_track")]
            temporal: None,
            as_of_frame: None,
            as_of_ts: None,
            no_sketch: false,
            ..Default::default()
        })
        .unwrap();

    assert_eq!(results.hits.len(), 5, "Should return exactly top_k results");
}

/// Test search with scope filter.
#[test]
#[cfg(feature = "lex")]
fn search_with_scope() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("test.mv2");

    create_searchable_memory(&path);

    let mut mem = Memvid::open_read_only(&path).unwrap();

    // Search only in physics scope
    let results = mem
        .search(SearchRequest {
            query: "mechanics".to_string(),
            top_k: 10,
            snippet_chars: 200,
            uri: None,
            scope: Some("mv2://physics/".to_string()),
            cursor: None,
            #[cfg(feature = "temporal_track")]
            temporal: None,
            as_of_frame: None,
            as_of_ts: None,
            no_sketch: false,
            ..Default::default()
        })
        .unwrap();

    // All results should be from physics scope
    for hit in &results.hits {
        assert!(
            hit.uri.starts_with("mv2://physics/"),
            "Results should be from physics scope"
        );
    }
}

/// Test search returns snippets.
#[test]
#[cfg(feature = "lex")]
fn search_returns_snippets() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("test.mv2");

    create_searchable_memory(&path);

    let mut mem = Memvid::open_read_only(&path).unwrap();
    let results = mem
        .search(SearchRequest {
            query: "quantum".to_string(),
            top_k: 10,
            snippet_chars: 200,
            uri: None,
            scope: None,
            cursor: None,
            #[cfg(feature = "temporal_track")]
            temporal: None,
            as_of_frame: None,
            as_of_ts: None,
            no_sketch: false,
            ..Default::default()
        })
        .unwrap();

    assert!(results.hits.len() > 0);
    let hit = &results.hits[0];

    // Snippet should contain matched content
    assert!(!hit.text.is_empty(), "Hit should include text snippet");
}

/// Test search with no results.
#[test]
#[cfg(feature = "lex")]
fn search_no_results() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("test.mv2");

    create_searchable_memory(&path);

    let mut mem = Memvid::open_read_only(&path).unwrap();
    let results = mem
        .search(SearchRequest {
            query: "xyznonexistentterm".to_string(),
            top_k: 10,
            snippet_chars: 200,
            uri: None,
            scope: None,
            cursor: None,
            #[cfg(feature = "temporal_track")]
            temporal: None,
            as_of_frame: None,
            as_of_ts: None,
            no_sketch: false,
            ..Default::default()
        })
        .unwrap();

    assert_eq!(results.hits.len(), 0, "Should return no results");
}

/// Test search on empty memory.
#[test]
#[cfg(feature = "lex")]
fn search_empty_memory() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("test.mv2");

    {
        let mut mem = Memvid::create(&path).unwrap();
        mem.enable_lex().unwrap();
        mem.commit().unwrap();
    }

    let mut mem = Memvid::open_read_only(&path).unwrap();
    let results = mem
        .search(SearchRequest {
            query: "anything".to_string(),
            top_k: 10,
            snippet_chars: 200,
            uri: None,
            scope: None,
            cursor: None,
            #[cfg(feature = "temporal_track")]
            temporal: None,
            as_of_frame: None,
            as_of_ts: None,
            no_sketch: false,
            ..Default::default()
        })
        .unwrap();

    assert_eq!(
        results.hits.len(),
        0,
        "Empty memory should return no results"
    );
}

/// Test timeline query returns ordered results.
#[test]
fn timeline_returns_ordered() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("test.mv2");

    {
        let mut mem = Memvid::create(&path).unwrap();

        // Add frames with different timestamps
        let timestamps = [1700000000i64, 1700003000, 1700001000, 1700002000];

        for (i, ts) in timestamps.iter().enumerate() {
            let opts = PutOptions {
                uri: Some(format!("mv2://doc{}", i)),
                title: Some(format!("Document {}", i)),
                timestamp: Some(*ts),
                ..Default::default()
            };
            mem.put_bytes_with_options(format!("Content {}", i).as_bytes(), opts)
                .unwrap();
        }
        mem.commit().unwrap();
    }

    let mut mem = Memvid::open_read_only(&path).unwrap();
    let query = TimelineQuery::builder()
        .limit(NonZeroU64::new(10).unwrap())
        .build();
    let entries = mem.timeline(query).unwrap();

    // Verify timeline is ordered by timestamp (either ascending or descending)
    if entries.len() > 1 {
        let is_descending = entries[0].timestamp >= entries[1].timestamp;
        for i in 1..entries.len() {
            if is_descending {
                assert!(
                    entries[i - 1].timestamp >= entries[i].timestamp,
                    "Timeline should be consistently ordered (descending)"
                );
            } else {
                assert!(
                    entries[i - 1].timestamp <= entries[i].timestamp,
                    "Timeline should be consistently ordered (ascending)"
                );
            }
        }
    }
}

/// Test timeline with since filter.
#[test]
fn timeline_with_since_filter() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("test.mv2");

    {
        let mut mem = Memvid::create(&path).unwrap();

        let timestamps = [1700000000i64, 1700001000, 1700002000, 1700003000];

        for (i, ts) in timestamps.iter().enumerate() {
            let opts = PutOptions {
                uri: Some(format!("mv2://doc{}", i)),
                timestamp: Some(*ts),
                ..Default::default()
            };
            mem.put_bytes_with_options(format!("Content {}", i).as_bytes(), opts)
                .unwrap();
        }
        mem.commit().unwrap();
    }

    let mut mem = Memvid::open_read_only(&path).unwrap();

    // Get entries since 1700001500
    let query = TimelineQuery::builder()
        .limit(NonZeroU64::new(10).unwrap())
        .since(1700001500)
        .build();
    let entries = mem.timeline(query).unwrap();

    for entry in &entries {
        assert!(
            entry.timestamp >= 1700001500,
            "All entries should be >= since timestamp"
        );
    }
}

/// Test timeline with until filter.
#[test]
fn timeline_with_until_filter() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("test.mv2");

    {
        let mut mem = Memvid::create(&path).unwrap();

        let timestamps = [1700000000i64, 1700001000, 1700002000, 1700003000];

        for (i, ts) in timestamps.iter().enumerate() {
            let opts = PutOptions {
                uri: Some(format!("mv2://doc{}", i)),
                timestamp: Some(*ts),
                ..Default::default()
            };
            mem.put_bytes_with_options(format!("Content {}", i).as_bytes(), opts)
                .unwrap();
        }
        mem.commit().unwrap();
    }

    let mut mem = Memvid::open_read_only(&path).unwrap();

    // Get entries until 1700001500
    let query = TimelineQuery::builder()
        .limit(NonZeroU64::new(10).unwrap())
        .until(1700001500)
        .build();
    let entries = mem.timeline(query).unwrap();

    for entry in &entries {
        assert!(
            entry.timestamp <= 1700001500,
            "All entries should be <= until timestamp"
        );
    }
}

/// Test timeline respects limit.
#[test]
fn timeline_respects_limit() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("test.mv2");

    {
        let mut mem = Memvid::create(&path).unwrap();

        for i in 0..20 {
            let opts = PutOptions {
                uri: Some(format!("mv2://doc{}", i)),
                timestamp: Some(1700000000 + i as i64 * 1000),
                ..Default::default()
            };
            mem.put_bytes_with_options(format!("Content {}", i).as_bytes(), opts)
                .unwrap();
        }
        mem.commit().unwrap();
    }

    let mut mem = Memvid::open_read_only(&path).unwrap();
    let query = TimelineQuery::builder()
        .limit(NonZeroU64::new(5).unwrap())
        .build();
    let entries = mem.timeline(query).unwrap();

    assert_eq!(
        entries.len(),
        5,
        "Timeline should return exactly limit entries"
    );
}

/// Test search with exclude_frame_ids filter.
#[test]
#[cfg(feature = "lex")]
fn search_exclude_frame_ids() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("test.mv2");

    create_searchable_memory(&path);

    let mut mem = Memvid::open_read_only(&path).unwrap();

    // First search without exclusion to find frame IDs
    let results = mem
        .search(SearchRequest {
            query: "mechanics".to_string(),
            top_k: 10,
            snippet_chars: 200,
            ..Default::default()
        })
        .unwrap();

    assert!(
        results.hits.len() >= 2,
        "Should find at least 2 mechanics docs"
    );
    let first_frame_id = results.hits[0].frame_id;

    // Now exclude the first result
    let filtered_results = mem
        .search(SearchRequest {
            query: "mechanics".to_string(),
            top_k: 10,
            snippet_chars: 200,
            exclude_frame_ids: vec![first_frame_id],
            ..Default::default()
        })
        .unwrap();

    // Should have one fewer result and not contain the excluded frame
    assert!(
        filtered_results.hits.len() < results.hits.len(),
        "Filtered results should have fewer hits"
    );
    assert!(
        !filtered_results
            .hits
            .iter()
            .any(|h| h.frame_id == first_frame_id),
        "Excluded frame ID should not appear in results"
    );
}

/// Test search with exclude_uris filter.
#[test]
#[cfg(feature = "lex")]
fn search_exclude_uris() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("test.mv2");

    create_searchable_memory(&path);

    let mut mem = Memvid::open_read_only(&path).unwrap();

    // Search for physics docs
    let results = mem
        .search(SearchRequest {
            query: "mechanics".to_string(),
            top_k: 10,
            snippet_chars: 200,
            ..Default::default()
        })
        .unwrap();

    assert!(results.hits.len() >= 2, "Should find mechanics docs");

    // Exclude quantum physics by URI
    let filtered_results = mem
        .search(SearchRequest {
            query: "mechanics".to_string(),
            top_k: 10,
            snippet_chars: 200,
            exclude_uris: vec!["mv2://physics/quantum".to_string()],
            ..Default::default()
        })
        .unwrap();

    // Should not contain the excluded URI
    assert!(
        !filtered_results
            .hits
            .iter()
            .any(|h| h.uri == "mv2://physics/quantum"),
        "Excluded URI should not appear in results"
    );
}

/// Test search with both exclude_frame_ids and exclude_uris.
#[test]
#[cfg(feature = "lex")]
fn search_exclude_combined() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("test.mv2");

    create_searchable_memory(&path);

    let mut mem = Memvid::open_read_only(&path).unwrap();

    // Get all results first
    let all_results = mem
        .search(SearchRequest {
            query: "the".to_string(), // Common word to get multiple results
            top_k: 10,
            snippet_chars: 200,
            ..Default::default()
        })
        .unwrap();

    assert!(all_results.hits.len() >= 2, "Should find multiple docs");

    let first_id = all_results.hits[0].frame_id;
    let second_uri = all_results.hits[1].uri.clone();

    // Exclude by both frame ID and URI
    let filtered = mem
        .search(SearchRequest {
            query: "the".to_string(),
            top_k: 10,
            snippet_chars: 200,
            exclude_frame_ids: vec![first_id],
            exclude_uris: vec![second_uri.clone()],
            ..Default::default()
        })
        .unwrap();

    assert!(
        !filtered.hits.iter().any(|h| h.frame_id == first_id),
        "Excluded frame ID should not appear"
    );
    assert!(
        !filtered.hits.iter().any(|h| h.uri == second_uri),
        "Excluded URI should not appear"
    );
}

// ============================================================================
// Memory Filter Integration Tests
// ============================================================================

use memvid_core::{MemoryCardBuilder, MemoryFilter, MemoryKind};

/// Test search with memory_filters by entity.
#[test]
#[cfg(feature = "lex")]
fn search_memory_filter_by_entity() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("test.mv2");

    {
        let mut mem = Memvid::create(&path).unwrap();
        mem.enable_lex().unwrap();

        // Create frames about different programming languages
        let opts_rust = PutOptions {
            uri: Some("mv2://lang/rust".to_string()),
            search_text: Some(
                "Rust is a systems programming language focused on safety".to_string(),
            ),
            ..Default::default()
        };
        mem.put_bytes_with_options(b"Rust programming", opts_rust)
            .unwrap();

        let opts_python = PutOptions {
            uri: Some("mv2://lang/python".to_string()),
            search_text: Some("Python is great for machine learning and data science".to_string()),
            ..Default::default()
        };
        mem.put_bytes_with_options(b"Python programming", opts_python)
            .unwrap();

        let opts_go = PutOptions {
            uri: Some("mv2://lang/go".to_string()),
            search_text: Some(
                "Go is designed for concurrent programming and simplicity".to_string(),
            ),
            ..Default::default()
        };
        mem.put_bytes_with_options(b"Go programming", opts_go)
            .unwrap();

        // Add memory cards linking frames to entities
        let card_rust = MemoryCardBuilder::new()
            .fact()
            .entity("rust")
            .slot("category")
            .value("systems")
            .source(0, Some("mv2://lang/rust".to_string()))
            .engine("test", "1.0")
            .build(0)
            .unwrap();
        mem.put_memory_card(card_rust).unwrap();

        let card_python = MemoryCardBuilder::new()
            .fact()
            .entity("python")
            .slot("category")
            .value("scripting")
            .source(1, Some("mv2://lang/python".to_string()))
            .engine("test", "1.0")
            .build(1)
            .unwrap();
        mem.put_memory_card(card_python).unwrap();

        mem.commit().unwrap();
    }

    let mut mem = Memvid::open(&path).unwrap();

    // Search without filter - should find all programming docs
    let all_results = mem
        .search(SearchRequest {
            query: "programming".to_string(),
            top_k: 10,
            snippet_chars: 200,
            ..Default::default()
        })
        .unwrap();
    assert!(all_results.hits.len() >= 2, "Should find multiple docs");

    // Search with entity filter - only rust
    let rust_results = mem
        .search(SearchRequest {
            query: "programming".to_string(),
            top_k: 10,
            snippet_chars: 200,
            memory_filters: vec![MemoryFilter::entity("rust")],
            ..Default::default()
        })
        .unwrap();

    assert_eq!(rust_results.hits.len(), 1, "Should find only rust doc");
    assert_eq!(rust_results.hits[0].uri, "mv2://lang/rust");
}

/// Test search with memory_filters by slot.
#[test]
#[cfg(feature = "lex")]
fn search_memory_filter_by_slot() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("test.mv2");

    {
        let mut mem = Memvid::create(&path).unwrap();
        mem.enable_lex().unwrap();

        // Create frames
        let opts1 = PutOptions {
            uri: Some("mv2://doc/1".to_string()),
            search_text: Some("Document about artificial intelligence".to_string()),
            ..Default::default()
        };
        mem.put_bytes_with_options(b"AI doc", opts1).unwrap();

        let opts2 = PutOptions {
            uri: Some("mv2://doc/2".to_string()),
            search_text: Some("Document about artificial neural networks".to_string()),
            ..Default::default()
        };
        mem.put_bytes_with_options(b"Neural doc", opts2).unwrap();

        // Add memory cards with different slots
        let card1 = MemoryCardBuilder::new()
            .fact()
            .entity("topic")
            .slot("field")
            .value("AI")
            .source(0, None)
            .engine("test", "1.0")
            .build(0)
            .unwrap();
        mem.put_memory_card(card1).unwrap();

        let card2 = MemoryCardBuilder::new()
            .fact()
            .entity("topic")
            .slot("technique")
            .value("neural networks")
            .source(1, None)
            .engine("test", "1.0")
            .build(1)
            .unwrap();
        mem.put_memory_card(card2).unwrap();

        mem.commit().unwrap();
    }

    let mut mem = Memvid::open(&path).unwrap();

    // Filter by slot "field"
    let results = mem
        .search(SearchRequest {
            query: "artificial".to_string(),
            top_k: 10,
            snippet_chars: 200,
            memory_filters: vec![MemoryFilter::slot("field")],
            ..Default::default()
        })
        .unwrap();

    assert_eq!(
        results.hits.len(),
        1,
        "Should find only doc with 'field' slot"
    );
    assert_eq!(results.hits[0].uri, "mv2://doc/1");
}

/// Test search with memory_filters OR behavior (multiple filters).
#[test]
#[cfg(feature = "lex")]
fn search_memory_filter_or_behavior() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("test.mv2");

    {
        let mut mem = Memvid::create(&path).unwrap();
        mem.enable_lex().unwrap();

        // Create 3 frames
        for (i, lang) in ["rust", "python", "go"].iter().enumerate() {
            let opts = PutOptions {
                uri: Some(format!("mv2://lang/{}", lang)),
                search_text: Some(format!("{} is a programming language", lang)),
                ..Default::default()
            };
            mem.put_bytes_with_options(format!("{} code", lang).as_bytes(), opts)
                .unwrap();

            let card = MemoryCardBuilder::new()
                .fact()
                .entity(lang.to_string())
                .slot("type")
                .value("language")
                .source(i as u64, None)
                .engine("test", "1.0")
                .build(i as u64)
                .unwrap();
            mem.put_memory_card(card).unwrap();
        }

        mem.commit().unwrap();
    }

    let mut mem = Memvid::open(&path).unwrap();

    // Search with OR across multiple entity filters
    let results = mem
        .search(SearchRequest {
            query: "programming".to_string(),
            top_k: 10,
            snippet_chars: 200,
            memory_filters: vec![MemoryFilter::entity("rust"), MemoryFilter::entity("python")],
            ..Default::default()
        })
        .unwrap();

    assert_eq!(
        results.hits.len(),
        2,
        "Should find rust and python (OR behavior)"
    );
    let uris: Vec<_> = results.hits.iter().map(|h| h.uri.as_str()).collect();
    assert!(uris.contains(&"mv2://lang/rust"), "Should contain rust");
    assert!(uris.contains(&"mv2://lang/python"), "Should contain python");
    assert!(!uris.contains(&"mv2://lang/go"), "Should not contain go");
}

/// Test search with memory_filters no matches returns empty.
#[test]
#[cfg(feature = "lex")]
fn search_memory_filter_no_matches() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("test.mv2");

    {
        let mut mem = Memvid::create(&path).unwrap();
        mem.enable_lex().unwrap();

        let opts = PutOptions {
            uri: Some("mv2://doc/1".to_string()),
            search_text: Some("Document about programming".to_string()),
            ..Default::default()
        };
        mem.put_bytes_with_options(b"Doc", opts).unwrap();

        // Add a memory card
        let card = MemoryCardBuilder::new()
            .fact()
            .entity("existing")
            .slot("topic")
            .value("code")
            .source(0, None)
            .engine("test", "1.0")
            .build(0)
            .unwrap();
        mem.put_memory_card(card).unwrap();

        mem.commit().unwrap();
    }

    let mut mem = Memvid::open(&path).unwrap();

    // Filter by non-existent entity
    let results = mem
        .search(SearchRequest {
            query: "programming".to_string(),
            top_k: 10,
            snippet_chars: 200,
            memory_filters: vec![MemoryFilter::entity("nonexistent")],
            ..Default::default()
        })
        .unwrap();

    assert_eq!(
        results.hits.len(),
        0,
        "Should return empty when no memory cards match"
    );
}

/// Test search with memory_filters by kind.
#[test]
#[cfg(feature = "lex")]
fn search_memory_filter_by_kind() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("test.mv2");

    {
        let mut mem = Memvid::create(&path).unwrap();
        mem.enable_lex().unwrap();

        // Create two frames
        let opts1 = PutOptions {
            uri: Some("mv2://doc/fact".to_string()),
            search_text: Some("Document with fact about programming".to_string()),
            ..Default::default()
        };
        mem.put_bytes_with_options(b"Fact doc", opts1).unwrap();

        let opts2 = PutOptions {
            uri: Some("mv2://doc/preference".to_string()),
            search_text: Some("Document with preference about programming".to_string()),
            ..Default::default()
        };
        mem.put_bytes_with_options(b"Pref doc", opts2).unwrap();

        // Add memory cards with different kinds
        let card1 = MemoryCardBuilder::new()
            .fact() // Kind::Fact
            .entity("user")
            .slot("topic")
            .value("coding")
            .source(0, None)
            .engine("test", "1.0")
            .build(0)
            .unwrap();
        mem.put_memory_card(card1).unwrap();

        let card2 = MemoryCardBuilder::new()
            .preference() // Kind::Preference
            .entity("user")
            .slot("likes")
            .value("coding")
            .source(1, None)
            .engine("test", "1.0")
            .build(1)
            .unwrap();
        mem.put_memory_card(card2).unwrap();

        mem.commit().unwrap();
    }

    let mut mem = Memvid::open(&path).unwrap();

    // Filter by kind Fact
    let fact_results = mem
        .search(SearchRequest {
            query: "programming".to_string(),
            top_k: 10,
            snippet_chars: 200,
            memory_filters: vec![MemoryFilter::default().with_kind(MemoryKind::Fact)],
            ..Default::default()
        })
        .unwrap();

    assert_eq!(fact_results.hits.len(), 1, "Should find only fact doc");
    assert_eq!(fact_results.hits[0].uri, "mv2://doc/fact");

    // Filter by kind Preference
    let pref_results = mem
        .search(SearchRequest {
            query: "programming".to_string(),
            top_k: 10,
            snippet_chars: 200,
            memory_filters: vec![MemoryFilter::default().with_kind(MemoryKind::Preference)],
            ..Default::default()
        })
        .unwrap();

    assert_eq!(
        pref_results.hits.len(),
        1,
        "Should find only preference doc"
    );
    assert_eq!(pref_results.hits[0].uri, "mv2://doc/preference");
}

/// Test search with empty memory_filter (matches all cards).
#[test]
#[cfg(feature = "lex")]
fn search_memory_filter_empty_matches_all() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("test.mv2");

    {
        let mut mem = Memvid::create(&path).unwrap();
        mem.enable_lex().unwrap();

        // Create frames with and without memory cards
        let opts1 = PutOptions {
            uri: Some("mv2://doc/with-card".to_string()),
            search_text: Some("Document with memory card about programming".to_string()),
            ..Default::default()
        };
        mem.put_bytes_with_options(b"With card", opts1).unwrap();

        let opts2 = PutOptions {
            uri: Some("mv2://doc/no-card".to_string()),
            search_text: Some("Document without memory card about programming".to_string()),
            ..Default::default()
        };
        mem.put_bytes_with_options(b"No card", opts2).unwrap();

        // Only add memory card to first frame
        let card = MemoryCardBuilder::new()
            .fact()
            .entity("test")
            .slot("has_card")
            .value("yes")
            .source(0, None)
            .engine("test", "1.0")
            .build(0)
            .unwrap();
        mem.put_memory_card(card).unwrap();

        mem.commit().unwrap();
    }

    let mut mem = Memvid::open(&path).unwrap();

    // An empty MemoryFilter (all fields None) matches ALL memory cards,
    // so only frames with at least one memory card are returned
    let results = mem
        .search(SearchRequest {
            query: "programming".to_string(),
            top_k: 10,
            snippet_chars: 200,
            memory_filters: vec![MemoryFilter::all()], // Empty filter
            ..Default::default()
        })
        .unwrap();

    // Should only find the frame that has a memory card
    assert_eq!(
        results.hits.len(),
        1,
        "Empty filter should match frames with any card"
    );
    assert_eq!(results.hits[0].uri, "mv2://doc/with-card");
}
