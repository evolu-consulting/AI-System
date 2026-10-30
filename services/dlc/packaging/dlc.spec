# PyInstaller spec of the delivered `dlc` application (one-folder build). Run through build_dlc.ps1.
# Engine code goes into the frozen archive only; data files keep their place under line/ so the
# engine's __file__-relative lookups work unchanged in the frozen app.
import os

SDLC = os.path.abspath(os.path.join(SPECPATH, os.pardir))
LINE = os.path.join(SDLC, "line")
SKIP_DIRS = {"__pycache__", "node_modules", ".git"}


def tree(src, dest):
    out = []
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        rel = os.path.relpath(root, src)
        for f in files:
            if f.endswith((".pyc", ".db", ".db-wal", ".db-shm")):
                continue
            out.append((os.path.join(root, f), os.path.normpath(os.path.join(dest, rel))))
    return out


datas = (tree(os.path.join(LINE, "llm", "prompts"), "line/llm/prompts")
         + tree(os.path.join(LINE, "samples"), "line/samples")
         + tree(os.path.join(LINE, "config"), "line/config")
         + tree(os.path.join(LINE, "process", "seed"), "line/process/seed")      # process definitions + prompts
         + [(os.path.join(LINE, "board.html"), "line"), (os.path.join(LINE, "schema_line.sql"), "line"),
            (os.path.join(SDLC, "pricing.json"), ".")])

from PyInstaller.utils.hooks import collect_submodules  # noqa: E402

hidden = [m for m in collect_submodules("line") if ".tests" not in m] + ["llm"] + collect_submodules("websockets") + collect_submodules("pypdf")   # Autologin drives Chrome over CDP

a = Analysis([os.path.join(SPECPATH, "dlc_entry.py")], pathex=[SDLC], binaries=[], datas=datas,
             hiddenimports=hidden, hookspath=[], runtime_hooks=[],
             excludes=["tkinter", "line.tests", "pytest", "numpy", "torch"], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="dlc", console=True, upx=False)
# dlcw.exe: the same program without a console window, for the engine started by a scheduled task under a
# person's account (dlcw --env-file F --log-file L serve): stopping the task stops the engine itself.
exew = EXE(pyz, a.scripts, [], exclude_binaries=True, name="dlcw", console=False, upx=False)
coll = COLLECT(exe, exew, a.binaries, a.datas, strip=False, upx=False, name="dlc")
