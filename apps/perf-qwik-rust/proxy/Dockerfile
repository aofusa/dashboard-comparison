# perf_pingora_proxy — HTTP/1.1 リバースプロキシ（Pingora）
FROM rust:1.84-bookworm AS builder
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/target/release/perf_pingora_proxy /usr/local/bin/
COPY config/pingora.yaml /etc/pingora/pingora.yaml
ENV RUST_LOG=info
EXPOSE 9080
ENTRYPOINT ["/usr/local/bin/perf_pingora_proxy", "-c", "/etc/pingora/pingora.yaml"]
