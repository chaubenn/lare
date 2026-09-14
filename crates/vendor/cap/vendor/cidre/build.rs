use std::{env, fs::read_to_string, path::PathBuf, process::Command, str::FromStr};

#[derive(Debug, Clone, Copy)]
struct Version {
    major: u32,
    minor: u32,
}

#[derive(Debug, Clone, Default)]
struct DeploymentTargets {
    macos: String,
    ios: String,
    tvos: String,
    watchos: String,
    visionos: String,
}

impl Version {
    fn with_table(table: &[(String, Self)]) -> Option<Self> {
        for record in table {
            if env::var_os(&record.0).is_some() {
                return Some(record.1);
            }
        }
        None
    }

    fn with_str(str: &str) -> Option<Self> {
        let mut res = Self { major: 0, minor: 0 };
        let mut iter = str.split("_").into_iter();
        let Some(s) = iter.next() else {
            return None;
        };

        res.major = str::parse(s).unwrap();

        let Some(s) = iter.next() else {
            return None;
        };

        res.minor = str::parse(s).unwrap();

        Some(res)
    }

    fn to_string(&self) -> String {
        format!("{}.{}", self.major, self.minor)
    }
}

fn add_xc_target_args_from_features(
    target_args: &mut Vec<&'static str>,
    features: &[&'static str],
) {
    for feature in features {
        let env_var = format!("CARGO_FEATURE_{}", feature.to_uppercase());
        if env::var_os(env_var).is_some() {
            target_args.push("-target");
            target_args.push(feature);
        }
    }
}

/// Lare patch: compile the pomace Objective-C shims with the `cc` crate (Command Line
/// Tools clang) instead of `xcodebuild`, so full Xcode is not required. Each pomace
/// target is `pomace/<name>/<name>.m`, built as `lib<name>.a`, ARC + modules enabled.
fn xc_build(
    targets: &[&'static str],
    sdk: &str,
    _arch: &str,
    _configuration: &str,
    deployment_targets: &DeploymentTargets,
) {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let min_macos = deployment_targets
        .macos
        .strip_prefix("MACOSX_DEPLOYMENT_TARGET=")
        .map(|s| s.to_string());
    for name in targets.iter().filter(|t| **t != "-target") {
        let dir = manifest_dir.join("pomace").join(name);
        let src = dir.join(format!("{name}.m"));
        if !src.exists() {
            println!("cargo:warning=cidre: pomace source missing for target {name}");
            continue;
        }
        let mut build = cc::Build::new();
        build
            .file(&src)
            .include(&dir)
            .flag("-fobjc-arc")
            .flag("-fmodules")
            .flag("-fno-common")
            .flag("-Wno-everything")
            .cargo_metadata(true);
        if sdk == "macosx" {
            if let Some(v) = &min_macos {
                build.flag(format!("-mmacosx-version-min={v}"));
            }
        }
        build.compile(name);
    }
}

fn parse_deployment_targets() -> DeploymentTargets {
    let path = env::var("CARGO_MANIFEST_DIR").unwrap();
    let path = PathBuf::from_str(&path).unwrap();
    let path = path.join("Cargo.toml");
    let str = read_to_string(path).unwrap();
    let mut lines_iter = str.lines().into_iter();
    while let Some(line) = lines_iter.next() {
        if !line.starts_with("# deployment targets") {
            continue;
        }
        break;
    }

    let mut macos = Vec::new();
    let mut ios = Vec::new();
    let mut tvos = Vec::new();
    let mut maccatalyst = Vec::new();
    let mut watchos = Vec::new();
    let mut visionos = Vec::new();

    while let Some(line) = lines_iter.next() {
        if line.starts_with("# end of deployment targets") {
            break;
        }

        let Some((val, _)) = line.split_once(" ") else {
            continue;
        };

        let Some((platform, ver_str)) = val.split_once("_") else {
            continue;
        };

        let Some(ver) = Version::with_str(ver_str) else {
            continue;
        };

        match platform {
            "macos" => macos.push((format!("CARGO_FEATURE_MACOS_{ver_str}"), ver)),
            "ios" => ios.push((format!("CARGO_FEATURE_IOS_{ver_str}"), ver)),
            "tvos" => tvos.push((format!("CARGO_FEATURE_TVOS_{ver_str}"), ver)),
            "maccatalyst" => {
                maccatalyst.push((format!("CARGO_FEATURE_MACCATALYST_{ver_str}"), ver))
            }
            "watchos" => watchos.push((format!("CARGO_FEATURE_WATCHOS_{ver_str}"), ver)),
            "visionos" => visionos.push((format!("CARGO_FEATURE_VISIONOS_{ver_str}"), ver)),
            _ => {
                panic!("unknown platform {platform:?}");
            }
        }
    }

    macos.reverse();
    ios.reverse();
    tvos.reverse();
    maccatalyst.reverse();
    watchos.reverse();
    visionos.reverse();

    let mut res = DeploymentTargets::default();

    if let Some(v) = Version::with_table(&macos) {
        res.macos = format!("MACOSX_DEPLOYMENT_TARGET={}", v.to_string());
    }
    if let Some(v) = Version::with_table(&ios) {
        res.ios = format!("IPHONEOS_DEPLOYMENT_TARGET={}", v.to_string());
    }
    if let Some(v) = Version::with_table(&tvos) {
        res.tvos = format!("TVOS_DEPLOYMENT_TARGET={}", v.to_string());
    }
    if let Some(v) = Version::with_table(&watchos) {
        res.watchos = format!("WATCHOS_DEPLOYMENT_TARGET={}", v.to_string());
    }
    if let Some(v) = Version::with_table(&maccatalyst) {
        // TODO: investigate
        res.ios = format!("IPHONEOS_DEPLOYMENT_TARGET={}", v.to_string());
    }
    if let Some(v) = Version::with_table(&visionos) {
        res.visionos = format!("XROS_DEPLOYMENT_TARGET={}", v.to_string());
    }

    res
}

fn main() {
    if std::env::var("DOCS_RS").is_ok() {
        return;
    }

    let versions = parse_deployment_targets();

    let sdk = match env::var("TARGET").unwrap().as_ref() {
        "aarch64-apple-darwin" | "x86_64-apple-darwin" => "macosx",
        "aarch64-apple-ios" => "iphoneos",
        "x86_64-apple-ios" | "aarch64-apple-ios-sim" => "iphonesimulator",
        "aarch64-apple-ios-macabi" => "maccatalyst",
        "aarch64-apple-tvos" => "appletvos",
        "aarch64-apple-tvos-sim" => "appletvsimulator",
        "arm64_32-apple-watchos" => "watchos",
        "aarch64-apple-watchos" => "watchos",
        "aarch64-apple-watchos-sim" => "watchsimulator",
        "aarch64-apple-visionos" => "xros",
        "aarch64-apple-visionos-sim" => "xrsimulator",
        x => panic!("unknown tripple: {x}"),
    };

    let clang_rt = match sdk {
        "macosx" => "clang_rt.osx",
        "iphoneos" => "clang_rt.ios",
        "iphonesimulator" => "clang_rt.iossim",
        "appletvos" => "clang_rt.tvos",
        "appletvsimulator" => "clang_rt.tvossim",
        "watchos" => "clang_rt.watchos",
        "watchossimulator" => "clang_rt.watchossim",
        "xros" => "clang_rt.xros",
        "xrsimulator" => "clang_rt.xrossim",
        "maccatalyst" => "clang_rt.ios", // check
        x => panic!("unknown sdk {x}"),
    };

    println!("cargo:rustc-link-lib={}", clang_rt);
    println!("cargo:rustc-link-search={}", clang_link_search_path());

    let arch = match env::var("TARGET").unwrap().as_ref() {
        "aarch64-apple-ios-macabi"
        | "aarch64-apple-darwin"
        | "aarch64-apple-ios"
        | "aarch64-apple-tvos"
        | "aarch64-apple-tvos-sim"
        | "aarch64-apple-ios-sim"
        | "aarch64-apple-watchos-sim"
        | "aarch64-apple-visionos"
        | "aarch64-apple-visionos-sim" => "arm64",
        "x86_64-apple-ios" | "x86_64-apple-darwin" => "x86_64",
        "arm64_32-apple-watchos" => "arm64_32",
        x => panic!("unknown tripple: {x}"),
    };

    let configuration = match env::var("PROFILE").unwrap().as_str() {
        "release" => "Release",
        "debug" => "Debug",
        x => panic!("unknown profile: {x}"),
    };

    let mut xc_target_args = Vec::new();

    add_xc_target_args_from_features(
        &mut xc_target_args,
        &["ut", "un", "sn", "ns", "av", "cl", "nl", "ml"],
    );

    if sdk != "watchos" && sdk != "watchsimulator" {
        add_xc_target_args_from_features(
            &mut xc_target_args,
            &[
                "ca", "vn", "mps", "mpsg", "mc", "mtl", "mtk", "ci", "gc", "av_kit",
            ],
        );
        if sdk != "xros" && sdk != "xrsimulator" {
            add_xc_target_args_from_features(&mut xc_target_args, &["mlc"]);
        }
    }

    if sdk != "appletvos" && sdk != "appletvsimulator" {
        add_xc_target_args_from_features(&mut xc_target_args, &["core_motion"]);
    }

    if sdk != "appletvos"
        && sdk != "appletvsimulator"
        && sdk != "watchos"
        && sdk != "watchsimulator"
    {
        add_xc_target_args_from_features(&mut xc_target_args, &["wk"]);
    }

    if [
        "iphoneos",
        "iphonesimulator",
        "maccatalyst",
        "appletvos",
        "appletvsimulator",
        "watchos",
        "watchosimulator",
        "visionos",
        "visionsimulator",
    ]
    .contains(&sdk)
    {
        add_xc_target_args_from_features(&mut xc_target_args, &["ui"]);
    }
    if sdk == "iphoneos" || sdk == "iphonesimulator" {
        add_xc_target_args_from_features(&mut xc_target_args, &["wc"]);
    }
    if sdk == "macosx" || sdk == "maccatalyst" {
        add_xc_target_args_from_features(&mut xc_target_args, &["sc", "app"]);
        if env::var_os("CARGO_FEATURE_PRIVATE").is_some() {
            println!("cargo:rustc-link-search=framework=/System/Library/PrivateFrameworks");
            println!(
                "cargo:rustc-link-search=framework=/Library/Apple/System/Library/PrivateFrameworks"
            );
        }
    }
    if sdk == "macosx" {
        add_xc_target_args_from_features(&mut xc_target_args, &["core_audio"]);
    }

    println!("cargo:rerun-if-changed=./pomace/");
    xc_build(&xc_target_args, sdk, arch, configuration, &versions);
}

fn clang_link_search_path() -> String {
    let output = Command::new("/usr/bin/clang")
        .arg("--print-search-dirs")
        .output()
        .unwrap();
    if !output.status.success() {
        panic!("Can't get search paths from clang");
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if let Some((a, b)) = line.split_once('=') {
            if a == "libraries: " {
                return format!("{}/lib/darwin", b);
            }
        }
    }
    panic!("clang is missing search paths");
}
