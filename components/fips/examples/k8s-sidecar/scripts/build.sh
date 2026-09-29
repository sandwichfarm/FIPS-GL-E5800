#!/bin/bash
# Build the FIPS Kubernetes sidecar Docker image.
# The build happens entirely inside Docker (multi-arch friendly).
# Usage: ./scripts/build.sh [--tag TAG] [-- <extra docker buildx args>]
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCKER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$DOCKER_DIR/../.." && pwd)"

IMAGE_TAG="fips-k8s-sidecar:latest"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --tag) IMAGE_TAG="$2"; shift 2 ;;
        --) shift; break ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

if [ ! -f "$PROJECT_ROOT/Cargo.toml" ]; then
    echo "Error: Cannot find Cargo.toml at $PROJECT_ROOT" >&2
    echo "Expected layout: <project-root>/examples/k8s-sidecar/scripts/build.sh" >&2
    exit 1
fi

echo "Building Docker image: $IMAGE_TAG"
docker build \
    -t "$IMAGE_TAG" \
    -f "$DOCKER_DIR/Dockerfile" \
    "$@" \
    "$PROJECT_ROOT"

echo ""
echo "Done. Image: $IMAGE_TAG"
echo ""
echo "Push to your registry, then apply the example manifest:"
echo "  kubectl apply -f examples/k8s-sidecar/pod.yaml"
