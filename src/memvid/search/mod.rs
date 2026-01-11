//! Search orchestration for `Memvid`.
//!
//! The search entrypoint chooses an engine (Tantivy lexical, optional temporal filters,
//! and lex-only fallback) and returns fully decorated snippets with chunk metadata.
//! Invariants: refuses empty queries, respects cursor/limit bounds, and never mutates
//! the underlying file.

#[cfg(feature = "lex")]
use std::collections::{BTreeSet, HashSet};
#[cfg(feature = "lex")]
use std::time::Instant;

use crate::memvid::lifecycle::Memvid;
use crate::types::{FrameId, SearchEngineKind, SearchParams, SearchRequest, SearchResponse};
use crate::{MemvidError, Result};

/// Result of intersecting a new filter with an existing candidate filter.
#[cfg(feature = "lex")]
enum FilterResult {
    /// Intersection produced candidates
    Candidates(HashSet<FrameId>),
    /// Intersection was empty - should return early
    Empty,
}

/// Intersect a new set of frame IDs with an existing candidate filter.
/// Returns `FilterResult::Empty` if the result is empty (caller should return early).
#[cfg(feature = "lex")]
fn intersect_filter(existing: Option<HashSet<FrameId>>, new_ids: HashSet<FrameId>) -> FilterResult {
    match existing {
        Some(existing) => {
            let filtered: HashSet<FrameId> = existing
                .into_iter()
                .filter(|id| new_ids.contains(id))
                .collect();
            if filtered.is_empty() {
                FilterResult::Empty
            } else {
                FilterResult::Candidates(filtered)
            }
        }
        None => FilterResult::Candidates(new_ids),
    }
}

mod api;
mod builders;
#[cfg(feature = "lex")]
mod fallback;
pub(crate) mod helpers;
#[cfg(feature = "lex")]
mod tantivy;
#[cfg(any(feature = "lex", feature = "temporal_track"))]
mod time_filter;

// Re-export text indexability helpers for use in validation
pub use api::{
    DEFAULT_MAX_INDEX_PAYLOAD, is_frame_text_indexable, is_text_indexable_mime, max_index_payload,
};

#[cfg(feature = "lex")]
use fallback::{search_with_filters_only, search_with_lex_fallback};
use helpers::empty_search_response;
#[cfg(feature = "lex")]
pub use tantivy::parse_content_date_to_timestamp;
#[cfg(feature = "lex")]
use tantivy::try_tantivy_search;
#[cfg(feature = "temporal_track")]
pub use time_filter::frame_ids_for_temporal_filter;
#[cfg(feature = "lex")]
use time_filter::frame_ids_in_date_range;

#[cfg(feature = "lex")]
impl Memvid {
    pub fn search(&mut self, request: SearchRequest) -> Result<SearchResponse> {
        if !self.lex_enabled {
            return Err(MemvidError::LexNotEnabled);
        }

        let start_time = Instant::now();
        // parse_query can return structured tokens; we only keep non-empty, lower-cased terms.
        let parsed = crate::search::parse_query(&request.query)?;
        let mut query_tokens = parsed.text_tokens();
        query_tokens.retain(|token| !token.trim().is_empty());
        query_tokens = query_tokens
            .into_iter()
            .map(|token| token.to_ascii_lowercase())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        let has_text_terms = !query_tokens.is_empty();
        let has_field_terms = parsed.contains_field_terms();

        if !has_text_terms && !has_field_terms {
            return Err(MemvidError::InvalidQuery {
                reason: "query must include at least one search term or field filter".into(),
            });
        }

        let params = SearchParams {
            top_k: request.top_k,
            snippet_chars: request.snippet_chars,
            cursor: request.cursor.clone(),
        };

        // Helper closure to create empty response with current elapsed time
        let mk_empty = || {
            empty_search_response(
                request.query.clone(),
                params.clone(),
                start_time.elapsed().as_millis(),
                SearchEngineKind::Tantivy,
            )
        };

        let date_range = parsed.required_date_range();
        #[allow(unused_mut)]
        let mut candidate_filter: Option<HashSet<FrameId>> = if let Some(ref range) = date_range {
            if range.is_empty() {
                return Ok(mk_empty());
            }
            match frame_ids_in_date_range(self, range)? {
                Some(ids) if ids.is_empty() => return Ok(mk_empty()),
                Some(ids) => Some(ids.into_iter().collect()),
                None => None,
            }
        } else {
            None
        };

        #[cfg(feature = "temporal_track")]
        if let Some(ref temporal_filter) = request.temporal {
            if !temporal_filter.is_empty() {
                if let Some(ids) =
                    time_filter::frame_ids_for_temporal_filter(self, temporal_filter)?
                {
                    if ids.is_empty() {
                        return Ok(mk_empty());
                    }
                    match intersect_filter(candidate_filter, ids.into_iter().collect()) {
                        FilterResult::Empty => return Ok(mk_empty()),
                        FilterResult::Candidates(filtered) => candidate_filter = Some(filtered),
                    }
                }
            }
        }

        // REPLAY: Filter by as_of_frame or as_of_ts for time-travel views
        if request.as_of_frame.is_some() || request.as_of_ts.is_some() {
            let replay_ids = self.get_replay_frame_ids(&request)?;
            if replay_ids.is_empty() {
                return Ok(mk_empty());
            }
            match intersect_filter(candidate_filter, replay_ids.into_iter().collect()) {
                FilterResult::Empty => return Ok(mk_empty()),
                FilterResult::Candidates(filtered) => candidate_filter = Some(filtered),
            }
        }

        // MEMORY FILTER: Restrict to frames matching Memory Card criteria
        if !request.memory_filters.is_empty() {
            let memory_start = Instant::now();
            let memory_frame_ids: HashSet<FrameId> = request
                .memory_filters
                .iter()
                .flat_map(|filter| self.find_memory_cards_matching_filter(filter))
                .map(|card| card.source_frame_id)
                .collect();

            tracing::debug!(
                memory_filters = request.memory_filters.len(),
                matching_frames = memory_frame_ids.len(),
                memory_filter_time_us = memory_start.elapsed().as_micros(),
                "memory filter applied"
            );

            if memory_frame_ids.is_empty() {
                return Ok(mk_empty());
            }

            match intersect_filter(candidate_filter, memory_frame_ids) {
                FilterResult::Empty => return Ok(mk_empty()),
                FilterResult::Candidates(filtered) => candidate_filter = Some(filtered),
            }
        }

        // SKETCH PRE-FILTER: Use sketch track for fast candidate generation if available
        // This dramatically reduces the number of documents sent to BM25/Tantivy
        if self.has_sketches() && has_text_terms && !request.no_sketch {
            let sketch_start = Instant::now();
            let sketch_options = crate::SketchSearchOptions {
                // Use relaxed threshold for better recall - BM25 will rerank anyway
                hamming_threshold: 32,
                // Get more candidates than needed - BM25 will select the best
                max_candidates: (params.top_k * 10).max(500),
                min_score: 0.0,
            };
            let sketch_candidates =
                self.find_sketch_candidates(&request.query, Some(sketch_options));

            if !sketch_candidates.is_empty() {
                let sketch_set: HashSet<FrameId> =
                    sketch_candidates.iter().map(|c| c.frame_id).collect();

                tracing::debug!(
                    sketch_candidates = sketch_candidates.len(),
                    sketch_time_us = sketch_start.elapsed().as_micros(),
                    "sketch pre-filter applied"
                );

                candidate_filter = match candidate_filter {
                    Some(existing) => {
                        // Intersection: keep only IDs that pass both filters
                        let filtered: HashSet<FrameId> = existing
                            .into_iter()
                            .filter(|id| sketch_set.contains(id))
                            .collect();
                        if filtered.is_empty() {
                            // Fall back to sketch-only if intersection is empty
                            Some(sketch_set)
                        } else {
                            Some(filtered)
                        }
                    }
                    None => Some(sketch_set),
                };
            }
        }

        let mut response = if let Some(response) = try_tantivy_search(
            self,
            &parsed,
            &query_tokens,
            &request,
            &params,
            start_time,
            candidate_filter.as_ref(),
        )? {
            response
        } else {
            self.ensure_lex_index()?;
            if has_text_terms {
                search_with_lex_fallback(
                    self,
                    &parsed,
                    &query_tokens,
                    &request,
                    &params,
                    start_time,
                    candidate_filter.as_ref(),
                )?
            } else {
                search_with_filters_only(
                    self,
                    &parsed,
                    &request,
                    &params,
                    start_time,
                    candidate_filter.as_ref(),
                )?
            }
        };

        // Enrich hits with Logic-Mesh entities if mesh is available
        if self.has_logic_mesh() {
            helpers::enrich_hits_with_entities(&mut response.hits, self);
        }

        // Attach memory cards to hits if requested (avoids N+1 queries)
        if request.include_cards {
            helpers::attach_cards_to_hits(&mut response.hits, self);
        }

        // Note: exclude_frame_ids and exclude_uris are now applied at query time
        // in Tantivy (via MustNot clauses) and in fallback search (via early filtering)

        // Record the search action if a replay session is active
        #[cfg(feature = "replay")]
        {
            let result_frames: Vec<u64> = response.hits.iter().map(|h| h.frame_id).collect();
            self.record_find_action(
                &request.query,
                &format!("{:?}", response.engine),
                response.hits.len(),
                result_frames,
            );
        }

        Ok(response)
    }
}

#[cfg(not(feature = "lex"))]
impl Memvid {
    pub fn search(&mut self, _request: SearchRequest) -> Result<SearchResponse> {
        Err(MemvidError::LexNotEnabled)
    }
}
