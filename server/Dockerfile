# Build context is server/ (see render.yaml). Migrations are embedded in the
# binary at compile time, so the runtime image needs only the binary and CA
# certificates for outbound TLS (Neon, Supabase, AssemblyAI).

FROM rust:1-slim-bookworm AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY migrations ./migrations
RUN cargo build --release --locked

FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 roxi
COPY --from=build /app/target/release/roxi-server /usr/local/bin/roxi-server
USER roxi
ENV LOG_FORMAT=json
EXPOSE 8080
CMD ["roxi-server"]
