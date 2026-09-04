// @ts-check
// Downloads the prebuilt ffmpeg the vendored Cap crates (ffmpeg-next) link against
// and writes .cargo/config.toml with FFMPEG_DIR. Port of Cap's scripts/setup.js
// without the ONNX/sccache/Linux parts.
//
//   node scripts/setup-native-deps.mjs
//
// macOS:   spacedriveapp/native-deps (libav*, libsw*, libpostproc as a .framework)
// Windows: GyanD ffmpeg 7.1 full_build-shared (DLLs + import libs + headers)
import { exec as execCb, execFile as execFileCb } from "node:child_process";
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

async function download(url, dest) {
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

async function setupMac() {
  const VERSION = "v0.25";
  const asset = `native-deps-${arch}-darwin-apple.tar.xz`;
  const tarPath = path.join(targetDir, `${VERSION}-${asset}`);
  let fresh = false;
  if (!(await exists(tarPath))) {
    await download(
      `https://github.com/spacedriveapp/native-deps/releases/download/${VERSION}/${asset}`,
      tarPath,
    );
    fresh = true;
  } else console.log(`Using cached ${asset}`);

  const depsDir = path.join(targetDir, "native-deps");
  if (fresh || !(await exists(path.join(depsDir, "lib")))) {
    await fs.rm(depsDir, { recursive: true, force: true });
    await fs.mkdir(depsDir, { recursive: true });
    await execFile("tar", ["xf", tarPath, "-C", depsDir]);
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

async function setupWindows() {
  const FFMPEG_VERSION = "7.1";
  const zipName = `ffmpeg-${FFMPEG_VERSION}-full_build-shared`;
  const zipPath = path.join(targetDir, `ffmpeg-${FFMPEG_VERSION}.zip`);
  let fresh = false;
  if (!(await exists(zipPath))) {
    await download(
      `https://github.com/GyanD/codexffmpeg/releases/download/${FFMPEG_VERSION}/${zipName}.zip`,
      zipPath,
    );
    fresh = true;
  } else console.log("Using cached ffmpeg zip");
  const ffmpegDir = path.join(targetDir, "ffmpeg");
  if (fresh || !(await exists(ffmpegDir))) {
    await exec(`Expand-Archive -Path "${zipPath}" -DestinationPath "${targetDir}" -Force`, {
      shell: "powershell.exe",
    });
    await fs.rm(ffmpegDir, { recursive: true, force: true });
    await fs.rename(path.join(targetDir, zipName), ffmpegDir);
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
      console.warn(`Visual Studio LLVM component not found (${libclang}); falling back to the LLVM installer.`);
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
    if (!extra) console.warn("No libclang.dll found; set LIBCLANG_PATH manually (bindgen needs it).");
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
