# HUB-BR-33 · WRK-FR-28 · ADR-0011 #5 · plan-runtime §5.10 — ảnh sandbox job tự-sửa
# `ai-autofix-sandbox:<semver>`. Dựng: `bun run sandbox:image` (đọc phiên bản bun từ `packageManager`
# gốc + SHA256 từ SHASUMS256.txt của bản phát hành, truyền --build-arg). Không chứa secret.
# Hai stage: `fetch` (curl/xz/unzip, kiểm checksum) → `final` chỉ chép nhị phân (giữ ảnh nhỏ).

ARG DEBIAN=debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587

FROM ${DEBIAN} AS fetch
ARG TARGETARCH
ARG NODE_VERSION=22.23.3
ARG NODE_SHA256_AMD64=df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de
ARG NODE_SHA256_ARM64=a44aeb94849a299b22df10b9e622ec2f605c2183501bc40590705131de7c740f
ARG BUN_VERSION
ARG BUN_SHA256
RUN test -n "$BUN_VERSION" && test -n "$BUN_SHA256" \
 && apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends ca-certificates curl xz-utils unzip >/dev/null \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /dl
RUN set -eu; \
    case "${TARGETARCH:-amd64}" in \
      amd64) n=x64; nsum=$NODE_SHA256_AMD64; b=x64 ;; \
      arm64) n=arm64; nsum=$NODE_SHA256_ARM64; b=aarch64 ;; \
      *) echo "arch $TARGETARCH không hỗ trợ" >&2; exit 1 ;; \
    esac; \
    curl -fsSLo node.tar.xz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${n}.tar.xz"; \
    echo "${nsum}  node.tar.xz" | sha256sum -c -; \
    mkdir -p /out/node && tar -xJf node.tar.xz -C /out/node --strip-components=1; \
    rm -rf /out/node/include /out/node/share /out/node/CHANGELOG.md /out/node/README.md; \
    curl -fsSLo bun.zip "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-${b}.zip"; \
    echo "${BUN_SHA256}  bun.zip" | sha256sum -c -; \
    unzip -q bun.zip && install -m 0755 "bun-linux-${b}/bun" /out/bun

FROM ${DEBIAN}
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends ca-certificates git ripgrep python3 >/dev/null \
 && rm -rf /var/lib/apt/lists/* /usr/share/doc/* /usr/share/man/* /usr/share/info/* \
 && groupadd -g 1000 sandbox && useradd -u 1000 -g 1000 -M -d /tmp -s /bin/sh sandbox \
 && mkdir -p /workspace && chown 1000:1000 /workspace
COPY --from=fetch /out/node /usr/local/
COPY --from=fetch /out/bun /usr/local/bin/bun
RUN ln -s bun /usr/local/bin/bunx && node --version && bun --version
ENV HOME=/tmp LANG=C.UTF-8 CI=1
USER 1000:1000
WORKDIR /workspace
CMD ["sleep", "infinity"]
