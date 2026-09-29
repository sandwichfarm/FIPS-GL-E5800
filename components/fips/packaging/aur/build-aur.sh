#!/usr/bin/env bash
# Build the fips-git AUR package and validate with namcap.
#
# Usage: ./build-aur.sh
#
# Prerequisites: makepkg, namcap (pacman -S namcap)
# Output: fips-git-*.pkg.tar.zst in packaging/aur/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Ensure we're on Arch Linux with makepkg available
if ! command -v makepkg &>/dev/null; then
    echo "makepkg not found. This script requires Arch Linux." >&2
    exit 1
fi

if ! command -v namcap &>/dev/null; then
    echo "namcap not found. Install with: pacman -S namcap" >&2
    exit 1
fi

cd "${SCRIPT_DIR}"

echo "Building fips-git AUR package..."
makepkg -sf -p PKGBUILD-git

echo "Running namcap validation..."
namcap PKGBUILD-git
namcap fips-git-*.pkg.tar.zst

echo "Done."
