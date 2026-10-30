> **INTERNAL - do not ship to customers.** Developer documentation of the DLC engine (source layout, running
> from source, tests, simulator, packaging). Customers receive the built `dlc` application and the documents in
> `docs/dlc/` only.

# DLC engine: internal developer docs

| File | Content |
|---|---|
| [SETUP.md](SETUP.md) | full-stack developer setup from the source tree (engine, workflow tool, frontend, RAG system) |
| [dlc-reference/](dlc-reference/) | developer copies of the customer documents as of 2026-10-11, with source paths, module names, test commands and the seal integration plan (`file:function`) |
| this file | running from source, tests, packaging |

## Source layout

`Slaves/SDLC/line/` is the engine package (stdlib Python 3.10+): `server.py` (HTTP API, routes from
`api_spec.py`), `pipeline.py` (run driver), `understand/`, `understand_plus/`, `fgraph/`, `build/`, `review/`,
`ship/`, `learn/`, `migrate/`, `seal/`, `stacks/`, `rag/`, `llm/` (ports + prompts), `store.py`, `config.py`,
`app_main.py` (the `dlc` command), `flowhelper.py` (`dlc flow`), `runtime.py` (source vs frozen),
`samples/` (dry packs and fixtures used by tests and `dlc selfcheck`).

## Running from source

```
cd Slaves/SDLC
python -m line.app_main version          # same commands as the built `dlc`
python -m line.app_main serve --resume
python -m line.app_main selfcheck
```

`line/tools/dlc_flow.ps1` is a thin dev wrapper around `python -m line.app_main flow <mode>`.

## Tests

```
python -m unittest discover -s line/tests -t .              # full suite (~6 min)
python -m line.e2e.run_line_e2e base migrate migrate_estate conflict_park seal seal_taint
python -m line.chaos                                         # fault scenarios
python -m line.seal.sim --seeds 1 2 3 4 5 --stress           # seal / scan simulation
python -m line.seal.gitbench                                 # incremental scan on a real git repo
```

`line/tests/test_docs_no_source.py` keeps customer docs (`docs/dlc/`) free of source references;
`line/tests/test_api_spec.py` keeps the served API and `GET /api/openapi.json` identical.

## Packaging the delivered application

```
pwsh -File packaging/build_dlc.ps1        # Windows: dist/dlc/dlc.exe + dist/dlc-<version>-win64.zip
docker build -f packaging/Dockerfile -t dlc:<version> .     # Linux image, engine frozen in a build stage
```

The build fails if an engine `.py` file ends up in the package (the sample target apps under
`line/samples/` are data). In the frozen app `LINE_DB` / `LINE_WORKROOT` default into `DLC_HOME`, and Python
targets' tests run with `LINE_PYTHON` or the first `python` / `python3` / `py` on PATH.
