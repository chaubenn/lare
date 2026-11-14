// @ts-check
// Downloads the prebuilt ffmpeg the vendored Cap crates (ffmpeg-next) link against
// and writes .cargo/config.toml with FFMPEG_DIR. Port of Cap's scripts/setup.js
// without the ONNX/sccache/Linux parts.
//
//   node scripts/setup-native-deps.mjs
//
// macOS:   spacedriveapp/native-deps (libav*, libsw*, libpostproc as a .framework)
// Windows: GyanD ffmpeg 7.1 full_build-shared (DLLs + import libs + headers)
//
// Every archive is pinned by SHA-256 (see SHA256 below) and checked on every run, cached
// or not: these libraries ship inside the signed installers, so a swapped archive would
// ship too. A mismatch deletes the file and fails the build.
import { exec as execCb, execFile as execFileCb } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);
const exec = promisify(execCb);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetDir = path.join(root, "target");
const arch =
  process.env.RUST_TARGET_TRIPLE?.split("-")[0] ??
  (process.arch === "arm64" ? "aarch64" : "x86_64");

const FFMPEG_CARGO_ENV = `[env]
FFMPEG_DIR = { relative = true, force = true, value = "target/native-deps" }
`;

async function exists(p) {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false);
}

// SHA-256 of each archive this script downloads, keyed by file name. Neither publisher
// ships checksums and the GitHub release assets predate GitHub's `digest` field, so these
// were taken by downloading each file once and hashing it (sizes matched the release API).
// Bumping a version means adding its hash here; an unlisted file is refused.
const SHA256 = {
  // https://github.com/spacedriveapp/native-deps/releases/tag/v0.25
  "native-deps-aarch64-darwin-apple.tar.xz":
    "59c42dbf4dd2009c1d04c049df8d8e25f79fd2d245531e3d269d83407116c895",
  "native-deps-x86_64-darwin-apple.tar.xz":
    "138f2bab8214d8971d043c1d42eb09039743b144c07a33fc6c76f774414407ce",
  // https://github.com/GyanD/codexffmpeg/releases/tag/7.1
  "ffmpeg-7.1-full_build-shared.zip":
    "fedf38dbdd00fa189da06afb0abba69a19312412e05fa2e8e89b3c06aafebcdc",
};

function expectedSha256(name) {
  const sha = SHA256[/** @type {keyof typeof SHA256} */ (name)];
  if (!sha) throw new Error(`No pinned SHA-256 for ${name}; add one to SHA256 in this script`);
  return sha;
}

async function sha256File(p) {
  return createHash("sha256")
    .update(await fs.readFile(p))
    .digest("hex");
}

// Fails loudly (and removes the file, so the next run downloads it again) on a mismatch.
async function verify(p, expected) {
  const actual = await sha256File(p);
  if (actual !== expected) {
    await fs.rm(p, { force: true });
    throw new Error(
      `SHA-256 mismatch for ${path.basename(p)}: expected ${expected}, got ${actual}. ` +
        "The file was deleted. Do not update the pin unless you know why the upstream file changed.",
    );
  }
  console.log(`Verified ${path.basename(p)} (sha256 ${actual})`);
}

// Downloads `url` to `dest` unless a copy with the pinned hash is already there.
// Returns true when it downloaded (the caller re-extracts).
async function fetchPinned(url, dest, expected) {
  if (await exists(dest)) {
    if ((await sha256File(dest)) === expected) {
      console.log(`Using cached ${path.basename(dest)} (sha256 ${expected})`);
      return false;
    }
    console.warn(`Cached ${path.basename(dest)} does not match its pin; downloading again`);
    await fs.rm(dest, { force: true });
  }
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
  await verify(dest, expected);
  return true;
}

// Extracted trees carry the hash of the archive they came from, so a tree left behind by
// an older, unverified run (for example restored from the CI cache) is re-extracted.
const MARKER = ".lare-archive-sha256";

async function extractedFrom(dir, expected) {
  const marker = await fs.readFile(path.join(dir, MARKER), "utf8").catch(() => "");
  return marker.trim() === expected;
}

async function setupMac() {
  const VERSION = "v0.25";
  const asset = `native-deps-${arch}-darwin-apple.tar.xz`;
  const tarPath = path.join(targetDir, `${VERSION}-${asset}`);
  const sha = expectedSha256(asset);
  const fresh = await fetchPinned(
    `https://github.com/spacedriveapp/native-deps/releases/download/${VERSION}/${asset}`,
    tarPath,
    sha,
  );

  const depsDir = path.join(targetDir, "native-deps");
  if (fresh || !(await exists(path.join(depsDir, "lib"))) || !(await extractedFrom(depsDir, sha))) {
    await fs.rm(depsDir, { recursive: true, force: true });
    await fs.mkdir(depsDir, { recursive: true });
    await execFile("tar", ["xf", tarPath, "-C", depsDir]);
    await fs.writeFile(path.join(depsDir, MARKER), `${sha}\n`);
    console.log("Extracted native-deps");
  } else console.log("Using cached native-deps");

  // Trim the framework to the ffmpeg libraries we actually link.
  const frameworkDir = path.join(depsDir, "Spacedrive.framework");
  if (await exists(frameworkDir)) {
    for (const sub of ["Libraries", "Headers"]) {
      const dir = path.join(frameworkDir, sub);
      if (!(await exists(dir))) continue;
      for (const name of await fs.readdir(dir)) {
        if (
          !(name.startsWith("libav") || name.startsWith("libsw") || name.startsWith("libpostproc"))
        ) {
          await fs.rm(path.join(dir, name), { recursive: true, force: true });
        }
      }
    }
    await fs.rm(path.join(frameworkDir, "Resources", "Models"), { recursive: true, force: true });
    // Ad-hoc sign the dylibs so they load during development.
    const libs = path.join(frameworkDir, "Libraries");
    if (await exists(libs)) {
      for (const name of await fs.readdir(libs)) {
        await execFile("codesign", [
          "-fs",
          process.env.APPLE_SIGNING_IDENTITY ?? "-",
          path.join(libs, name),
        ]).catch(() => undefined);
      }
    }
    await fs.rm(path.join(targetDir, "Frameworks", "Spacedrive.framework"), {
      recursive: true,
      force: true,
    });
    await fs.mkdir(path.join(targetDir, "Frameworks"), { recursive: true });
    await fs.cp(frameworkDir, path.join(targetDir, "Frameworks", "Spacedrive.framework"), {
      recursive: true,
    });
  }
  // The dylibs are referenced as @executable_path/../Frameworks/…, which resolves to
  // target/Frameworks for target/debug/<bin> but not for test/example binaries in
  // target/debug/deps, target/debug/examples or target/<triple>/debug. Link those too.
  const shared = path.join(targetDir, "Frameworks");
  const profileDirs = [path.join(targetDir, "debug"), path.join(targetDir, "release")];
  const triple = process.env.RUST_TARGET_TRIPLE;
  if (triple) {
    profileDirs.push(
      path.join(targetDir, triple, "debug"),
      path.join(targetDir, triple, "release"),
    );
  }
  for (const dir of profileDirs) {
    await fs.mkdir(dir, { recursive: true });
    const link = path.join(dir, "Frameworks");
    await fs.rm(link, { recursive: true, force: true });
    await fs.symlink(path.relative(dir, shared), link, "dir");
  }

  // Copy dylibs next to debug binaries so `cargo run`/tests find them.
  const libDir = path.join(depsDir, "lib");
  for (const profile of ["debug", "release"]) {
    const out = path.join(targetDir, profile);
    await fs.mkdir(out, { recursive: true });
    for (const name of await fs.readdir(libDir)) {
      if (/\.dylib$/.test(name))
        await fs.copyFile(path.join(libDir, name), path.join(out, name)).catch(() => undefined);
    }
  }
  console.log("macOS native deps ready");
}

// Unpacks a zip with the bsdtar that ships in System32 since Windows 10 1803 and Server 2019. By
// full path: under Git Bash a bare `tar` is GNU tar, which does not read zip.
//
// This used to be `Expand-Archive` in Windows PowerShell. On the windows-2022 runner image of
// 2026-11-12 that exited 0 and left no folder behind, and the build died one line later on the
// rename. PowerShell is now only the fallback for a machine with no tar.exe.
async function unzip(zipPath, destDir) {
  const tar = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  if (await exists(tar)) {
    await execFile(tar, ["-xf", zipPath, "-C", destDir]);
    return;
  }
  await exec(`Expand-Archive -Path "${zipPath}" -DestinationPath "${destDir}" -Force`, {
    shell: "powershell.exe",
  });
}

// The folder under `staging` that holds ffmpeg's `bin`, `lib` and `include`: the archive's one
// top-level folder, or `staging` itself if the tool that unpacked it dropped that level.
async function ffmpegTree(staging, topLevel) {
  for (const dir of [path.join(staging, topLevel), staging]) {
    if (await exists(path.join(dir, "bin"))) return dir;
  }
  const found = await fs.readdir(staging);
  throw new Error(
    `Unpacking ${topLevel}.zip left no ffmpeg tree in ${staging} (found: ${found.join(", ") || "nothing"})`,
  );
}

async function setupWindows() {
  const FFMPEG_VERSION = "7.1";
  const zipName = `ffmpeg-${FFMPEG_VERSION}-full_build-shared`;
  const zipPath = path.join(targetDir, `ffmpeg-${FFMPEG_VERSION}.zip`);
  const sha = expectedSha256(`${zipName}.zip`);
  const fresh = await fetchPinned(
    `https://github.com/GyanD/codexffmpeg/releases/download/${FFMPEG_VERSION}/${zipName}.zip`,
    zipPath,
    sha,
  );
  const ffmpegDir = path.join(targetDir, "ffmpeg");
  if (fresh || !(await exists(ffmpegDir)) || !(await extractedFrom(ffmpegDir, sha))) {
    // Unpacked on its own, so what the archive held can be told from what was already in target/.
    const staging = path.join(targetDir, "ffmpeg-extract");
    await fs.rm(staging, { recursive: true, force: true });
    await fs.mkdir(staging, { recursive: true });
    await unzip(zipPath, staging);
    const extracted = await ffmpegTree(staging, zipName);
    await fs.rm(ffmpegDir, { recursive: true, force: true });
    await fs.rename(extracted, ffmpegDir);
    await fs.rm(staging, { recursive: true, force: true });
    await fs.writeFile(path.join(ffmpegDir, MARKER), `${sha}\n`);
    console.log("Extracted ffmpeg");
  }
  for (const profile of ["debug", "release"]) {
    const out = path.join(targetDir, profile);
    await fs.mkdir(out, { recursive: true });
    for (const name of await fs.readdir(path.join(ffmpegDir, "bin"))) {
      await fs.copyFile(path.join(ffmpegDir, "bin", name), path.join(out, name));
    }
  }
  const depsDir = path.join(targetDir, "native-deps");
  await fs.mkdir(depsDir, { recursive: true });
  await fs.cp(path.join(ffmpegDir, "lib"), path.join(depsDir, "lib"), {
    recursive: true,
    force: true,
  });
  await fs.cp(path.join(ffmpegDir, "include"), path.join(depsDir, "include"), {
    recursive: true,
    force: true,
  });

  // libclang for bindgen (ffmpeg-sys-next) via the Visual Studio LLVM component.
  let extra = "";
  try {
    const vswhere = path.join(
      process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
      "Microsoft Visual Studio",
      "Installer",
      "vswhere.exe",
    );
    const { stdout } = await execFile(vswhere, [
      "-latest",
      "-products",
      "*",
      "-requires",
      "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
      "-property",
      "installationPath",
    ]);
    const libclang = path.join(stdout.trim(), "VC/Tools/LLVM/x64/bin/libclang.dll");
    if (await exists(libclang)) {
      extra += `LIBCLANG_PATH = "${libclang.replaceAll("\\", "/")}"\n`;
      console.log(`Using Visual Studio libclang: ${libclang}`);
    } else {
      console.warn(
        `Visual Studio LLVM component not found (${libclang}); falling back to the LLVM installer.`,
      );
    }
  } catch {
    console.warn("vswhere failed; looking for a standalone LLVM install.");
  }
  if (!extra) {
    // Standalone LLVM (e.g. GitHub runners): bindgen needs the directory that holds libclang.dll.
    const candidates = [
      process.env.LIBCLANG_PATH,
      path.join(process.env.ProgramFiles ?? "C:\\Program Files", "LLVM", "bin"),
    ].filter(Boolean);
    for (const dir of candidates) {
      if (await exists(path.join(dir, "libclang.dll"))) {
        extra += `LIBCLANG_PATH = "${dir.replaceAll("\\", "/")}"\n`;
        console.log(`Using libclang from ${dir}`);
        break;
      }
    }
    if (!extra)
      console.warn("No libclang.dll found; set LIBCLANG_PATH manually (bindgen needs it).");
  }
  console.log("Windows native deps ready");
  return extra;
}

async function main() {
  await fs.mkdir(targetDir, { recursive: true });
  let cargoConfig = FFMPEG_CARGO_ENV;
  if (process.platform === "darwin") await setupMac();
  else if (process.platform === "win32") cargoConfig += await setupWindows();
  else
    throw new Error(`Unsupported platform ${process.platform} (Lare v1 targets macOS and Windows)`);

  await fs.mkdir(path.join(root, ".cargo"), { recursive: true });
  const configPath = path.join(root, ".cargo/config.toml");
  const existing = await fs.readFile(configPath, "utf8").catch(() => "");
  if (existing !== cargoConfig) {
    await fs.writeFile(configPath, cargoConfig);
    console.log(`Wrote ${path.relative(root, configPath)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
