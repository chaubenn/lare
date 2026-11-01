use std::path::PathBuf;

fn main() {
    stage_zvec();
    tauri_build::build()
}

/// Zvec (the palette's search index) is a shared library the app has to ship beside itself.
/// Copy it to `target/zvec/`, where `tauri.windows.conf.json` (next to the exe) and the macOS
/// `frameworks` list (into `Contents/Frameworks`, which tauri-build puts on the rpath) pick it
/// up. This runs before `tauri_build::build()` because that checks the bundled files exist.
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
