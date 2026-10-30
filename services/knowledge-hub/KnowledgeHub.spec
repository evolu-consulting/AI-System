# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all, collect_submodules

datas = [('assets', 'assets'), ('models', 'models')]
binaries = []
hiddenimports = ['app.config', 'app.vector_store', 'app.hotlog', 'app.graph_db', 'app.graph_db.base', 'app.graph_db.kuzu_adapter', 'app.graph_db.project_graph', 'app.retriever', 'app.schemas', 'app.chunker', 'app.extractor', 'app.prompts', 'app.db', 'app.vision', 'app.orchestrator', 'app.layers', 'app.revisions', 'app.hooks', 'app.hooks.store', 'app.hooks.api', 'app.personalization', 'app.codegraph', 'app.embeddings', 'app.projects', 'app.policy', 'app.routing', 'app.feedback', 'preflight', 'uvicorn.logging', 'uvicorn.loops', 'uvicorn.loops.auto', 'uvicorn.protocols', 'uvicorn.protocols.http', 'uvicorn.protocols.http.auto', 'uvicorn.protocols.websockets', 'uvicorn.protocols.websockets.auto', 'uvicorn.lifespan', 'uvicorn.lifespan.on', 'psutil']
# Explicitly collect the additive subpackages so the frozen exe never misses a
# lazily/function-level imported submodule (taxonomy router/adapters/edges, revisions,
# codegraph import, embedding adapters).
# Every app module (caps, sync, step, distill, ... are imported lazily in places) and the non-Python files the
# code reads at run time: route rules, the /home page, cap data and the seeds (2026-10-11).
hiddenimports += collect_submodules('app')
# collect_submodules silently skips a module whose import fails in its probe process; the capability modules are
# imported by name at run time (app/caps/__init__.py MODULES), so name every one of them (2026-10-12: records,
# packs, vault, outbox and lifecycle were missing from the exe).
import glob as _glob, os as _os
hiddenimports += ['app.caps.' + _os.path.splitext(_os.path.basename(_p))[0]
                  for _p in _glob.glob(_os.path.join('app', 'caps', '*.py')) if not _p.endswith('__init__.py')]
datas +=[('app/auth_rules.json', 'app'), ('app/static', 'app/static'), ('app/caps/data', 'app/caps/data'),
          ('seeds', 'seeds')]
hiddenimports += collect_submodules('app.revisions')
hiddenimports += collect_submodules('app.codegraph')
hiddenimports += collect_submodules('app.embeddings')
tmp_ret = collect_all('chromadb')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('sentence_transformers')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('transformers')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('tokenizers')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('huggingface_hub')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('PIL')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]


a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
    # Several scientific/ML packages run module-level code that writes globals
    # dynamically (`for name in ...: vars()[name] = ...`) or cleans up a loop var
    # (`del obj`). PyInstaller's frozen *bytecode* loader executes these wrong and
    # they crash at import with "NameError: name '<loopvar>' is not defined"
    # (seen in scipy.stats._distn_infrastructure and torch._numpy._ufuncs).
    # Collecting them as SOURCE ('py') makes them import via the normal source
    # path — identical to a plain `python` run, which never triggers the bug.
    module_collection_mode={
        'scipy': 'py',
        'torch': 'py',
        'numpy': 'py',
        'sklearn': 'py',
        'transformers': 'py',
        'PIL': 'py',
        'nltk': 'py',
    },
)
pyz = PYZ(a.pure)

# One-DIR build (not one-file): exclude_binaries here + a COLLECT step below emit
# dist/KnowledgeHub/ as a folder. Preferred over one-file because one-file unpacks
# the whole torch/transformers payload to a temp dir on every launch (slow start,
# defeats the lazy-load work) and re-triggers AV scans each run.
#
# console=False -> Windows GUI subsystem: NO terminal window appears on launch.
# main.py already detects the headless case (sys.stdout is None) and redirects all
# output to logs/app.out.log, and it drives a system-tray icon — so a console is
# never needed. Double-clicking KnowledgeHub.exe just shows the tray icon.
#
# upx=False: UPX-compressing torch/numpy/mkl DLLs is a well-known source of
# corrupted-binary crashes, and its per-launch decompression works against the
# fast-startup goal. Disk is cheap here; correctness and speed win.
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='KnowledgeHub',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='KnowledgeHub',
)
