# PyInstaller spec: the default DLC frontend server (sdlc.py + the built web app) as one folder.
#   python -m PyInstaller --noconfirm --clean --distpath dist --workpath packaging_fe/.work packaging_fe/dlc_fe.spec
# Run from Slaves/SDLC after `pnpm build` in web/.
import os

ROOT = os.path.abspath(os.path.join(SPECPATH, ".."))

datas = [
    (os.path.join(ROOT, "web", "dist"), os.path.join("web", "dist")),
    (os.path.join(ROOT, "schema.sql"), "."),
    (os.path.join(ROOT, "pricing.json"), "."),
]

a = Analysis(
    [os.path.join(ROOT, "sdlc.py")],
    pathex=[ROOT],
    datas=datas,
    hiddenimports=["fe_auth", "fe_bff", "db", "engine", "gov", "kh", "llm", "plan", "report", "seed", "toolbox", "prompts"],
    excludes=["tkinter", "test", "unittest", "pydoc_data", "line"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="dlc-fe", console=True, upx=False)
coll = COLLECT(exe, a.binaries, a.datas, name="dlc-fe", upx=False)
