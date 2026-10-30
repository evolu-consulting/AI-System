# Delivered DLC image: the engine is frozen in a build stage; the runtime stage receives only the built
# application (no engine sources). Build from Slaves/SDLC:  docker build -f packaging/Dockerfile -t dlc:<version> .
FROM python:3.12-slim AS build
# PyInstaller needs objdump (binutils) on Linux
RUN apt-get update && apt-get install -y --no-install-recommends binutils && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir pyinstaller
WORKDIR /src
COPY line ./line
COPY llm.py pricing.json ./
COPY packaging ./packaging
RUN python -m PyInstaller --noconfirm --clean --distpath /out --workpath /tmp/work packaging/dlc.spec \
 && ! find /out/dlc -name '*.py' -not -path '*/line/samples/*' | grep -q .

FROM debian:bookworm-slim
# git: target repositories; python3: Python targets' tests; node/npm and the claude CLI are optional
RUN apt-get update && apt-get install -y --no-install-recommends git python3 ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/dlc /opt/dlc
ENV DLC_HOME=/data LINE_HOST=0.0.0.0 LINE_PORT=8796 LINE_PYTHON=python3
VOLUME /data
EXPOSE 8796
ENTRYPOINT ["/opt/dlc/dlc"]
CMD ["serve", "--resume"]
