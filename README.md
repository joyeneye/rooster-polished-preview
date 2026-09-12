# ROOSTER polished preview

This repository is the source snapshot for the independent [ROOSTER polished website preview](https://rooster-polished-preview.vercel.app/). It keeps the client's light cream, red, orange, and gold identity, the current ROOSTER concepts, and a shared presentation layer across the site.

The preview is a design comparison. Public content is read from the original site through a GET/HEAD-only adapter. Approved-account content remains protected. Sign-in, posting, messages, uploads, booking transactions, and live broadcasting are not connected here.

## Project boundaries

- This GitHub repository is separate from the original Netlify source and the newer ROOSTER Social design.
- Do not push this repository to the client's Netlify Git remote.
- The current Vercel preview was deployed independently. Creating this GitHub repository does not change its deployed files or automatically connect Git deployments.
- Work on a feature branch, then merge reviewed changes into `develop`.

## Build and checks

Install dependencies with `npm ci`. On Linux x64, `npm run build` runs the original production checks and creates `public/`. The media converter is generated during that build and is intentionally not stored in Git. On macOS, `node build.mjs` builds the site frontend; the original production prebuild requires Linux x64.

Run `node --test tests/polished-preview.test.mjs tests/editor-build-packaging.test.mjs` for the preview boundary and page-packaging checks.

See [POLISHED-PREVIEW.md](POLISHED-PREVIEW.md) for the design scope, data boundary, and earlier validation.
