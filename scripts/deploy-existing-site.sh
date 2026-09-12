#!/usr/bin/env bash
# Run in an authenticated Linux x64 build environment. Never creates a site.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
  echo 'Build this package in Netlify or another Linux x64 build environment, not directly on a Mac or Windows computer.' >&2
  exit 1
fi
command -v node >/dev/null
command -v npm >/dev/null
npm ci --no-audit --no-fund
# Current Netlify CLI builds by default, including prebuild and its test gate.
npx --yes netlify-cli@latest deploy --prod --context production \
  --site 77028a13-5642-4356-8be9-8c94cfcef4ca \
  --message 'roster. member player design and song play counters'
node scripts/verify-live-release.mjs
