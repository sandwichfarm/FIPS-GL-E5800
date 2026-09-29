FROM rust:1.94.1-bookworm@sha256:6ae102bdbf528294bc79ad6e1fae682f6f7c2a6e6621506ba959f9685b308a55
ARG TARGETARCH

# Freeze the compiler's OS dependencies as well as Rust and Cargo.lock.
RUN rm -f /etc/apt/sources.list.d/debian.sources && \
    printf '%s\n' 'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/20260901T000000Z bookworm main' > /etc/apt/sources.list && \
    apt-get update && apt-get install -y --no-install-recommends \
      libclang-dev clang libdbus-1-dev pkg-config python3 python3-pil python3-numpy \
      nftables iproute2 iputils-ping dnsutils jq && \
    rm -rf /var/lib/apt/lists/*

ENV CARGO_HTTP_MULTIPLEXING=false
ENV CARGO_HTTP_TIMEOUT=300
ENV CARGO_HTTP_LOW_SPEED_LIMIT=1

# Cross-build OpenWrt's musl ABI with pinned tools. The archive digest comes
# from Zig's published 0.13.0 release index.
RUN rustup component add rustfmt clippy && \
    rustup target add aarch64-unknown-linux-musl && \
    cargo install cargo-zigbuild --version 0.19.8 --locked && \
    case "$TARGETARCH" in \
      arm64) zig_arch=aarch64; zig_sha=041ac42323837eb5624068acd8b00cd5777dac4cf91179e8dad7a7e90dd0c556 ;; \
      amd64) zig_arch=x86_64; zig_sha=d45312e61ebcc48032b77bc4cf7fd6915c11fa16e4aad116b66c9468211230ea ;; \
      *) echo "unsupported Docker architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac && \
    curl -fsSL --retry 3 "https://ziglang.org/download/0.13.0/zig-linux-${zig_arch}-0.13.0.tar.xz" -o /tmp/zig.tar.xz && \
    echo "$zig_sha  /tmp/zig.tar.xz" | sha256sum -c - && \
    mkdir -p /opt/zig && tar -xf /tmp/zig.tar.xz -C /opt/zig --strip-components=1 && \
    rm /tmp/zig.tar.xz

ENV PATH="/opt/zig:${PATH}"
WORKDIR /workspace
