use blake3::hash;
use serde::{Deserialize, Serialize};

use crate::{MemvidError, Result, types::FrameId};

fn vec_config() -> impl bincode::config::Config {
    bincode::config::standard()
        .with_fixed_int_encoding()
        .with_little_endian()
}

const VEC_DECODE_LIMIT: usize = crate::MAX_INDEX_BYTES as usize;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VecDocument {
    pub frame_id: FrameId,
    pub embedding: Vec<f32>,
}

#[derive(Default)]
pub struct VecIndexBuilder {
    documents: Vec<VecDocument>,
}

impl VecIndexBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_document<I>(&mut self, frame_id: FrameId, embedding: I)
    where
        I: Into<Vec<f32>>,
    {
        self.documents.push(VecDocument {
            frame_id,
            embedding: embedding.into(),
        });
    }

    pub fn finish(self) -> Result<VecIndexArtifact> {
        let bytes = bincode::serde::encode_to_vec(&self.documents, vec_config())?;

        let checksum = *hash(&bytes).as_bytes();
        let dimension = self
            .documents
            .first()
            .map(|doc| doc.embedding.len() as u32)
            .unwrap_or(0);
        #[cfg(feature = "parallel_segments")]
        let bytes_uncompressed = self
            .documents
            .iter()
            .map(|doc| doc.embedding.len() * std::mem::size_of::<f32>())
            .sum::<usize>() as u64;
        Ok(VecIndexArtifact {
            bytes,
            vector_count: self.documents.len() as u64,
            dimension,
            checksum,
            #[cfg(feature = "parallel_segments")]
            bytes_uncompressed,
        })
    }
}

#[derive(Debug, Clone)]
pub struct VecIndexArtifact {
    pub bytes: Vec<u8>,
    pub vector_count: u64,
    pub dimension: u32,
    pub checksum: [u8; 32],
    #[cfg(feature = "parallel_segments")]
    pub bytes_uncompressed: u64,
}

#[derive(Debug, Clone)]
pub enum VecIndex {
    Uncompressed { documents: Vec<VecDocument> },
    Compressed(crate::vec_pq::QuantizedVecIndex),
}

impl VecIndex {
    /// Decode vector index from bytes
    /// For backward compatibility, defaults to uncompressed if no manifest provided
    pub fn decode(bytes: &[u8]) -> Result<Self> {
        Self::decode_with_compression(bytes, crate::VectorCompression::None)
    }

    /// Decode vector index with compression mode from manifest
    ///
    /// ALWAYS tries uncompressed format first, regardless of compression flag.
    /// This is necessary because MIN_VECTORS_FOR_PQ threshold (100 vectors)
    /// causes most segments to be stored as uncompressed even when Pq96 is requested.
    /// Falls back to PQ format for true compressed segments.
    pub fn decode_with_compression(
        bytes: &[u8],
        _compression: crate::VectorCompression,
    ) -> Result<Self> {
        // Try uncompressed format first, regardless of compression flag.
        // This is necessary because MIN_VECTORS_FOR_PQ threshold (100 vectors)
        // causes most segments to be stored as uncompressed even when Pq96 is requested.
        match bincode::serde::decode_from_slice::<Vec<VecDocument>, _>(
            bytes,
            bincode::config::standard()
                .with_fixed_int_encoding()
                .with_little_endian()
                .with_limit::<VEC_DECODE_LIMIT>(),
        ) {
            Ok((documents, read)) if read == bytes.len() => {
                tracing::debug!(
                    bytes_len = bytes.len(),
                    docs_count = documents.len(),
                    "decoded as uncompressed"
                );
                return Ok(Self::Uncompressed { documents });
            }
            Ok((_, read)) => {
                tracing::debug!(
                    bytes_len = bytes.len(),
                    read = read,
                    "uncompressed decode partial read, trying PQ"
                );
            }
            Err(err) => {
                tracing::debug!(
                    error = %err,
                    bytes_len = bytes.len(),
                    "uncompressed decode failed, trying PQ"
                );
            }
        }

        // Try Product Quantization format
        match crate::vec_pq::QuantizedVecIndex::decode(bytes) {
            Ok(quantized_index) => {
                tracing::debug!(bytes_len = bytes.len(), "decoded as PQ");
                Ok(Self::Compressed(quantized_index))
            }
            Err(err) => {
                tracing::debug!(
                    error = %err,
                    bytes_len = bytes.len(),
                    "PQ decode also failed"
                );
                Err(MemvidError::InvalidToc {
                    reason: "unsupported vector index encoding".into(),
                })
            }
        }
    }

    pub fn search(&self, query: &[f32], limit: usize) -> Vec<VecSearchHit> {
        self.search_with_filter(query, limit, None)
    }

    /// Search with optional candidate filter.
    ///
    /// When `candidates` is provided, only documents with frame_ids in the set
    /// are considered. This enables query-time filtering (e.g., by memory cards)
    /// while respecting topK semantics.
    pub fn search_with_filter(
        &self,
        query: &[f32],
        limit: usize,
        candidates: Option<&std::collections::HashSet<FrameId>>,
    ) -> Vec<VecSearchHit> {
        if query.is_empty() {
            return Vec::new();
        }
        match self {
            VecIndex::Uncompressed { documents } => {
                let mut hits: Vec<VecSearchHit> = documents
                    .iter()
                    .filter(|doc| {
                        candidates
                            .map(|c| c.contains(&doc.frame_id))
                            .unwrap_or(true)
                    })
                    .map(|doc| {
                        let distance = l2_distance(query, &doc.embedding);
                        VecSearchHit {
                            frame_id: doc.frame_id,
                            distance,
                        }
                    })
                    .collect();
                hits.sort_by(|a, b| {
                    a.distance
                        .partial_cmp(&b.distance)
                        .unwrap_or(std::cmp::Ordering::Equal)
                });
                hits.truncate(limit);
                hits
            }
            VecIndex::Compressed(quantized) => {
                quantized.search_with_filter(query, limit, candidates)
            }
        }
    }

    pub fn entries(&self) -> Box<dyn Iterator<Item = (FrameId, &[f32])> + '_> {
        match self {
            VecIndex::Uncompressed { documents } => Box::new(
                documents
                    .iter()
                    .map(|doc| (doc.frame_id, doc.embedding.as_slice())),
            ),
            VecIndex::Compressed(_) => {
                // Compressed vectors don't have direct f32 access
                Box::new(std::iter::empty())
            }
        }
    }

    pub fn embedding_for(&self, frame_id: FrameId) -> Option<&[f32]> {
        match self {
            VecIndex::Uncompressed { documents } => documents
                .iter()
                .find(|doc| doc.frame_id == frame_id)
                .map(|doc| doc.embedding.as_slice()),
            VecIndex::Compressed(_) => {
                // Compressed vectors don't have direct f32 access
                None
            }
        }
    }

    pub fn remove(&mut self, frame_id: FrameId) {
        match self {
            VecIndex::Uncompressed { documents } => {
                documents.retain(|doc| doc.frame_id != frame_id);
            }
            VecIndex::Compressed(_quantized) => {
                // Compressed indices are immutable
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VecSearchHit {
    pub frame_id: FrameId,
    pub distance: f32,
}

fn l2_distance(a: &[f32], b: &[f32]) -> f32 {
    a.iter()
        .zip(b.iter())
        .map(|(x, y)| (x - y).powi(2))
        .sum::<f32>()
        .sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builder_roundtrip() {
        let mut builder = VecIndexBuilder::new();
        builder.add_document(1, vec![0.0, 1.0, 2.0]);
        builder.add_document(2, vec![1.0, 2.0, 3.0]);
        let artifact = builder.finish().expect("finish");
        assert_eq!(artifact.vector_count, 2);
        assert_eq!(artifact.dimension, 3);

        let index = VecIndex::decode(&artifact.bytes).expect("decode");
        let hits = index.search(&[0.0, 1.0, 2.0], 10);
        assert_eq!(hits[0].frame_id, 1);
    }

    #[test]
    fn l2_distance_behaves() {
        let d = l2_distance(&[0.0, 0.0], &[3.0, 4.0]);
        assert!((d - 5.0).abs() < 1e-6);
    }
}
