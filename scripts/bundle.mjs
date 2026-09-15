#!/usr/bin/env node
// Build the desktop app and the Chrome extension from this checkout into one folder, `out/`:
//
//   out/Lare.app        (macOS)    or    out/Lare/Lare.exe   (Windows)
//   out/extension/      load unpacked at chrome://extensions
//
//   pnpm bundle                 app + extension, debug app build (fast)
//   pnpm bundle ext             extension only
//   pnpm bundle app --release   optimised app only
//   pnpm bundle --open          launch the app when done
//
// Not a release: no version bump, no updater artifacts, no CI. On macOS the app is a real .app
// bundle because camera/microphone/screen permissions are granted to the bundle, not to a bare
// `tauri dev` binary. Sign it with a stable identity (APPLE_SIGNING_IDENTITY, or a keychain
// certificate named "Lare Development") or macOS asks again after every rebuild.

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "out");
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const picked = args.filter((a) => !a.startsWith("--"));
const wantApp = picked.length === 0 || picked.includes("app");
const wantExt = picked.length === 0 || picked.includes("ext");
const release = flags.has("--release");
const mac = process.platform === "darwin";
const win = process.platform === "win32";

for (const a of picked)
  if (a !== "app" && a !== "ext") fail(`unknown target "${a}" (use app, ext, or nothing for both)`);

// Public client configuration, identical to the release workflows. Only used when the app has no
// .env of its own, so a checkout pointed at a local Supabase keeps pointing there.
const PUBLIC_ENV = {
  desktop: {
    VITE_SUPABASE_URL: "https://jndqrvwkwoyvzoqcveev.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_nsqHiRNIbrFvs1Y3nxpl3Q_xG2vqS9Q",
    VITE_SITE_URL: "https://lare-one.vercel.app",
    VITE_BUNNY_LIBRARY_ID: "743884",
  },
  extension: {
    WXT_SUPABASE_URL: "https://jndqrvwkwoyvzoqcveev.supabase.co",
    WXT_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_nsqHiRNIbrFvs1Y3nxpl3Q_xG2vqS9Q",
    WXT_SITE_URL: "https://lare-one.vercel.app",
  },
};

function fail(message) {
  console.error(`bundle: ${message}`);
  process.exit(1);
}

function envFor(app) {
  const dir = path.join(root, "apps", app);
  const hasOwn = [".env", ".env.local", ".env.production", ".env.production.local"].some((f) =>
    existsSync(path.join(dir, f)),
  );
  if (hasOwn) return process.env;
  console.log(`bundle: apps/${app} has no .env, using the production Supabase project`);
  return { ...PUBLIC_ENV[app], ...process.env };
}

function run(cmd, cmdArgs, env = process.env) {
  console.log(`\n$ ${cmd} ${cmdArgs.join(" ")}`);
  const options = { cwd: root, env, stdio: "inherit" };
  // pnpm is a .cmd shim on Windows, which only resolves through a shell.
  const result = win
    ? spawnSync([cmd, ...cmdArgs.map((a) => (/[\s"]/.test(a) ? `"${a}"` : a))].join(" "), {
        ...options,
        shell: true,
      })
    : spawnSync(cmd, cmdArgs, options);
  if (result.status !== 0) fail(`${cmd} ${cmdArgs[0] ?? ""} failed`);
}

async function buildExtension() {
  run("pnpm", ["--filter", "@lare/extension", "build"], envFor("extension"));
  const dest = path.join(out, "extension");
  await rm(dest, { recursive: true, force: true });
  await cp(path.join(root, "apps/extension/.output/chrome-mv3"), dest, { recursive: true });
  return dest;
}

function signingIdentity() {
  if (process.env.APPLE_SIGNING_IDENTITY) return process.env.APPLE_SIGNING_IDENTITY;
  const found = spawnSync("security", ["find-identity", "-v", "-p", "codesigning"], {
    encoding: "utf8",
  });
  return found.stdout?.includes('"Lare Development"') ? "Lare Development" : null;
}

async function buildApp() {
  if (!mac && !win) fail("the desktop app builds on macOS and Windows only");
  const nativeDeps = mac ? "target/native-deps" : "target/ffmpeg";
  if (!existsSync(path.join(root, nativeDeps))) run("node", ["scripts/setup-native-deps.mjs"]);

  // Updater artifacts need the release signing key, and a local build never feeds the updater.
  const config = path.join(out, ".tauri-bundle.json");
  await mkdir(out, { recursive: true });
  await writeFile(config, JSON.stringify({ bundle: { createUpdaterArtifacts: false } }));

  const env = { ...envFor("desktop") };
  if (mac) {
    const identity = signingIdentity();
    if (identity) {
      console.log(`bundle: signing with "${identity}"`);
      env.APPLE_SIGNING_IDENTITY = identity;
    } else {
      console.warn("bundle: no signing identity; macOS permissions reset on every rebuild");
    }
  }
  const tauriArgs = ["--filter", "@lare/desktop", "tauri", "build", "--config", config];
  if (!release) tauriArgs.push("--debug");
  tauriArgs.push(...(mac ? ["--bundles", "app"] : ["--no-bundle"]));
  run("pnpm", tauriArgs, env);
  await rm(config, { force: true });

  const profile = path.join(root, "target", release ? "release" : "debug");
  if (mac) {
    const dest = path.join(out, "Lare.app");
    await rm(dest, { recursive: true, force: true });
    // ditto keeps the bundle's symlinks, extended attributes and code signature intact.
    run("ditto", [path.join(profile, "bundle/macos/Lare.app"), dest]);
    return dest;
  }
  // A portable folder: the executable plus the ffmpeg DLLs the installer would put beside it.
  const dest = path.join(out, "Lare");
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  await cp(path.join(profile, "lare-desktop.exe"), path.join(dest, "Lare.exe"));
  const dlls = path.join(root, "target/ffmpeg/bin");
  for (const name of await readdir(dlls))
    if (name.endsWith(".dll")) await cp(path.join(dlls, name), path.join(dest, name));
  return path.join(dest, "Lare.exe");
}

function open(app) {
  if (mac) {
    // A running copy holds the single-instance lock and would swallow the new window.
    spawnSync("osascript", ["-e", 'tell application "Lare" to quit']);
    spawnSync("open", [app], { stdio: "inherit" });
  } else {
    spawnSync("taskkill", ["/IM", "Lare.exe", "/F"], { stdio: "ignore" });
    spawn(app, [], { detached: true, stdio: "ignore" }).unref();
  }
}

const built = [];
if (wantExt) built.push(["Chrome extension", await buildExtension()]);
if (wantApp) {
  const app = await buildApp();
  built.push([`Desktop app (${release ? "release" : "debug"})`, app]);
  if (flags.has("--open")) open(app);
}

console.log("\nbundle: done\n");
for (const [label, where] of built)
  console.log(`  ${label.padEnd(24)} ${path.relative(root, where)}`);
if (wantExt)
  console.log(
    "\n  Extension: chrome://extensions > Developer mode > Load unpacked > out/extension" +
      "\n  (it shares an id with the dev build, so remove that one first; press reload after rebuilding)",
  );
