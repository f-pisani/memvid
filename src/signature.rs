use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use ed25519_dalek::{Signature, VerifyingKey};
use serde::Serialize;
use std::convert::TryInto;

use crate::error::{MemvidError, Result};

const SIGNING_SCHEMA_VERSION: u8 = 1;

#[derive(Serialize)]
struct ModelSignaturePayload<'a> {
    version: u8,
    name: &'a str,
    model_version: &'a str,
    checksum: &'a str,
    size_bytes: u64,
}

fn model_message_bytes(
    name: &str,
    model_version: &str,
    checksum_hex: &str,
    size_bytes: u64,
) -> Result<Vec<u8>> {
    let payload = ModelSignaturePayload {
        version: SIGNING_SCHEMA_VERSION,
        name,
        model_version,
        checksum: checksum_hex,
        size_bytes,
    };
    serde_json::to_vec(&payload).map_err(|err| MemvidError::ModelSignatureInvalid {
        reason: format!("failed to serialize model payload: {err}").into_boxed_str(),
    })
}

pub fn verify_model_manifest(
    verifying_key: &VerifyingKey,
    name: &str,
    model_version: &str,
    checksum_hex: &str,
    size_bytes: u64,
    signature_bytes: &[u8],
) -> Result<()> {
    let message = model_message_bytes(name, model_version, checksum_hex, size_bytes)?;
    let signature = to_signature(signature_bytes)
        .map_err(|reason| MemvidError::ModelSignatureInvalid { reason })?;
    verifying_key
        .verify_strict(&message, &signature)
        .map_err(|_| MemvidError::ModelSignatureInvalid {
            reason: "model signature mismatch".into(),
        })
}

fn to_signature(bytes: &[u8]) -> std::result::Result<Signature, Box<str>> {
    let array: [u8; 64] = bytes
        .try_into()
        .map_err(|_| Box::<str>::from("signature must be exactly 64 bytes"))?;
    Ok(Signature::from_bytes(&array))
}

pub fn parse_ed25519_public_key_base64(encoded: &str) -> Result<VerifyingKey> {
    let trimmed = encoded.trim();
    let bytes =
        BASE64_STANDARD
            .decode(trimmed)
            .map_err(|err| MemvidError::ModelSignatureInvalid {
                reason: format!("invalid base64 public key: {err}").into_boxed_str(),
            })?;
    let array: [u8; 32] =
        bytes
            .as_slice()
            .try_into()
            .map_err(|_| MemvidError::ModelSignatureInvalid {
                reason: "public key must be 32 bytes".into(),
            })?;
    VerifyingKey::from_bytes(&array).map_err(|err| MemvidError::ModelSignatureInvalid {
        reason: format!("invalid public key: {err}").into_boxed_str(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn test_signing_key() -> SigningKey {
        let seed = [7u8; 32];
        SigningKey::from_bytes(&seed)
    }

    #[test]
    fn model_roundtrip() {
        let signing = test_signing_key();
        let verifying = signing.verifying_key();
        let message = model_message_bytes("model", "1.0.0", "abc123", 1024).unwrap();
        let signature = signing.sign(&message);
        verify_model_manifest(
            &verifying,
            "model",
            "1.0.0",
            "abc123",
            1024,
            &signature.to_bytes(),
        )
        .unwrap();
    }

    #[test]
    fn parse_public_key() {
        let signing = test_signing_key();
        let verifying = signing.verifying_key();
        let encoded = BASE64_STANDARD.encode(verifying.as_bytes());
        let parsed = parse_ed25519_public_key_base64(&encoded).unwrap();
        assert_eq!(parsed.as_bytes(), verifying.as_bytes());
    }
}
