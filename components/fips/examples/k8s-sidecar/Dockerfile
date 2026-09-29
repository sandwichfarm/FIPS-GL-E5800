# -----------------------------------------------------------------------------
# Stage 1 — build
# Compile fips and fipsctl inside a Rust toolchain image so no local Rust
# install is needed and the image is fully reproducible.
# -----------------------------------------------------------------------------
FROM rust:slim-trixie AS builder

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        pkg-config \
        libssl-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy the full workspace source. .dockerignore filters target/ and other
# large paths so the context stays small.
COPY . .

# Build only the two binaries needed at runtime; skip the TUI (fipstop)
# to avoid pulling in ratatui and crossterm. The daemon does not require
# any default features to run.
RUN cargo build --release --no-default-features \
        --bin fips \
        --bin fipsctl

# -----------------------------------------------------------------------------
# Stage 2 — runtime
# Minimal Debian image with only the packages required at runtime.
# -----------------------------------------------------------------------------
FROM debian:trixie-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        iproute2 \
        iptables \
        dnsmasq \
        procps \
        curl && \
    rm -rf /var/lib/apt/lists/*

# dnsmasq: forward .fips queries to the FIPS daemon DNS resolver;
# forward everything else to the upstream resolver passed in at runtime.
# The upstream placeholder is replaced by entrypoint.sh with the pod's
# original nameserver(s) from /etc/resolv.conf before dnsmasq starts.
RUN printf '%s\n' \
    'port=53' \
    'listen-address=127.0.0.1' \
    'bind-interfaces' \
    'server=/fips/127.0.0.1#5354' \
    'no-resolv' \
    > /etc/dnsmasq.d/fips.conf

COPY --from=builder /build/target/release/fips    /usr/local/bin/fips
COPY --from=builder /build/target/release/fipsctl /usr/local/bin/fipsctl

COPY examples/k8s-sidecar/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD fipsctl show status

ENTRYPOINT ["/entrypoint.sh"]
