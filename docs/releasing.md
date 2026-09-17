# Release process

## Branches

`main` is the release branch — it is always in a shippable state, and every commit on it
has been through the full CI matrix. `dev` is the shared integration branch.

```
feature work ──▶ dev ──(PR)──▶ main ──(tag)──▶ release
                 │  │           │
                 │  └─(dev tag)─┴──▶ dev release (prerelease, QA only)
            fast CI (~3 min)   full CI (~10 min)
```

- Push to `dev` freely. `ci-dev.yml` runs biome, `tsc`, the `@lare/shared` unit tests and
  a web build. That is enough to catch the things review does not.
- `git pull` from `dev` to QA each other's work locally before it is a release candidate.
- When `dev` is good, open a PR to `main`. `ci.yml` runs everything: the Rust matrix on
  macOS and Windows, the Playwright extension e2e, and production builds of the web app
  and the extension. This is the ~10 minute (warm) gate, and it is paid once per release rather
  than once per commit.
- Never push straight to `main`. The full matrix is the only thing standing between a
  commit and a signed build on someone's machine.

## QA without a release

Most fixes do not need a CI build at all. Where the wait actually goes (v0.4.4 release run):
Intel Mac 34 min, Windows 27 min, Apple Silicon 17 min, extension under 1 min. The `dev ->
main` PR CI is about 9 minutes warm.

- **`pnpm bundle`** builds this checkout into `out/`: `out/extension` (exactly what the release
  zip contains; load it unpacked, after removing the dev build, which shares its id) and the
  desktop app (`out/Lare.app` or `out/Lare/Lare.exe`). No release needed.
- On the Mac that is a real hardened-runtime `.app`, so TCC prompts, System Settings entries
  and relaunch behaviour are the real thing, and incremental rebuilds take minutes, not the 17 a
  cold CI runner needs. Set `APPLE_SIGNING_IDENTITY` to the certificate from
  [Signing keys](#signing-keys) (or name a keychain certificate "Lare Development") or every
  rebuild asks for permissions again. `--release` builds optimised.
- **Fresh-download install, updater, the other OS.** Only these need a dev release.

## Dev releases

A dev release is a QA build cut straight from `dev`, for installing the desktop app from a
fresh download on a machine you do not build on. It is **not** a shipping path — no PR to
`main`, no full CI matrix, nothing marked latest.

```
git tag dev-v0.4.4-1-mac && git push origin dev-v0.4.4-1-mac
```

Tag `dev-vX.Y.Z-N[-targets]` on a `dev` commit: `X.Y.Z` is the current app version, `N`
counts the QA builds cut against it, and the targets say what to build — any of `mac`
(Apple Silicon), `intel`, `win` and `ext` joined by `-`, or `all`. No targets means
`mac-win-ext`. Name only what the fix touches: `-mac` is roughly 15 minutes, `-ext` about one.

What it deliberately skips:

- **The `dev -> main` PR gate.** No Rust matrix beyond the build itself, no Playwright
  e2e, no lint or unit tests. Those protect `main`; a QA build does not need them.
- **LTO.** Release profile overrides turn it off and raise codegen units. The app behaves
  the same; it is just larger and marginally slower.
- **The Intel Mac**, unless asked for. It is by far the slowest runner.
- **`latest.json`.** The dev release carries only the downloads. Installed apps poll
  `releases/latest/download/latest.json`, and GitHub never resolves `latest` to a
  pre-release, so a dev build cannot reach anyone who did not download it by hand.

Because the app version stays `X.Y.Z`, a machine that installed `dev-v0.4.4-3` reports the
same version as the eventual `v0.4.4` and will not self-update onto it. QA machines
reinstall over the top when the real release ships.

Triggering is tag-only, on purpose: `workflow_dispatch` requires the workflow file to
exist on the default branch, and `dev-release.yml` lives only on `dev`.

## Cutting a release

1. Bump the version in **all four** files — they must agree, and the tag must match them:
   - `apps/desktop/package.json`
   - `apps/desktop/src-tauri/tauri.conf.json`  ← the workflow reads the tag check from here
   - `apps/desktop/src-tauri/Cargo.toml`
   - `apps/extension/package.json` — the extension carries the same number as the app it
     talks to, even when nothing in it changed, so a support question only ever needs one
     version.
2. Merge `dev` into `main` via the PR.
3. `git tag vX.Y.Z && git push origin vX.Y.Z`.

`release.yml` then builds installers for macOS (Apple Silicon + Intel) and Windows x64 and
the extension zip, signs the updater bundles with `TAURI_SIGNING_PRIVATE_KEY`, attaches
them with `gh release upload` (tauri-action's own GitHub uploader 500s on large parallel
uploads), writes `latest.json`, and publishes the GitHub release as **latest**. Running
the workflow with `workflow_dispatch` instead produces a draft that is never marked
latest — use that to inspect a build without shipping it.

If the tag and `tauri.conf.json` disagree, the workflow fails at the first step with the
mismatch printed. Fix the version, delete the tag, re-tag.

## Release notes format

Every release follows the same scaffold, so they are skimmable as a set:

```markdown
## Download

| Platform | File |
| --- | --- |
| macOS (Apple Silicon) | `Lare-macOS-AppleSilicon.dmg` |
| macOS (Intel) | `Lare-macOS-Intel.dmg` |
| Windows 10/11 (x64) | `Lare-Windows-x64-Setup.exe` |
| Chrome extension | `Lare-Chrome-Extension.zip` |

## Changes

- <one line per user-visible change>

## Fixes

- <one line per fix>
```

Builds are not notarised yet, so the download table is followed by the standard macOS
right-click-Open / Windows SmartScreen note that `release.yml` already writes.

## Release assets

The publish job trims the release down to exactly what is needed. Keep it that way:

| Asset | Why it is there |
| --- | --- |
| `Lare-macOS-AppleSilicon.dmg` | Stable download name, linked from the README |
| `Lare-macOS-Intel.dmg` | ″ |
| `Lare-Windows-x64-Setup.exe` | ″ |
| `Lare-Chrome-Extension.zip` | ″ |
| `latest.json` | The updater manifest the installed app polls on launch |
| `*_x64-setup.exe` + `.sig` | **Do not delete.** `latest.json` points at these by name |
| `*.app.tar.gz` + `.sig` | **Do not delete.** Same — this is the macOS updater bundle |

Everything else — duplicate versioned dmgs, the msi, the raw wxt extension zip — is
deleted automatically by the "Trim duplicate assets" step.

The versioned updater artifacts look redundant next to the stable names, and they are the
one thing on this list that is tempting to remove. They are what `tauri-plugin-updater`
actually downloads; deleting them silently breaks self-update for every installed app
while the release still looks correct. Source code archives are attached by GitHub itself
and cannot be turned off.

## Signing keys

The updater public key lives in `tauri.conf.json` (`plugins.updater.pubkey`); the private
half is the `TAURI_SIGNING_PRIVATE_KEY` repository secret, with its password in
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. **Losing the private key means every shipped app
stops accepting updates** — there is no recovery other than getting users to reinstall by
hand. Keep an offline backup.

### macOS code signing (why permissions reset on update)

macOS stores camera, microphone and screen-recording grants against the app's code
signature. Without a signing identity every build is ad-hoc signed with a different
signature, so **every update revokes all three**. Both release workflows sign with a stable
identity as soon as these secrets exist, and warn when they do not:

- `APPLE_CERTIFICATE` — base64 of a `.p12` holding a code-signing certificate and its key
- `APPLE_CERTIFICATE_PASSWORD` — the `.p12` password
- `APPLE_SIGNING_IDENTITY` — the certificate's common name

An Apple **Developer ID Application** certificate is the proper answer (it also enables
notarisation, which additionally needs `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID`).
Until there is one, a self-signed certificate keeps permissions across updates — the grant
follows the certificate, not the build — though Gatekeeper still needs right-click > Open:

```sh
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=Lare Signing" \
  -addext "extendedKeyUsage=codeSigning" -addext "keyUsage=digitalSignature" \
  -keyout lare.key -out lare.crt
openssl pkcs12 -export -legacy -inkey lare.key -in lare.crt -out lare.p12 -passout pass:CHOOSE
base64 -i lare.p12 | pbcopy   # APPLE_CERTIFICATE; APPLE_SIGNING_IDENTITY is "Lare Signing"
```

Keep the `.p12` with the updater key backup: a new certificate is a new signature, and
every Mac asks for permissions once more. Verify with a `-mac` dev release before relying
on it: install, grant, install the next dev release over it, and check nothing is asked
again.

## When a release goes wrong

- **A build failed on one platform.** The release stays a draft — the publish job requires
  every asset before it undrafts. Fix, delete the tag, re-tag.
- **Published a bad build.** Do not delete the release; installed apps are already polling
  it. Bump the patch version and ship a new one — the updater will roll users forward.
