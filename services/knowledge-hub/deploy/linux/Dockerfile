# Linux x64 build of the KnowledgeHub app (one-folder PyInstaller, same KnowledgeHub.spec as Windows) packed as a
# tarball for the DLC Linux deploy kit. CPU-only torch, no tray. Debian bookworm (glibc 2.36) base.
#
#   docker build -f deploy/linux/Dockerfile --target out --output type=local,dest=dist/linux .    (from Slaves/KnowledgeHub)
#   -> dist/linux/KnowledgeHub-linux-x64.tar.gz
FROM python:3.12-slim-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends binutils && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY requirements.txt /tmp/requirements.txt
# The same rewrite as deploy/docker/Dockerfile: CPU-only torch, no system tray (CRs first: CRLF on Windows).
RUN sed -E -e 's/\r$//' -e '/^\s*pystray/d' -e 's/^\s*torch==([^ #+]+).*/torch==\1+cpu/' /tmp/requirements.txt > /tmp/req.txt \
 && pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r /tmp/req.txt pyinstaller
COPY main.py preflight.py VERSION KnowledgeHub.spec ./
COPY app ./app
COPY seeds ./seeds
COPY assets ./assets
COPY models ./models
RUN python -m PyInstaller --noconfirm --clean --distpath /out --workpath /tmp/work KnowledgeHub.spec \
 && test -x /out/KnowledgeHub/KnowledgeHub \
 && test -d /out/KnowledgeHub/_internal/torch/utils/data \
 && if find /out/KnowledgeHub -name '*.py' -path '*/_internal/app/*' | grep -q .; then echo "SOURCE LEAK"; exit 1; fi \
 && mkdir /pkg && tar -C /out -czf /pkg/KnowledgeHub-linux-x64.tar.gz KnowledgeHub && ls -la /pkg

FROM scratch AS out
COPY --from=build /pkg/ /
