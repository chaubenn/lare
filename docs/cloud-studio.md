# Cloud Studio Imports

Desktop Studio can download an owner's cloud video as an **encoded MP4 copy**.
It does not claim to recover an original recording or separate camera/microphone
layers. Import creates a new local project, preserves audio, and leaves the cloud
video unchanged. Publishing an edit uses the existing new-video upload flow.
Imports are limited to 4 GiB and one hour; interrupted/invalid imports are removed.

## Required Deployment Settings

1. Deploy `bunny-download-source` alongside the other Supabase Edge Functions.
2. Set `BUNNY_LIBRARY_ID`, library-scoped `BUNNY_STREAM_API_KEY`, `BUNNY_CDN_HOST`
   (bare `*.b-cdn.net` hostname) and `SITE_URL` in function secrets or Vault.
   `SITE_URL` is sent as the `Referer` on both the probe and the desktop download;
   it is the header the library gates on, not an origin check anyone verifies.
3. Enable H.264 (`x264`), MP4 Fallback, and at least one resolution at or below
   1080p **before upload**. The endpoint checks `hasMP4Fallback`, `outputCodecs`,
   available resolutions and actual CDN availability, selecting the highest
   supported resolution. DRM-protected/unavailable sources fail without bypass.

Authorization checks the authenticated user's `videos.user_id`, even for public
posts, and requires the configured library. Clients cannot supply a Bunny ID or
source host to the endpoint. Responses are `no-store`; native download rejects
redirects and any URL carrying a query string.

## Do Not Enable CDN Token Authentication

An earlier version of this document required it, and the endpoint was built to
sign exact-file HMAC tokens. **That does not work for this library, and turning it
on takes playback down.**

CDN token authentication applies to every direct URL on the pull zone, including
the HLS playlist and segments that Bunny's own embed player fetches. The player
cannot sign them. Measured against pull zone `vz-ad1b2c2a-128`, with the player's
own `Referer`:

| request | token auth off | token auth on |
| --- | --- | --- |
| `playlist.m3u8` | 200 | **403** |
| `play_720p.mp4` | 200 | **403** |

Bunny's documentation frames CDN token authentication as being for "your own
video player or custom solution", and warns that pull-zone controls can block
Stream playback independently of library security settings. Lare uses the embed
player, so the two are mutually exclusive. Choosing the embed player means direct
files are guarded only by the library's referrer rule.

**What that rule is worth:** `BlockNoneReferrer` is on and the allowed-domain list
is empty, so a request with no `Referer` is refused and a request with *any*
`Referer` is served — `totally-unrelated.test` included. The GUID is therefore the
real secret. It is a UUIDv4, so nothing is enumerable, but everyone authorized to
watch a video receives it. The consequence is written down in `docs/privacy.md`
rather than hidden here; do not describe these links as expiring or as capabilities.

## Originals and Existing Videos

Bunny documents `/{video_id}/original`, but **Keep Original Files** must have been
enabled before upload and CDN exposure is a separate setting (`ExposeOriginals`).

`ExposeOriginals` is separate but **not independent**: Bunny forces it on when
**Allow Early Play** is enabled, and refuses to turn it off while Early Play
stays on (`VideoLibrary.ExposeOriginalsAndEarlyPlayConflict` — "Expose Originals
is a prerequisite for Early Play"). Enabling Early Play to shorten the encode
wait therefore also enables it, without asking. That is harmless while
`KeepOriginalFiles` is false, because no original exists to serve — but the two
settings must be reasoned about together, and turning `KeepOriginalFiles` on
later would publish originals at a guessable path with only CDN token
authentication in front of them.
This implementation intentionally uses a known MP4 rendition rather than assuming
an original is available, exposed, or in a format the native editor supports.
Enabling MP4 Fallback now does not retroactively create files. Existing videos
may need re-encoding from a retained original, or re-upload from a source the owner
still has. If neither exists, the app reports source unavailable; playback alone
is not evidence of an editable/downloadable MP4.

## Verified Bunny Documentation

- [MP4 fallback prerequisites and paths](https://bunny.net/docs/stream/mp4-downloads)
- [Get Video metadata](https://bunny.net/docs/api-reference/stream/manage-videos/get-video)
- [Original storage path](https://bunny.net/docs/stream/storage-structure#original-file-url)
- [Original retention](https://bunny.net/docs/stream/encoding#keep-original-files)
- [CDN security versus iframe tokens](https://bunny.net/docs/stream/security#cdn-token-authentication)
- [Exact-file HMAC-SHA256 tokens](https://bunny.net/docs/cdn/security/token-authentication/advanced)

Live end-to-end validation requires a configured/deployed library and an owner
account with a supported video. Unit tests are not evidence of live availability.
