# JWhite music and phone video repair

## Status

This is a repaired source candidate, NOT a published or fully production-validated website. No live member records, friendship records, stored posts, media or hosting configuration were modified from this session. The existing Netlify project must be used. Do not create a replacement site.

## Actual changes

1. Public profile videos accept original MP4, MOV, M4V or WebM containers up to 100 MiB (displayed as 100 MB). Verified members transfer bounded 2 MiB parts, and authenticated jobs convert the original on the server into H.264 video with AAC audio when audio is present. The browser no longer has to decode or transcode the upload. The original phone file is not modified. Published clips remain limited to 30 seconds; an actual 31-second clip is rejected instead of silently truncated. Prepared videos are limited to 12 MiB, with a maximum dimension of 1280 pixels. Original transfer parts remain temporary and are subject to existing cleanup.

2. Profile music accepts MP3 files up to 100 MiB, three songs per member, up to ten minutes each. The old 12 MiB moderation input mismatch was removed for songs. Large songs get a complete, smaller review copy instead of sending a truncated excerpt or bypassing review. If needed for hosting response limits, playback gets a complete 192 kbps stereo MP3 copy under 18 MiB. The original validated audio remains stored privately; its metadata is sanitized by the existing validator. Lower-bitrate review audio is not used for public playback. Original quality and public playback quality are not always identical. WAV/M4A support and a new member YouTube playlist editor are not part of this repair.

3. Long processing runs in a Netlify background function. The browser polls a private, authenticated job receipt. Transfer completion is not reported as publication. Duplicate submissions, account changes, ownership, processing errors and pending review are handled separately. Only a trusted approval creates public media. Missing or unavailable moderation remains private; the music editor now identifies a review service problem rather than calling it a file-size error.

4. Chat visibility is 60 seconds in both the browser and the server read path. Member names link to their profiles and a separate Message action opens the addressed member inbox. This is expiry from the visible room, not a guarantee that durable message storage is erased after 60 seconds.

5. Existing profile ownership, friend acceptance, walls, photo albums and filters from the starting source package were retained. They were not all independently retested in production. The new Invite Friends package discussed separately was not available in this starting archive and was not reconstructed here.

## Tests actually run

61 focused automated tests passed, with zero failures. These include 14 new job/transfer/chat tests, six tests using actual generated media and real FFmpeg, and 41 existing server/moderation tests.

Real processing samples:
- Generated 4K, 10-bit HEVC MOV with AAC sound became a 720 by 1280 H.264/AAC MP4. Its approximately 1.2-second duration and presence of audio were checked. This was not a recording submitted by the user or a test on a physical iPhone.
- An actual 30-second clip passed; an actual 31-second clip was rejected.
- A 23,922,981-byte MP3 with a approximately 598-second timeline completed part transfer, complete review-copy preparation, complete playback-copy preparation, public listing and playback response checks. Audio duration was preserved within the asserted tolerance.
- A full 100 MiB transport was assembled from 50 bounded parts in an in-memory store, and an upload one byte over the declared limit was rejected. This was a transfer boundary test, not a production-network or valid 100 MiB song decoding test.
- Chat remained visible at 59.999 seconds and was absent at 60 seconds and after a simulated reload.

Authentication, object storage and moderation decisions were injected/mocked. No actual provider classified these test files and no live content was published. Local FFmpeg was 7.1.5-0+deb13u1.

All 189 JavaScript/TypeScript/module files passed Node syntax checks. The deployment shell script passed bash syntax checking. All 38 explicitly copied build assets existed.

## Not yet verified

- Full npm/Netlify production build, bundling and deployment.
- The pinned ffmpeg-static 5.3.0 binary installed by the production prebuild step; local tests used the installed FFmpeg noted above.
- Netlify background invocation, storage credentials and runtime capacity under real traffic.
- Actual moderation provider availability, permissions, billing and account environment variables. The existing GEMINI_API_KEY and GOOGLE_GEMINI_BASE_URL configuration is preserved and must work in the background function. Do not paste keys into source or chat.
- Physical iPhone/Android gallery selection, native camera, actual failed user video, cross-device playback and real browser network behavior.

## Build and deployment

Use the existing Netlify project ID 77028a13-5642-4356-8be9-8c94cfcef4ca. Build on Linux x64 in Netlify or a Linux CI environment. Do not compile the converter on a Mac and deploy that binary to Linux.

The existing build command is `npm run build` and publish directory is `public`. The new prebuild step installs ffmpeg-static 5.3.0 in an isolated build directory, checks required encoders, and runs the 61 focused tests using that exact binary before the application build can proceed. The converter and license are included only with the media-process-background function. The application's dependency lockfile was not replaced.

For an already authenticated Linux runner, `bash scripts/deploy-existing-site.sh` installs locked dependencies and uses Netlify CLI to build and deploy to that exact project. It does not create a new project or change DNS. This script has NOT been executed from this environment. Its deployment needs authorized Netlify credentials supplied through the runner's standard login/secret configuration.

Do not treat a static HTML-only upload as deployment of this repair. The web assets and server functions, including the bundled Linux converter, must be built and deployed together.

The included `node scripts/verify-live-release.mjs` checks the release marker and confirms the processing-status route requires authentication. Passing that check is NOT proof that signed-in uploads, moderation, playback or physical phones work. A final production check must cover those paths before promotion.

The build has a test gate, so a dependency download, missing encoder or test failure stops publication rather than silently deploying half the update. The full build has not been run here: registry.npmjs.org failed DNS resolution, and the Netlify execution tool is disabled in this chat.

## Operational considerations

Server conversion, object storage, requests, bandwidth and moderation can consume hosting/provider credits. No paid service was purchased, plan upgraded or production resource changed in this session. Existing auth, moderation and ownership protections were retained.

## Public implementation references

- Netlify functions configuration and request/streaming limits: https://docs.netlify.com/build/functions/configuration/
- Netlify background functions: https://docs.netlify.com/build/functions/background-functions/
- Netlify CLI deploy behavior: https://cli.netlify.com/commands/deploy/
- ffmpeg-static package: https://www.npmjs.com/package/ffmpeg-static

See `repair-verification/combined-tests.log` and `repair-verification/syntax-checks.json` for the executed local checks.
