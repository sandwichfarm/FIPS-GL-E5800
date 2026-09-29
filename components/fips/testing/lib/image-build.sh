#!/bin/bash
# Shared helpers for building test images and starting test containers.
#
# Source this file to get dump_output(), run_quiet(), build_inline() and
# retry_build():
#   source "$SCRIPT_DIR/../lib/image-build.sh"
#   echo "$dockerfile" | run_quiet "docker build -t $tag" \
#       docker build -t "$tag" -f - "$REPO_ROOT"
#   retry_build "docker build $tag" docker build -t "$tag" "$context"
#
# A build or a container start that fails for a reason outside the project,
# such as a registry timeout, is indistinguishable from one the project caused
# unless its output survives. dump_output and run_quiet keep a command quiet
# when it succeeds and print everything it said when it fails.
#
# Image builds reach Docker Hub, ghcr.io and distribution mirrors, and every one
# of those has timed out or served a truncated file in CI for a few seconds at a
# time. retry_build runs a whole build again after such a failure, so the base
# image is resolved again and each RUN step that fetched packages runs again.

# Emit a captured output file to stderr, delimited and labelled with the
# command it came from. Callers use this only on failure: a command that
# succeeds leaves no trace, so the suite stays quiet when it is green.
dump_output() {
    local label="$1" file="$2"
    {
        echo "  --- $label failed; captured output follows ---"
        if [ -s "$file" ]; then
            cat "$file"
        else
            echo "  (no output)"
        fi
        echo "  --- end captured output ---"
    } >&2
}

# Run a command with both streams captured. Discard the capture on success;
# on failure emit it, so the reason a build or a container start died is not
# thrown away. Stdin is inherited, so a caller may pipe into it.
run_quiet() {
    local label="$1"
    shift
    local out rc=0
    out=$(mktemp)
    "$@" >"$out" 2>&1 || rc=$?
    [ "$rc" -eq 0 ] || dump_output "$label" "$out"
    rm -f "$out"
    return "$rc"
}

# Build TAG from the Dockerfile text DOCKERFILE with context CONTEXT, output
# captured by run_quiet. The text is an argument rather than stdin, so that
# retry_build can run the build again: a pipe can be read only once.
build_inline() {
    local tag="$1" dockerfile="$2" context="$3"
    echo "$dockerfile" | run_quiet "docker build -t $tag" \
        docker build -t "$tag" -f - "$context"
}

# Run an image build, and run it again after a failure, up to three attempts
# with 10 s and then 20 s between them. Use it for builds only: a test or a
# container start that fails is a result, and running it again would hide it.
#
# Every message goes to stderr, because some callers promise that their stdout
# holds only their result. A first-attempt success prints nothing. A success
# after a failure says so, and on GitHub Actions also raises a warning on the
# run summary, so a recovered failure is still counted. Returns the last
# attempt's exit status.
retry_build() {
    local label="$1"
    shift
    local attempts=3 attempt=1 rc=0 wait
    while true; do
        rc=0
        if "$@"; then
            if [ "$attempt" -gt 1 ]; then
                echo "image-build: $label recovered on attempt $attempt of $attempts" >&2
                if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
                    echo "::warning::image-build: $label recovered on attempt $attempt of $attempts" >&2
                fi
            fi
            return 0
        else
            rc=$?
        fi
        if [ "$attempt" -ge "$attempts" ]; then
            echo "image-build: $label failed on all $attempts attempts (last exit $rc)" >&2
            return "$rc"
        fi
        wait=$((attempt * 10))
        echo "image-build: $label failed on attempt $attempt of $attempts (exit $rc); retrying in ${wait}s" >&2
        sleep "$wait"
        attempt=$((attempt + 1))
    done
}
