//! Public search request/response types exposed by the core library.

use serde::{Deserialize, Serialize};

use super::common::FrameId;
#[cfg(feature = "temporal_track")]
use super::frame::AnchorSource;
use super::memory_card::MemoryKind;
#[cfg(feature = "temporal_track")]
use super::temporal::{TemporalFilter, TemporalMentionFlags, TemporalMentionKind};

/// Parameters used to page and shape search results.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchParams {
    /// Maximum hits to return.
    pub top_k: usize,
    /// Number of characters to capture around matches.
    pub snippet_chars: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Cursor token for pagination.
    pub cursor: Option<String>,
}

/// Engine selected to satisfy a search.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SearchEngineKind {
    Tantivy,
    LexFallback,
    Hybrid,
    Vec,
}

impl Default for SearchEngineKind {
    fn default() -> Self {
        Self::LexFallback
    }
}

/// Summary of a memory card for search results.
///
/// This is a lightweight representation of a `MemoryCard`, containing only the
/// essential fields needed for display in search results. Using this instead
/// of the full `MemoryCard` avoids exposing internal details and reduces payload size.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryCardSummary {
    /// The entity this memory is about (e.g., "user", "project.memvid").
    pub entity: String,
    /// The attribute/slot being described (e.g., "employer", "favorite_food").
    pub slot: String,
    /// The actual value.
    pub value: String,
    /// What kind of memory this represents.
    pub kind: MemoryKind,
}

/// Filter search results based on Memory Card criteria.
///
/// Memory Cards are structured facts (entity-slot-value triples) extracted from frames.
/// This filter restricts search to frames that have matching Memory Cards.
///
/// # Example
/// ```ignore
/// // Find frames about suspension causes
/// MemoryFilter {
///     entity: Some("suspension".into()),
///     slot: Some("cause".into()),
///     value_contains: None,  // Any cause
///     kind: None,
/// }
/// ```
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MemoryFilter {
    /// Filter by entity name (exact match, case-insensitive).
    /// Use "*" to match any entity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entity: Option<String>,

    /// Filter by slot/attribute name (exact match, case-insensitive).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slot: Option<String>,

    /// Filter by value (substring match, case-insensitive).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value_contains: Option<String>,

    /// Filter by memory kind (Fact, Preference, Event, etc.).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<MemoryKind>,
}

impl MemoryFilter {
    /// Create an empty filter that matches ALL memory cards.
    ///
    /// Useful when you want to filter search results to only include
    /// frames that have at least one memory card, regardless of content.
    ///
    /// # Example
    /// ```ignore
    /// // Find only frames that have any memory card attached
    /// let filter = MemoryFilter::all();
    /// ```
    #[must_use]
    pub fn all() -> Self {
        Self::default()
    }

    /// Create a new filter for a specific entity.
    #[must_use]
    pub fn entity(entity: impl Into<String>) -> Self {
        Self {
            entity: Some(entity.into()),
            ..Default::default()
        }
    }

    /// Create a new filter for a specific slot across all entities.
    #[must_use]
    pub fn slot(slot: impl Into<String>) -> Self {
        Self {
            slot: Some(slot.into()),
            ..Default::default()
        }
    }

    /// Create a filter for entity + slot combination.
    #[must_use]
    pub fn entity_slot(entity: impl Into<String>, slot: impl Into<String>) -> Self {
        Self {
            entity: Some(entity.into()),
            slot: Some(slot.into()),
            ..Default::default()
        }
    }

    /// Add a value substring filter.
    #[must_use]
    pub fn with_value(mut self, value: impl Into<String>) -> Self {
        self.value_contains = Some(value.into());
        self
    }

    /// Add a kind filter.
    #[must_use]
    pub fn with_kind(mut self, kind: MemoryKind) -> Self {
        self.kind = Some(kind);
        self
    }

    /// Check if a memory card matches this filter.
    ///
    /// All specified criteria must match (AND logic).
    /// Unspecified criteria (None) match everything.
    #[must_use]
    pub fn matches(&self, card: &super::memory_card::MemoryCard) -> bool {
        // Entity filter: "*" matches all, otherwise case-insensitive match
        if let Some(ref entity) = self.entity {
            if entity != "*" && !card.entity.eq_ignore_ascii_case(entity) {
                return false;
            }
        }

        // Slot filter: case-insensitive match
        if let Some(ref slot) = self.slot {
            if !card.slot.eq_ignore_ascii_case(slot) {
                return false;
            }
        }

        // Value filter: case-insensitive substring match
        if let Some(ref value) = self.value_contains {
            if !card
                .value
                .to_ascii_lowercase()
                .contains(&value.to_ascii_lowercase())
            {
                return false;
            }
        }

        // Kind filter: exact match
        if let Some(ref kind) = self.kind {
            if card.kind != *kind {
                return false;
            }
        }

        true
    }
}

/// Search request accepted by the core; supports lexical, hybrid, and temporal filters.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SearchRequest {
    /// Query string (lexical or semantic depending on engine).
    pub query: String,
    /// Maximum hits to return.
    pub top_k: usize,
    /// Number of characters to capture around matches.
    pub snippet_chars: usize,
    #[serde(default)]
    /// Restrict search to a specific URI.
    pub uri: Option<String>,
    #[serde(default)]
    /// Restrict search to a named scope/collection.
    pub scope: Option<String>,
    #[serde(default)]
    /// Pagination cursor.
    pub cursor: Option<String>,
    #[cfg(feature = "temporal_track")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temporal: Option<TemporalFilter>,
    #[serde(default)]
    /// Replay: Filter to frames with id <= as_of_frame (time-travel view).
    pub as_of_frame: Option<FrameId>,
    #[serde(default)]
    /// Replay: Filter to frames with timestamp <= as_of_ts (time-travel view).
    pub as_of_ts: Option<i64>,
    #[serde(default)]
    /// Disable sketch pre-filtering for this query.
    pub no_sketch: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    /// Exclude specific frame IDs from results.
    pub exclude_frame_ids: Vec<FrameId>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    /// Exclude frames matching these URIs from results.
    pub exclude_uris: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    /// Filter to frames matching these Memory Card criteria.
    /// Multiple filters are combined with OR (any match includes the frame).
    /// Applied at query time - only matching frames are searched.
    pub memory_filters: Vec<MemoryFilter>,
    #[serde(default)]
    /// Include memory cards in search results.
    /// When true, each hit will include associated memory cards, avoiding N+1 queries.
    pub include_cards: bool,
}

/// A single ranked hit with snippet metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    pub rank: usize,
    pub frame_id: FrameId,
    pub uri: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub range: (usize, usize),
    pub text: String,
    pub matches: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chunk_range: Option<(usize, usize)>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chunk_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub score: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<SearchHitMetadata>,
    /// Memory cards associated with this frame (populated when include_cards is requested).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cards: Vec<MemoryCardSummary>,
}

/// Entity reference in search hit metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHitEntity {
    /// Entity display name.
    pub name: String,
    /// Entity kind (person, organization, etc.).
    pub kind: String,
    /// Confidence score (0.0-1.0).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f32>,
}

/// Optional per-hit metadata (tags, labels, dates, temporal context).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SearchHitMetadata {
    #[serde(default)]
    pub matches: usize,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub labels: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub track: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub content_dates: Vec<String>,
    /// Entities mentioned in this search hit (from Logic-Mesh).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub entities: Vec<SearchHitEntity>,
    #[cfg(feature = "temporal_track")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temporal: Option<SearchHitTemporal>,
}

#[cfg(feature = "temporal_track")]
/// Temporal annotations attached to a hit when temporal tracking is enabled.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SearchHitTemporal {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor: Option<SearchHitTemporalAnchor>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mentions: Vec<SearchHitTemporalMention>,
}

#[cfg(feature = "temporal_track")]
/// Anchor timestamp for a temporal hit (absolute and ISO strings).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHitTemporalAnchor {
    pub ts_utc: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub iso_8601: Option<String>,
    pub source: AnchorSource,
}

#[cfg(feature = "temporal_track")]
/// Temporal mention (range or instant) extracted from the document.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHitTemporalMention {
    pub ts_utc: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub iso_8601: Option<String>,
    pub kind: TemporalMentionKind,
    pub confidence: u16,
    pub flags: TemporalMentionFlags,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    pub byte_start: u32,
    pub byte_len: u32,
}

/// Full search response with hits, params, engine, and an optional cursor.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResponse {
    /// Query echoed back for clients.
    pub query: String,
    /// Milliseconds spent satisfying the request.
    pub elapsed_ms: u128,
    /// Total hits found (without pagination applied).
    pub total_hits: usize,
    /// Parameters used for this request, including cursors.
    pub params: SearchParams,
    /// Ranked hits.
    pub hits: Vec<SearchHit>,
    /// Concatenated snippets or context paragraphs.
    pub context: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Cursor for fetching the next page, if any.
    pub next_cursor: Option<String>,
    #[serde(default)]
    /// Engine responsible for the results.
    pub engine: SearchEngineKind,
}
