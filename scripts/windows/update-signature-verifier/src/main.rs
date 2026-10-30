//! Offline, public-key-only release tooling. No updater runtime, signing, network,
//! environment-based credentials, installation, or private-key support.
use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use semver::Version;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, ffi::OsString, fs::File, io::Read, path::Path};

type Result<T> = std::result::Result<T, &'static str>;

fn sha256(bytes: &[u8]) -> String {
    format!("{:X}", Sha256::digest(bytes))
}

fn decode(value: &str, error: &'static str) -> Result<String> {
    let bytes = STANDARD.decode(value).map_err(|_| error)?;
    String::from_utf8(bytes).map_err(|_| error)
}

fn expected_version(value: &str) -> Result<Version> {
    let version = Version::parse(value).map_err(|_| "invalid_expected_version")?;
    if version.to_string() != value {
        return Err("invalid_expected_version");
    }
    Ok(version)
}

fn verify(bytes: &[u8], public_key: &str, signature: &str, expected: &str) -> Result<()> {
    let expected = expected_version(expected)?;
    let key = PublicKey::decode(&decode(public_key, "public_key_invalid")?)
        .map_err(|_| "public_key_invalid")?;
    let signature = Signature::decode(&decode(signature, "signature_invalid")?)
        .map_err(|_| "signature_invalid")?;

    // Same verifier and allow_legacy=true as tauri-plugin-updater 2.13.3.
    // This authenticates BOTH the artifact bytes and the global signature over
    // the trusted comment. Do not use the comment until this succeeds.
    key.verify(bytes, &signature, true)
        .map_err(|_| "signature_invalid")?;

    // Same version-field extraction and SemVer comparison as the pinned SDK's
    // verify_signed_version(..., require_signed_version=true). Our explicit
    // expected-version input is required to be valid canonical SemVer above.
    let signed = signature
        .trusted_comment()
        .split('\t')
        .find_map(|field| field.strip_prefix("version:"))
        .ok_or("missing_signed_version")?;
    let matches = Version::parse(signed.trim_start_matches('v'))
        .map(|signed| signed == expected)
        .unwrap_or_else(|_| signed == expected.to_string());
    if !matches {
        return Err("signed_version_mismatch");
    }
    Ok(())
}

fn validate_local_path(path: &Path) -> Result<()> {
    let text = path.to_string_lossy();
    if text.contains("://")
        || (text.starts_with(['\\', '/']) && text[1..].starts_with(['\\', '/']))
        || path.components().any(|part| {
            matches!(part, std::path::Component::Normal(name) if name.to_string_lossy().contains(':'))
        })
    {
        return Err("invalid_local_path");
    }
    Ok(())
}

fn local_file(path: &Path, limit: u64, error: &'static str) -> Result<Vec<u8>> {
    validate_local_path(path)?;
    let file = File::open(path).map_err(|_| error)?;
    let metadata = file.metadata().map_err(|_| error)?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > limit {
        return Err(error);
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| error)?;
    if bytes.is_empty() || bytes.len() as u64 > limit {
        return Err(error);
    }
    Ok(bytes)
}

fn envelope<'a>(bytes: &'a [u8], error: &'static str) -> Result<&'a str> {
    let text = std::str::from_utf8(bytes).map_err(|_| error)?;
    Ok(text
        .strip_suffix("\r\n")
        .or_else(|| text.strip_suffix('\n'))
        .unwrap_or(text))
}

fn arguments(args: impl Iterator<Item = OsString>) -> Result<BTreeMap<String, OsString>> {
    const REQUIRED: [&str; 4] = [
        "--public-key",
        "--artifact",
        "--signature",
        "--expected-version",
    ];
    let mut values = BTreeMap::new();
    let mut args = args;
    while let Some(option) = args.next() {
        let option = option.to_str().ok_or("invalid_arguments")?;
        if !REQUIRED.contains(&option) || values.contains_key(option) {
            return Err("invalid_arguments");
        }
        let value = args.next().ok_or("invalid_arguments")?;
        if value.is_empty() || value.to_string_lossy().starts_with("--") {
            return Err("invalid_arguments");
        }
        values.insert(option.to_owned(), value);
    }
    if values.len() != REQUIRED.len() {
        return Err("invalid_arguments");
    }
    Ok(values)
}

fn run() -> Result<Value> {
    let args = arguments(std::env::args_os().skip(1))?;
    let version = args["--expected-version"]
        .to_str()
        .ok_or("invalid_expected_version")?;
    expected_version(version)?;
    let key_bytes = local_file(
        Path::new(&args["--public-key"]),
        16_384,
        "public_key_invalid",
    )?;
    let sig_bytes = local_file(Path::new(&args["--signature"]), 16_384, "signature_invalid")?;
    let bytes = local_file(
        Path::new(&args["--artifact"]),
        512 * 1024 * 1024,
        "artifact_invalid",
    )?;
    let key = envelope(&key_bytes, "public_key_invalid")?;
    verify(
        &bytes,
        key,
        envelope(&sig_bytes, "signature_invalid")?,
        version,
    )?;
    // Hash precisely the same in-memory bytes passed to the pinned verifier,
    // not a second path read that might refer to different file contents.
    Ok(json!({
        "verified": true,
        "version": version,
        "bytes": bytes.len(),
        "artifactSha256": sha256(&bytes),
        "signatureSha256": sha256(&sig_bytes),
        "publicKeySha256": sha256(decode(key, "public_key_invalid")?.as_bytes()),
    }))
}

fn main() {
    match run() {
        Ok(report) => println!("{report}"),
        Err(code) => {
            // Static error codes only: never echo inputs, contents, SDK error
            // payloads, environment values, or unauthenticated version comments.
            eprintln!("signature verification failed: {code}");
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixtures() -> Value {
        serde_json::from_str(include_str!("../fixtures/signatures.json")).unwrap()
    }

    #[test]
    fn pinned_verifier_accepts_both_architecture_fixtures_and_sdk_version_semantics() {
        let fixtures = fixtures();
        let key = fixtures["publicKey"].as_str().unwrap();
        for (name, expected) in [
            ("x64", "0.2.0"),
            ("arm64", "0.2.0"),
            ("legacy", "0.2.0"),
            ("prefixed", "0.2.0"),
            ("prerelease", "0.2.0-test.1"),
        ] {
            let case = &fixtures["cases"][name];
            assert!(verify(
                case["artifact"].as_str().unwrap().as_bytes(),
                key,
                case["signature"].as_str().unwrap(),
                expected,
            )
            .is_ok());
        }
    }

    #[test]
    fn genuine_unversioned_and_other_version_signatures_are_rejected() {
        let fixtures = fixtures();
        for (name, expected_error) in [
            ("missingVersion", "missing_signed_version"),
            ("otherVersion", "signed_version_mismatch"),
        ] {
            let case = &fixtures["cases"][name];
            assert_eq!(
                verify(
                    case["artifact"].as_str().unwrap().as_bytes(),
                    fixtures["publicKey"].as_str().unwrap(),
                    case["signature"].as_str().unwrap(),
                    "0.2.0",
                ),
                Err(expected_error)
            );
        }
    }

    #[test]
    fn expected_version_is_required_canonical_semver() {
        for version in ["", "v0.2.0", "0.2", "0.2.0\n", "01.2.0"] {
            assert!(expected_version(version).is_err());
        }
    }

    #[test]
    fn explicit_remote_and_device_paths_are_rejected_without_io() {
        for path in [
            "https://example.invalid/key.pub",
            "//example.invalid/share/key.pub",
            "\\\\example.invalid\\share\\key.pub",
            "\\/example.invalid/share/key.pub",
            "/\\example.invalid/share/key.pub",
            "\\\\?\\C:\\key.pub",
            "key.pub:stream",
        ] {
            assert!(validate_local_path(Path::new(path)).is_err());
        }
    }
}
