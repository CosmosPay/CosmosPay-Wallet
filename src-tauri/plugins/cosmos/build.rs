/// Every command the frontend may name. The build script turns each into an
/// `allow-<command>` / `deny-<command>` permission, and `permissions/default.toml`
/// is what the app's capability file grants as `cosmos:default`.
///
/// A command missing from this list is not merely undocumented — it is unreachable,
/// because the generated permission it would need does not exist.
const COMMANDS: &[&str] = &[
    "auth_status",
    "auth_store",
    "auth_read",
    "auth_delete",
    "share_text",
    "app_exit",
    "exclude_from_backup",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
