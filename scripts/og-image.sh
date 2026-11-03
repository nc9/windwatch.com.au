#!/usr/bin/env bash
# Regenerate public/og.png from a running `bun run preview` (port 4173).
# Needs agent-browser + imagemagick. Not used at runtime.
set -euo pipefail
tmp=$(mktemp -d)
agent-browser set viewport 1600 840
agent-browser open http://localhost:4173
sleep 7
agent-browser screenshot "$tmp/shot.png"
magick "$tmp/shot.png" -resize 1200x630! -colors 128 PNG8:public/og.png
agent-browser close
