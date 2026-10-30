# Linux x64 builds of the delivered DLC engine (`dlc`) and the default frontend (`dlc-fe`), as one-folder
# PyInstaller apps packed into tarballs. Nothing of ours ships as source (guards below fail the build).
# Built on Debian bookworm (glibc 2.36): runs on Debian 12+, Ubuntu 22.04+ (2.35 is checked at build time) and RHEL 9+.
#
#   docker build -f packaging/linux/Dockerfile --target out --output type=local,dest=dist/linux .    (from Slaves/SDLC)
#   -> dist/linux/dlc-<v>-linux-x64.tar.gz, dist/linux/dlc-fe-<v>-linux-x64.tar.gz
# Normally driven by packaging/linux/build_linux.ps1.

FROM node:22-bookworm-slim AS web
RUN corepack enable
WORKDIR /web
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN rm -rf dist && pnpm build && test -f dist/index.html

FROM python:3.12-slim-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends binutils && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir pyinstaller
WORKDIR /src
COPY line ./line
COPY *.py pricing.json schema.sql ./
COPY packaging ./packaging
COPY packaging_fe ./packaging_fe
COPY --from=web /web/dist ./web/dist

# engine
RUN python -m PyInstaller --noconfirm --clean --distpath /out --workpath /tmp/w1 packaging/dlc.spec \
 && if find /out/dlc -name '*.py' -not -path '*/line/samples/*' | grep -q .; then echo "SOURCE LEAK in dlc"; exit 1; fi \
 && /out/dlc/dlc version
# frontend
RUN python -m PyInstaller --noconfirm --clean --distpath /out --workpath /tmp/w2 packaging_fe/dlc_fe.spec \
 && if find /out/dlc-fe -name '*.py' | grep -q .; then echo "SOURCE LEAK in dlc-fe"; exit 1; fi \
 && test -f /out/dlc-fe/_internal/web/dist/index.html \
 && cp packaging/linux/fe.config.example.json /out/dlc-fe/ \
 && /out/dlc-fe/dlc-fe version
RUN V=$(python -c "import line; print(line.__version__)") && FV=$(python -c "import fe_bff; print(fe_bff.VERSION)") \
 && mkdir /pkg && tar -C /out -czf /pkg/dlc-$V-linux-x64.tar.gz dlc && tar -C /out -czf /pkg/dlc-fe-$FV-linux-x64.tar.gz dlc-fe \
 && ls -la /pkg

FROM scratch AS out
COPY --from=build /pkg/ /
