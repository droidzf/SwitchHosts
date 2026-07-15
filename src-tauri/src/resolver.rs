//! macOS `/etc/resolver` management with persistent on/off records.
//!
//! `/etc/resolver` remains the source of truth for what is active in macOS,
//! while `internal/resolvers.json` keeps every known resolver and its last
//! content. Disabling a resolver removes only the system file; enabling it
//! restores that file from the persisted content.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::hosts_apply::{elevation, HostsApplyError};
use crate::storage::atomic::atomic_write;

pub const RESOLVER_DIR: &str = "/etc/resolver";
const STORE_FORMAT: &str = "switchhosts-resolvers";
const STORE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ResolverEntry {
    pub name: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct ResolverRecord {
    name: String,
    content: String,
    #[serde(default)]
    enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct ResolverStore {
    #[serde(default = "default_store_format")]
    format: String,
    #[serde(default = "default_store_schema_version", rename = "schemaVersion")]
    schema_version: u32,
    #[serde(default)]
    items: Vec<ResolverRecord>,
}

impl Default for ResolverStore {
    fn default() -> Self {
        Self {
            format: default_store_format(),
            schema_version: STORE_SCHEMA_VERSION,
            items: Vec::new(),
        }
    }
}

fn default_store_format() -> String {
    STORE_FORMAT.into()
}

const fn default_store_schema_version() -> u32 {
    STORE_SCHEMA_VERSION
}

#[derive(Debug, thiserror::Error)]
pub enum ResolverError {
    #[error("resolver management is only supported on macOS")]
    Unsupported,
    #[error("invalid resolver name: {0}")]
    InvalidName(String),
    #[error("resolver content is not valid: {0}")]
    InvalidContent(String),
    #[error("resolver already exists: {0}")]
    AlreadyExists(String),
    #[error("resolver not found: {0}")]
    NotFound(String),
    #[error("resolver I/O failed: {0}")]
    Io(String),
    #[error(transparent)]
    Privileged(#[from] HostsApplyError),
}

impl ResolverError {
    pub fn into_renderer_value(self) -> Value {
        match self {
            ResolverError::Privileged(e) => e.into_renderer_value(),
            other => json!({
                "success": false,
                "code": "fail",
                "message": other.to_string(),
            }),
        }
    }
}

pub fn validate_name(name: &str) -> Result<(), ResolverError> {
    crate::helper_proto::validate_resolver_name(name)
        .map_err(|_| ResolverError::InvalidName(name.into()))
}

fn validate_content(content: &str) -> Result<(), ResolverError> {
    crate::helper_proto::validate_payload(content.as_bytes())
        .map_err(|e| ResolverError::InvalidContent(e.to_string()))
}

fn resolver_path_in(dir: &Path, name: &str) -> Result<PathBuf, ResolverError> {
    validate_name(name)?;
    Ok(dir.join(name))
}

fn resolver_path(name: &str) -> Result<PathBuf, ResolverError> {
    resolver_path_in(Path::new(RESOLVER_DIR), name)
}

fn read_system_in(dir: &Path, name: &str) -> Result<String, ResolverError> {
    let path = resolver_path_in(dir, name)?;
    let metadata = std::fs::symlink_metadata(&path).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => ResolverError::NotFound(name.into()),
        _ => ResolverError::Io(e.to_string()),
    })?;
    if !metadata.file_type().is_file() {
        return Err(ResolverError::NotFound(name.into()));
    }
    std::fs::read_to_string(&path).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => ResolverError::NotFound(name.into()),
        _ => ResolverError::Io(e.to_string()),
    })
}

fn read_system_records_in(dir: &Path) -> Result<BTreeMap<String, String>, ResolverError> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(BTreeMap::new()),
        Err(e) => return Err(ResolverError::Io(e.to_string())),
    };

    let mut records = BTreeMap::new();
    for entry in entries {
        let entry = entry.map_err(|e| ResolverError::Io(e.to_string()))?;
        let name = match entry.file_name().into_string() {
            Ok(name) if validate_name(&name).is_ok() => name,
            _ => continue,
        };
        let file_type = entry
            .file_type()
            .map_err(|e| ResolverError::Io(e.to_string()))?;
        if file_type.is_file() {
            records.insert(name.clone(), read_system_in(dir, &name)?);
        }
    }
    Ok(records)
}

fn load_store(path: &Path) -> Result<ResolverStore, ResolverError> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(ResolverStore::default()),
        Err(e) => return Err(ResolverError::Io(e.to_string())),
    };
    let mut store: ResolverStore =
        serde_json::from_slice(&bytes).map_err(|e| ResolverError::Io(e.to_string()))?;
    if store.format != STORE_FORMAT || store.schema_version != STORE_SCHEMA_VERSION {
        return Err(ResolverError::Io(
            "unsupported resolver store format".into(),
        ));
    }
    normalize_store(&mut store)?;
    Ok(store)
}

fn save_store(path: &Path, store: &ResolverStore) -> Result<(), ResolverError> {
    let bytes = serde_json::to_vec_pretty(store).map_err(|e| ResolverError::Io(e.to_string()))?;
    atomic_write(path, &bytes).map_err(|e| ResolverError::Io(e.to_string()))
}

fn normalize_store(store: &mut ResolverStore) -> Result<(), ResolverError> {
    let mut seen = std::collections::HashSet::new();
    for record in &store.items {
        validate_name(&record.name)?;
        validate_content(&record.content)?;
        if !seen.insert(record.name.clone()) {
            return Err(ResolverError::Io(format!(
                "duplicate resolver record: {}",
                record.name
            )));
        }
    }
    store
        .items
        .sort_by_key(|record| record.name.to_ascii_lowercase());
    Ok(())
}

fn sync_store_in(store_path: &Path, system_dir: &Path) -> Result<ResolverStore, ResolverError> {
    let mut store = load_store(store_path)?;
    let previous = store.clone();
    let mut system_records = read_system_records_in(system_dir)?;

    for record in &mut store.items {
        if let Some(content) = system_records.remove(&record.name) {
            record.content = content;
            record.enabled = true;
        } else if record.enabled {
            // The system file was removed outside SwitchHosts. Keep the
            // persisted content, but reflect the real disabled state.
            record.enabled = false;
        }
    }

    store.items.extend(
        system_records
            .into_iter()
            .map(|(name, content)| ResolverRecord {
                name,
                content,
                enabled: true,
            }),
    );
    normalize_store(&mut store)?;

    if store != previous || !store_path.exists() {
        save_store(store_path, &store)?;
    }
    Ok(store)
}

fn sync_store(store_path: &Path) -> Result<ResolverStore, ResolverError> {
    ensure_supported()?;
    sync_store_in(store_path, Path::new(RESOLVER_DIR))
}

pub fn list(store_path: &Path) -> Result<Vec<ResolverEntry>, ResolverError> {
    Ok(sync_store(store_path)?
        .items
        .into_iter()
        .map(|record| ResolverEntry {
            name: record.name,
            enabled: record.enabled,
        })
        .collect())
}

pub fn read(store_path: &Path, name: &str) -> Result<String, ResolverError> {
    validate_name(name)?;
    let store = sync_store(store_path)?;
    store
        .items
        .into_iter()
        .find(|record| record.name == name)
        .map(|record| record.content)
        .ok_or_else(|| ResolverError::NotFound(name.into()))
}

pub fn save(store_path: &Path, name: &str, content: &str) -> Result<(), ResolverError> {
    ensure_supported()?;
    validate_name(name)?;
    validate_content(content)?;
    let mut store = sync_store(store_path)?;

    if let Some(record) = store.items.iter_mut().find(|record| record.name == name) {
        if record.enabled {
            elevation::write_resolver_privileged(name, content)?;
        }
        record.content = content.into();
    } else {
        elevation::write_resolver_privileged(name, content)?;
        store.items.push(ResolverRecord {
            name: name.into(),
            content: content.into(),
            enabled: true,
        });
    }

    normalize_store(&mut store)?;
    save_store(store_path, &store)
}

pub fn toggle(
    store_path: &Path,
    name: &str,
    enabled: bool,
    content_override: Option<&str>,
) -> Result<(), ResolverError> {
    ensure_supported()?;
    validate_name(name)?;
    if let Some(content) = content_override {
        validate_content(content)?;
    }
    let mut store = sync_store(store_path)?;
    let record = store
        .items
        .iter_mut()
        .find(|record| record.name == name)
        .ok_or_else(|| ResolverError::NotFound(name.into()))?;

    if let Some(content) = content_override {
        record.content = content.into();
    }

    if enabled {
        elevation::write_resolver_privileged(name, &record.content)?;
    } else {
        if content_override.is_none() {
            if let Ok(content) = read_system_in(Path::new(RESOLVER_DIR), name) {
                record.content = content;
            }
        }
        elevation::delete_resolver_privileged(name)?;
    }
    record.enabled = enabled;
    save_store(store_path, &store)
}

pub fn rename(store_path: &Path, old_name: &str, new_name: &str) -> Result<(), ResolverError> {
    ensure_supported()?;
    validate_name(old_name)?;
    validate_name(new_name)?;
    if old_name == new_name {
        return Ok(());
    }
    let mut store = sync_store(store_path)?;
    if store.items.iter().any(|record| record.name == new_name)
        || std::fs::symlink_metadata(resolver_path(new_name)?).is_ok()
    {
        return Err(ResolverError::AlreadyExists(new_name.into()));
    }
    let record = store
        .items
        .iter_mut()
        .find(|record| record.name == old_name)
        .ok_or_else(|| ResolverError::NotFound(old_name.into()))?;
    if record.enabled {
        elevation::rename_resolver_privileged(old_name, new_name)?;
    }
    record.name = new_name.into();
    normalize_store(&mut store)?;
    save_store(store_path, &store)
}

pub fn delete(store_path: &Path, name: &str) -> Result<(), ResolverError> {
    ensure_supported()?;
    validate_name(name)?;
    let mut store = sync_store(store_path)?;
    let index = store
        .items
        .iter()
        .position(|record| record.name == name)
        .ok_or_else(|| ResolverError::NotFound(name.into()))?;
    if store.items[index].enabled {
        elevation::delete_resolver_privileged(name)?;
    }
    store.items.remove(index);
    save_store(store_path, &store)
}

fn ensure_supported() -> Result<(), ResolverError> {
    if cfg!(target_os = "macos") {
        Ok(())
    } else {
        Err(ResolverError::Unsupported)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "swh_resolver_{label}_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn resolver_name_validation_rejects_path_traversal() {
        for name in ["", ".", "..", ".hidden", "test.", "../hosts", "a/b", "a b"] {
            assert!(validate_name(name).is_err(), "{name:?} should be rejected");
        }
        for name in ["test", "internal.example", "corp-local", "service_env"] {
            assert!(validate_name(name).is_ok(), "{name:?} should be accepted");
        }
    }

    #[test]
    fn sync_imports_system_files_and_preserves_disabled_records() {
        let root = temp_dir("sync");
        let system_dir = root.join("system");
        let store_path = root.join("internal/resolvers.json");
        std::fs::create_dir_all(&system_dir).unwrap();
        std::fs::write(system_dir.join("active.test"), "nameserver 1.1.1.1\n").unwrap();

        let stored = ResolverStore {
            items: vec![
                ResolverRecord {
                    name: "disabled.test".into(),
                    content: "nameserver 8.8.8.8\n".into(),
                    enabled: false,
                },
                ResolverRecord {
                    name: "removed.test".into(),
                    content: "nameserver 9.9.9.9\n".into(),
                    enabled: true,
                },
            ],
            ..ResolverStore::default()
        };
        save_store(&store_path, &stored).unwrap();

        let synced = sync_store_in(&store_path, &system_dir).unwrap();
        assert_eq!(
            synced.items,
            vec![
                ResolverRecord {
                    name: "active.test".into(),
                    content: "nameserver 1.1.1.1\n".into(),
                    enabled: true,
                },
                ResolverRecord {
                    name: "disabled.test".into(),
                    content: "nameserver 8.8.8.8\n".into(),
                    enabled: false,
                },
                ResolverRecord {
                    name: "removed.test".into(),
                    content: "nameserver 9.9.9.9\n".into(),
                    enabled: false,
                },
            ]
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn sync_uses_live_content_for_enabled_records() {
        let root = temp_dir("content");
        let system_dir = root.join("system");
        let store_path = root.join("internal/resolvers.json");
        std::fs::create_dir_all(&system_dir).unwrap();
        std::fs::write(system_dir.join("corp.test"), "nameserver 10.0.0.2\n").unwrap();
        save_store(
            &store_path,
            &ResolverStore {
                items: vec![ResolverRecord {
                    name: "corp.test".into(),
                    content: "nameserver 10.0.0.1\n".into(),
                    enabled: true,
                }],
                ..ResolverStore::default()
            },
        )
        .unwrap();

        let synced = sync_store_in(&store_path, &system_dir).unwrap();
        assert_eq!(synced.items[0].content, "nameserver 10.0.0.2\n");
        assert!(synced.items[0].enabled);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn read_rejects_invalid_name_before_touching_disk() {
        let err = read_system_in(Path::new("/definitely/missing"), "../hosts").unwrap_err();
        assert!(matches!(err, ResolverError::InvalidName(_)));
    }
}
