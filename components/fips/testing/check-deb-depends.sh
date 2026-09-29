#!/bin/bash
# Fail when a package's declared Depends does not match the libraries its
# binaries actually need.
#
# The package's Depends comes from cargo-deb's "$auto", which runs
# dpkg-shlibdeps over each binary. cargo-deb 3.6.3 changes that result in two
# ways, both silent. It removes every libgcc entry on the grounds that every
# system has one (src/dependencies.rs in the cargo-deb source), so the package
# never declared the libgcc-s1 its binaries link. And when dpkg-shlibdeps
# fails on a binary it prints a warning and builds anyway, leaving that
# binary's libraries out of the list. Neither shows up anywhere but in the
# field itself.
#
# This runs dpkg-shlibdeps once over every ELF object the package contains and
# compares the result with the Depends the package ships:
#
#   - every derived entry must be shipped;
#   - for a derived "name (>= v)", the highest ">=" floor shipped for that name
#     must EQUAL v. Below it, the package installs where the binaries cannot
#     run. Above it, a hand-written floor no longer tracks what the binaries
#     need. There is no exception for any name;
#   - shipped entries that nothing derives (systemd) are listed, not failed:
#     they are the ones written by hand, and Cargo.toml says why each is there.
#
# libgcc-s1 is written by hand in Cargo.toml beside "$auto" because cargo-deb
# drops it. The equality rule is what keeps that hand-written floor honest: if
# the toolchain stops needing it, or starts needing a newer one, this fails.
#
# Run it inside the build image (build-deb-container.sh does), so the symbols
# files and the C library it reads are the ones cargo-deb read. On a host of a
# different distribution a difference could come from the host instead.
#
# Usage: check-deb-depends.sh <package.deb>...
# Exit: 0 every package matches, 1 a mismatch, 2 could not establish a result.

set -euo pipefail

for tool in dpkg dpkg-deb dpkg-query dpkg-shlibdeps readelf; do
    command -v "$tool" >/dev/null 2>&1 || {
        echo "check-deb-depends: $tool is not installed; cannot check anything." >&2
        echo "                   Refusing to report a pass I did not establish." >&2
        exit 2
    }
done

[ $# -gt 0 ] || {
    echo "usage: check-deb-depends.sh <package.deb>..." >&2
    exit 2
}

FAILED=0
UNKNOWN=0
CHECKED=0

# A relation list entry of the simple forms dpkg-shlibdeps prints: a bare name
# or "name (>= version)". Anything else is compared word for word.
SIMPLE_RE='^([a-z0-9][a-z0-9+.-]*)( \(>= ([^)]+)\))?$'

# Split a Depends value on commas into one trimmed entry per line.
split_deps() {
    printf '%s\n' "$1" | tr ',' '\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | sed '/^$/d'
}

check_deb() {
    local deb="$1" label tmp arch shipped derived out
    label=$(basename "$deb")
    tmp=$(mktemp -d)
    # shellcheck disable=SC2064
    trap "rm -rf '$tmp'" RETURN

    if ! dpkg-deb -x "$deb" "$tmp/root"; then
        echo "  ERROR $label could not be unpacked" >&2
        UNKNOWN=$((UNKNOWN + 1))
        return
    fi
    arch=$(dpkg-deb -f "$deb" Architecture)
    shipped=$(dpkg-deb -f "$deb" Depends)
    if [ -z "$arch" ]; then
        echo "  ERROR $label has no Architecture field" >&2
        UNKNOWN=$((UNKNOWN + 1))
        return
    fi

    # The same filter as check-glibc-floor.sh: executable files that parse as
    # ELF. A shared library shipped later is executable too, so it is covered.
    local bins=() f
    while IFS= read -r -d '' f; do
        readelf -hW "$f" >/dev/null 2>&1 || continue
        bins+=("$f")
    done < <(find "$tmp/root" -type f -perm -u+x -print0 | sort -z)
    if [ "${#bins[@]}" -eq 0 ]; then
        echo "  ERROR $label contains no ELF objects; the layout moved and nothing was checked" >&2
        UNKNOWN=$((UNKNOWN + 1))
        return
    fi

    # dpkg-shlibdeps needs a debian/control in its working directory, and an
    # empty one is enough; cargo-deb sets it up the same way. DEB_HOST_ARCH is
    # set as cargo-deb sets it, so a foreign-architecture package is resolved
    # against that architecture's symbols files, not the host's.
    mkdir -p "$tmp/work/debian"
    : > "$tmp/work/debian/control"
    if ! out=$(cd "$tmp/work" && DEB_HOST_ARCH="$arch" dpkg-shlibdeps -O "${bins[@]}" 2>"$tmp/shlibdeps.err"); then
        echo "  ERROR $label: dpkg-shlibdeps failed:" >&2
        sed 's/^/        /' "$tmp/shlibdeps.err" >&2
        UNKNOWN=$((UNKNOWN + 1))
        return
    fi
    derived=$(printf '%s\n' "$out" | sed -n 's/^shlibs:Depends=//p' | head -n 1)
    if [ -z "$derived" ]; then
        echo "  ERROR $label: dpkg-shlibdeps derived no dependencies for ${#bins[@]} ELF object(s)" >&2
        UNKNOWN=$((UNKNOWN + 1))
        return
    fi

    echo "  $label ($arch, ${#bins[@]} ELF objects)"
    echo "    derived: $derived"
    echo "    shipped: $shipped"

    # Index the shipped list: the highest ">=" floor per name, the names
    # present at all, and every entry verbatim.
    declare -A floor=() present=() verbatim=() derivednames=()
    local e name ver
    while IFS= read -r e; do
        verbatim["$e"]=1
        [[ "$e" =~ $SIMPLE_RE ]] || continue
        name="${BASH_REMATCH[1]}"
        ver="${BASH_REMATCH[3]}"
        present["$name"]=1
        [ -n "$ver" ] || continue
        if [ -z "${floor[$name]:-}" ] || dpkg --compare-versions "$ver" gt "${floor[$name]}"; then
            floor["$name"]="$ver"
        fi
    done < <(split_deps "$shipped")

    local bad=0 have
    while IFS= read -r e; do
        if ! [[ "$e" =~ $SIMPLE_RE ]]; then
            if [ -n "${verbatim[$e]:-}" ]; then
                echo "    ok    $e"
            else
                echo "  FAIL $label: derived '$e' not matched by shipped Depends (missing: $shipped)" >&2
                bad=1
            fi
            continue
        fi
        name="${BASH_REMATCH[1]}"
        ver="${BASH_REMATCH[3]}"
        derivednames["$name"]=1
        if [ -z "${present[$name]:-}" ]; then
            echo "  FAIL $label: derived '$e' not matched by shipped Depends (missing: $shipped)" >&2
            bad=1
            continue
        fi
        if [ -z "$ver" ]; then
            echo "    ok    $e"
            continue
        fi
        have="${floor[$name]:-}"
        if [ -z "$have" ]; then
            echo "  FAIL $label: derived '$e' not matched by shipped Depends (below: $name with no version floor)" >&2
            bad=1
        elif dpkg --compare-versions "$have" lt "$ver"; then
            echo "  FAIL $label: derived '$e' not matched by shipped Depends (below: $name (>= $have))" >&2
            bad=1
        elif dpkg --compare-versions "$have" gt "$ver"; then
            echo "  FAIL $label: derived '$e' not matched by shipped Depends (above: $name (>= $have))" >&2
            bad=1
        else
            echo "    ok    $e"
        fi
    done < <(split_deps "$derived")

    while IFS= read -r e; do
        if [[ "$e" =~ $SIMPLE_RE ]] && [ -n "${derivednames[${BASH_REMATCH[1]}]:-}" ]; then
            continue
        fi
        echo "    hand-declared $e"
    done < <(split_deps "$shipped")

    CHECKED=$((CHECKED + 1))
    [ "$bad" -eq 0 ] || FAILED=$((FAILED + 1))
}

echo "=== Depends check (shipped Depends against dpkg-shlibdeps) ==="
for arg in "$@"; do
    if [ ! -f "$arg" ]; then
        echo "  ERROR $arg does not exist" >&2
        UNKNOWN=$((UNKNOWN + 1))
        continue
    fi
    check_deb "$arg"
done

if [ "$FAILED" -ne 0 ]; then
    echo "check-deb-depends: $FAILED of $CHECKED package(s) declare Depends that differ from what their binaries need." >&2
    echo "  A missing or low entry installs where the binaries cannot run; a high one" >&2
    echo "  is a hand-written floor that no longer tracks them. Fix Cargo.toml's depends." >&2
    exit 1
fi

# Anything not established, or nothing examined at all, is not a pass.
if [ "$UNKNOWN" -ne 0 ] || [ "$CHECKED" -eq 0 ]; then
    echo "check-deb-depends: could not establish a result ($UNKNOWN error(s), $CHECKED package(s) checked); refusing to report a pass." >&2
    exit 2
fi

echo "=== Depends check passed ($CHECKED package(s)) ==="
