use std::path::PathBuf;

/// Every command in `lib.rs`'s `generate_handler!`. With an app manifest Tauri checks app commands
/// against the capabilities as it does plugin commands; without one any window could call any of
/// them. Each gets an `allow-<name>` permission, granted per window through the sets in
/// `permissions/app.toml`. `check_command_lists` fails the build when the three disagree.
const COMMANDS: &[&str] = &[
    "prepare_bunny_upload",
    "set_current_user",
    "set_bridge_key",
    "expect_auth_callback",
    "ws_status",
    "app_version",
    "take_initial_deeplink",
    "list_devices",
    "check_permissions",
    "request_permission",
    "permission_settings_url",
    "open_permission_settings",
    "reset_screen_recording_permission",
    "preview_url",
    "recorder_settings",
    "set_recorder_settings",
    "recorder_status",
    "recording_start",
    "recording_pause",
    "recording_resume",
    "recording_stop",
    "recording_cancel",
    "recordings_list",
    "recording_delete",
    "clear_screen_sharing",
    "open_recorder_window",
    "hide_recorder_window",
    "tuck_recorder_window",
    "open_camera_window",
    "hide_camera_window",
    "resize_camera_window",
    "focus_main",
    "show_desktop_notification",
    "media_info",
    "make_thumbnail",
    "upload_to_bunny",
    "remember_upload",
    "whisper_models",
    "ensure_whisper_model",
    "transcribe_recording",
    "read_file_bytes",
    "delete_file",
    "path_exists",
    "search_open",
    "search_index",
    "search_query",
];

fn main() {
    stage_zvec();
    check_command_lists();
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("tauri-build failed");
}

/// A command registered in `lib.rs` but missing here would build fine and then be refused at
/// runtime ("not allowed by ACL"), so the lists are compared now instead.
fn check_command_lists() {
    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=permissions/app.toml");
    let lib = std::fs::read_to_string("src/lib.rs").expect("read src/lib.rs");
    let start = lib
        .find("generate_handler![")
        .expect("generate_handler! in src/lib.rs")
        + "generate_handler![".len();
    let end = start + lib[start..].find(']').expect("end of generate_handler!");
    let registered: Vec<&str> = lib[start..end]
        .lines()
        .map(|line| line.split("//").next().unwrap_or_default())
        .flat_map(|line| line.split(','))
        .map(|item| item.trim().rsplit("::").next().unwrap_or_default())
        .filter(|name| !name.is_empty())
        .collect();
    for name in &registered {
        assert!(
            COMMANDS.contains(name),
            "command `{name}` is registered in src/lib.rs but missing from COMMANDS in build.rs"
        );
    }
    let sets = std::fs::read_to_string("permissions/app.toml").expect("read permissions/app.toml");
    for name in COMMANDS {
        assert!(
            registered.contains(name),
            "`{name}` is in COMMANDS in build.rs but not registered in src/lib.rs"
        );
        let permission = format!("\"allow-{}\"", name.replace('_', "-"));
        assert!(
            sets.contains(&permission),
            "no window is granted `{name}`: add {permission} to a set in permissions/app.toml"
        );
    }
}

/// Zvec (the palette's search index) is a shared library the app has to ship beside itself.
/// Copy it to `target/zvec/`, where `tauri.windows.conf.json` (next to the exe) and the macOS
/// `frameworks` list (into `Contents/Frameworks`, which tauri-build puts on the rpath) pick it
/// up. This runs before tauri-build because that checks the bundled files exist.
///
/// On Windows the DLL is also delay-loaded: its initialisers use AVX, so loading it with the exe
/// would kill the app on a CPU without AVX before `search::engine` could check for it.
fn stage_zvec() {
    zvec_rust_build::configure();
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let dest = manifest.join("../../../target/zvec");
    match zvec_rust_build::copy_runtime_libs_to(&dest) {
        Ok(copied) if copied.is_empty() => {
            println!("cargo:warning=Zvec's shared library was not found; the bundle will lack it");
        }
        Ok(_) => {}
        Err(e) => println!("cargo:warning=could not stage Zvec's shared library: {e}"),
    }
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        println!("cargo:rustc-link-arg=/DELAYLOAD:zvec_c_api.dll");
        println!("cargo:rustc-link-lib=delayimp");
    }
}
