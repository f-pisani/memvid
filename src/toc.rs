use bincode::serde::{decode_from_slice, encode_to_vec};
use blake3::Hasher;

use crate::{
    error::{MemvidError, Result},
    types::Toc,
};

fn canonical_config() -> impl bincode::config::Config {
    bincode::config::standard()
        .with_fixed_int_encoding()
        .with_little_endian()
        .with_limit::<{ crate::MAX_INDEX_BYTES as usize }>()
}

impl Toc {
    /// Serialises the TOC using the canonical bincode configuration.
    pub fn encode(&self) -> Result<Vec<u8>> {
        Ok(encode_to_vec(self, canonical_config())?)
    }

    /// Deserialises bytes into a TOC, rejecting any trailing data.
    pub fn decode(bytes: &[u8]) -> Result<Self> {
        match decode_from_slice::<Toc, _>(bytes, canonical_config()) {
            Ok((toc, bytes_read)) => {
                if bytes_read != bytes.len() {
                    return Err(MemvidError::InvalidToc {
                        reason: "unexpected trailing bytes".into(),
                    });
                }
                Ok(toc)
            }
            Err(e) => Err(e.into()),
        }
    }

    /// Deserialises bytes into a TOC, allowing trailing data (for recovery).
    pub fn decode_lenient(bytes: &[u8]) -> Result<Self> {
        match decode_from_slice::<Toc, _>(bytes, canonical_config()) {
            Ok((toc, _)) => Ok(toc),
            Err(e) => Err(e.into()),
        }
    }

    /// Computes the BLAKE3 checksum used for the TOC integrity field.
    pub fn calculate_checksum(bytes: &[u8]) -> [u8; 32] {
        let mut hasher = Hasher::new();
        hasher.update(bytes);
        *hasher.finalize().as_bytes()
    }

    /// Verifies that the stored TOC checksum matches the deterministic encoding.
    pub fn verify_checksum(&self) -> Result<()> {
        let mut clone = self.clone();
        clone.toc_checksum = [0u8; 32];
        let bytes = clone.encode()?;
        let digest = Self::calculate_checksum(&bytes);
        if digest == self.toc_checksum {
            Ok(())
        } else {
            Err(MemvidError::ChecksumMismatch { context: "toc" })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{
        CanonicalEncoding, Frame, FrameId, FrameRole, FrameStatus, IndexManifests, SegmentCatalog,
        SegmentCompression, SegmentMeta, TimeIndexManifest,
    };
    use std::collections::BTreeMap;

    fn sample_toc() -> Toc {
        Toc {
            toc_version: 1,
            segments: vec![SegmentMeta {
                id: 0,
                frame_range: (0, 2),
                primary_checksum: [0x11; 32],
                compression: SegmentCompression::None,
                bytes_offset: 4096,
                bytes_length: 512,
            }],
            frames: vec![
                Frame {
                    id: 0 as FrameId,
                    timestamp: 1_700_000_000,
                    anchor_ts: None,
                    anchor_source: None,
                    kind: Some("text".into()),
                    track: Some("default".into()),
                    payload_offset: 4096,
                    payload_length: 128,
                    checksum: [0x22; 32],
                    uri: Some("mv2://sample/0".into()),
                    title: Some("Sample 0".into()),
                    canonical_encoding: CanonicalEncoding::Plain,
                    canonical_length: Some(128),
                    metadata: None,
                    search_text: None,
                    tags: Vec::new(),
                    labels: Vec::new(),
                    extra_metadata: BTreeMap::new(),
                    content_dates: Vec::new(),
                    role: FrameRole::Document,
                    parent_id: None,
                    chunk_index: None,
                    chunk_count: None,
                    chunk_manifest: None,
                    status: FrameStatus::Active,
                    supersedes: None,
                    superseded_by: None,
                    source_sha256: None,
                    source_path: None,
                    enrichment_state: crate::types::EnrichmentState::default(),
                },
                Frame {
                    id: 1 as FrameId,
                    timestamp: 1_700_000_100,
                    anchor_ts: None,
                    anchor_source: None,
                    kind: None,
                    track: None,
                    payload_offset: 4224,
                    payload_length: 64,
                    checksum: [0x33; 32],
                    uri: Some("mv2://sample/1".into()),
                    title: Some("Sample 1".into()),
                    canonical_encoding: CanonicalEncoding::Plain,
                    canonical_length: Some(64),
                    metadata: None,
                    search_text: None,
                    tags: Vec::new(),
                    labels: Vec::new(),
                    extra_metadata: BTreeMap::new(),
                    content_dates: Vec::new(),
                    role: FrameRole::Document,
                    parent_id: None,
                    chunk_index: None,
                    chunk_count: None,
                    chunk_manifest: None,
                    status: FrameStatus::Active,
                    supersedes: None,
                    superseded_by: None,
                    source_sha256: None,
                    source_path: None,
                    enrichment_state: crate::types::EnrichmentState::default(),
                },
            ],
            indexes: IndexManifests::default(),
            time_index: Some(TimeIndexManifest {
                bytes_offset: 8192,
                bytes_length: 96,
                entry_count: 2,
                checksum: [0x44; 32],
            }),
            temporal_track: None,
            memories_track: None,
            logic_mesh: None,
            sketch_track: None,
            segment_catalog: SegmentCatalog::default(),
            memory_binding: None,
            replay_manifest: None,
            enrichment_queue: Default::default(),
            merkle_root: [0x55; 32],
            toc_checksum: [0u8; 32],
        }
    }

    fn stamp_checksum(mut toc: Toc) -> Toc {
        let mut checksum_target = toc.clone();
        checksum_target.toc_checksum = [0u8; 32];
        let bytes = checksum_target.encode().expect("encode for checksum");
        toc.toc_checksum = Toc::calculate_checksum(&bytes);
        toc
    }

    #[test]
    fn serialize_deserialize_roundtrip() {
        let toc = stamp_checksum(sample_toc());
        let encoded = toc.encode().expect("encode toc");
        let decoded = Toc::decode(&encoded).expect("decode toc");
        decoded.verify_checksum().expect("checksum matches");
        assert_eq!(decoded.toc_checksum, toc.toc_checksum);
    }

    #[test]
    fn detect_checksum_mismatch() {
        let mut toc = stamp_checksum(sample_toc());
        toc.toc_checksum[0] ^= 0xFF;
        let err = toc.verify_checksum().expect_err("must fail");
        matches!(err, MemvidError::ChecksumMismatch { .. });
    }

    #[test]
    fn reject_trailing_bytes() {
        let toc = stamp_checksum(sample_toc());
        let mut bytes = toc.encode().expect("encode toc");
        bytes.push(0);
        let err = Toc::decode(&bytes).expect_err("should reject");
        matches!(err, MemvidError::InvalidToc { .. });
    }
}
