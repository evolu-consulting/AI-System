"""`dlc tray`: a Windows tray icon that shows whether the local DLC stack is up; a click opens the home page.

The engine, frontend and knowledge store run as services or a scheduled task with no window, so a person could not
tell whether DLC was starting, ready or stopped. The tray asks each part every POLL_S seconds:

    green   ready     engine /api/health ok, frontend answers, knowledge store /health ok
    red     starting  some part answers, not all yet (the knowledge store loads its model for a minute or two)
    grey    stopped   nothing answers

Left click opens the frontend home (the projects page); right click: Open DLC, Start Engine (grey icon) or Stop Engine
(red or green icon), Quit tray. They do what the desktop shortcuts 'Start DLC' / 'Stop DLC' do (make-shortcuts.ps1):
pwsh runs <root>\\bin\\Start-DLC.ps1 / Stop-DLC.ps1 in its own console window; the item is greyed out when the tray
does not run from an install that has that script. One tray per user (a named mutex). Plain Win32 through ctypes, no
extra package; on other systems `dlc tray` only prints the status.

    dlc tray [--engine URL] [--fe URL] [--kh URL|""] [--start SCRIPT|""] [--stop SCRIPT|""]   ("" = none)
    dlcw.exe tray                                         (no console window; deploy/windows/startstop/make-shortcuts.ps1
                                                           starts it at every sign-in through the HKCU Run key)
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import threading
import urllib.request
import webbrowser
from typing import Dict, Optional, Tuple

POLL_S = 3.0
TIMEOUT_S = 2.0
ENGINE = "http://127.0.0.1:8796/api/health"
FE = "http://127.0.0.1:8795/"
STORE = "http://127.0.0.1:9300/health"
COLORS = {"ready": (0x16, 0xA3, 0x4A), "starting": (0xDC, 0x26, 0x26), "stopped": (0x9C, 0xA3, 0xAF)}
NAMES = {"engine": "engine", "fe": "frontend", "kh": "knowledge store"}


# ------------------------------------------------------------------ status (pure, testable anywhere)

def status(up: Dict[str, bool], version: str = "") -> Tuple[str, str]:
    """(state, tooltip) from which parts answer: ready when all, stopped when none, starting otherwise."""
    if up and all(up.values()):
        return "ready", ("DLC %s: ready" % version) if version else "DLC: ready"
    if not any(up.values()):
        return "stopped", "DLC: stopped"
    waiting = ", ".join(NAMES.get(k, k) for k, ok in up.items() if not ok)
    return "starting", ("DLC: starting, waiting for %s" % waiting)[:127]


def _get(url: str) -> Optional[bytes]:
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT_S) as r:
            return r.read() if 200 <= r.status < 300 else None
    except Exception:   # noqa: BLE001 - not answering is the answer
        return None


def _json_ok(body: Optional[bytes], key: str, want: object) -> Tuple[bool, Dict]:
    try:
        data = json.loads(body or b"{}")
    except ValueError:
        return False, {}
    return data.get(key) == want, data


def probe(engine: str, fe: str, kh: str) -> Tuple[str, str]:
    up: Dict[str, bool] = {}
    ok, data = _json_ok(_get(engine), "ok", True)
    up["engine"] = ok
    up["fe"] = _get(fe) is not None
    if kh:
        up["kh"] = _json_ok(_get(kh), "status", "ok")[0]
    return status(up, str(data.get("version") or ""))


def default_script(name: str, exe: str = "") -> str:
    """<root>\\bin\\<name> of the install the tray runs from (<root>\\apps\\dlc\\dlcw.exe); '' outside one."""
    exe = os.path.abspath(exe or sys.executable)
    script = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(exe))), "bin", name)
    return script if os.path.isfile(script) else ""


def engine_item(state: str) -> Tuple[str, str]:
    """(label, which script) of the engine menu item: start a stopped stack, stop one that starts or runs."""
    return ("Start Engine", "start") if state == "stopped" else ("Stop Engine", "stop")


def start_command(script: str) -> list:
    """The command line of the desktop shortcuts 'Start DLC' / 'Stop DLC': PowerShell 7 when present, else Windows
    PowerShell."""
    shell = shutil.which("pwsh") or shutil.which("powershell") or "powershell.exe"
    return [shell, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script]


# ------------------------------------------------------------------ the Win32 tray

def _tray(engine: str, fe: str, kh: str, scripts: Dict[str, str]) -> int:
    import ctypes
    from ctypes import wintypes as w

    u32, s32, g32 = ctypes.windll.user32, ctypes.windll.shell32, ctypes.windll.gdi32
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    LRESULT = ctypes.c_ssize_t
    WNDPROC = ctypes.WINFUNCTYPE(LRESULT, w.HWND, w.UINT, w.WPARAM, w.LPARAM)

    class WNDCLASSW(ctypes.Structure):
        _fields_ = [("style", w.UINT), ("lpfnWndProc", WNDPROC), ("cbClsExtra", ctypes.c_int),
                    ("cbWndExtra", ctypes.c_int), ("hInstance", w.HINSTANCE), ("hIcon", w.HICON),
                    ("hCursor", w.HANDLE), ("hbrBackground", w.HBRUSH), ("lpszMenuName", w.LPCWSTR),
                    ("lpszClassName", w.LPCWSTR)]

    class GUID(ctypes.Structure):
        _fields_ = [("a", w.DWORD), ("b", w.WORD), ("c", w.WORD), ("d", ctypes.c_ubyte * 8)]

    class NOTIFYICONDATAW(ctypes.Structure):
        _fields_ = [("cbSize", w.DWORD), ("hWnd", w.HWND), ("uID", w.UINT), ("uFlags", w.UINT),
                    ("uCallbackMessage", w.UINT), ("hIcon", w.HICON), ("szTip", w.WCHAR * 128),
                    ("dwState", w.DWORD), ("dwStateMask", w.DWORD), ("szInfo", w.WCHAR * 256),
                    ("uVersion", w.UINT), ("szInfoTitle", w.WCHAR * 64), ("dwInfoFlags", w.DWORD),
                    ("guidItem", GUID), ("hBalloonIcon", w.HICON)]

    class BITMAPINFOHEADER(ctypes.Structure):
        _fields_ = [("biSize", w.DWORD), ("biWidth", w.LONG), ("biHeight", w.LONG), ("biPlanes", w.WORD),
                    ("biBitCount", w.WORD), ("biCompression", w.DWORD), ("biSizeImage", w.DWORD),
                    ("biXPelsPerMeter", w.LONG), ("biYPelsPerMeter", w.LONG), ("biClrUsed", w.DWORD),
                    ("biClrImportant", w.DWORD)]

    class ICONINFO(ctypes.Structure):
        _fields_ = [("fIcon", w.BOOL), ("xHotspot", w.DWORD), ("yHotspot", w.DWORD), ("hbmMask", w.HBITMAP),
                    ("hbmColor", w.HBITMAP)]

    u32.DefWindowProcW.argtypes = [w.HWND, w.UINT, w.WPARAM, w.LPARAM]
    u32.DefWindowProcW.restype = LRESULT
    u32.CreateWindowExW.argtypes = [w.DWORD, w.LPCWSTR, w.LPCWSTR, w.DWORD, ctypes.c_int, ctypes.c_int,
                                    ctypes.c_int, ctypes.c_int, w.HWND, w.HMENU, w.HINSTANCE, w.LPVOID]
    u32.CreateWindowExW.restype = w.HWND
    u32.PostMessageW.argtypes = [w.HWND, w.UINT, w.WPARAM, w.LPARAM]
    u32.TrackPopupMenu.argtypes = [w.HMENU, w.UINT, ctypes.c_int, ctypes.c_int, ctypes.c_int, w.HWND, w.LPVOID]
    u32.AppendMenuW.argtypes = [w.HMENU, w.UINT, ctypes.c_size_t, w.LPCWSTR]
    u32.CreatePopupMenu.restype = w.HMENU
    u32.SetForegroundWindow.argtypes = [w.HWND]
    u32.DestroyMenu.argtypes = [w.HMENU]
    u32.RegisterClassW.argtypes = [ctypes.POINTER(WNDCLASSW)]
    s32.Shell_NotifyIconW.argtypes = [w.DWORD, ctypes.POINTER(NOTIFYICONDATAW)]
    g32.CreateDIBSection.argtypes = [w.HDC, ctypes.POINTER(BITMAPINFOHEADER), w.UINT, ctypes.POINTER(ctypes.c_void_p),
                                     w.HANDLE, w.DWORD]
    g32.CreateDIBSection.restype = w.HBITMAP
    g32.CreateBitmap.restype = w.HBITMAP
    u32.GetDC.restype = w.HDC
    u32.ReleaseDC.argtypes = [w.HWND, w.HDC]
    u32.CreateIconIndirect.argtypes = [ctypes.POINTER(ICONINFO)]
    u32.CreateIconIndirect.restype = w.HICON
    u32.DestroyWindow.argtypes = [w.HWND]
    u32.GetMessageW.argtypes = [ctypes.POINTER(w.MSG), w.HWND, w.UINT, w.UINT]
    k32.CreateMutexW.argtypes = [w.LPVOID, w.BOOL, w.LPCWSTR]
    k32.CreateMutexW.restype = w.HANDLE
    k32.GetModuleHandleW.argtypes = [w.LPCWSTR]
    k32.GetModuleHandleW.restype = w.HMODULE
    k32.CloseHandle.argtypes = [w.HANDLE]

    mutex = k32.CreateMutexW(None, False, "Local\\dlc-tray")
    if ctypes.get_last_error() == 183:                 # ERROR_ALREADY_EXISTS: this user already has a tray
        return 0

    WM_DESTROY, WM_COMMAND, WM_LBUTTONUP, WM_RBUTTONUP = 0x0002, 0x0111, 0x0202, 0x0205
    WM_TRAY, WM_STATE = 0x8000 + 1, 0x8000 + 2         # WM_APP + n
    NIM_ADD, NIM_MODIFY, NIM_DELETE = 0, 1, 2
    NIF_MESSAGE, NIF_ICON, NIF_TIP = 1, 2, 4
    ID_OPEN, ID_QUIT, ID_ENGINE = 1, 2, 3
    MF_GRAYED = 0x0001
    TASKBAR_CREATED = u32.RegisterWindowMessageW("TaskbarCreated")   # explorer restarted: add the icon again

    def make_icon(rgb: Tuple[int, int, int]) -> int:
        size = 32
        bmi = BITMAPINFOHEADER(ctypes.sizeof(BITMAPINFOHEADER), size, -size, 1, 32, 0, 0, 0, 0, 0, 0)
        bits = ctypes.c_void_p()
        hdc = u32.GetDC(None)
        color = g32.CreateDIBSection(hdc, ctypes.byref(bmi), 0, ctypes.byref(bits), None, 0)
        u32.ReleaseDC(None, hdc)
        px = (ctypes.c_uint32 * (size * size)).from_address(bits.value)
        c, r_out, r_in = (size - 1) / 2.0, 14.5, 12.0
        dark = tuple(int(v * 0.7) for v in rgb)
        for y in range(size):
            for x in range(size):
                d = ((x - c) ** 2 + (y - c) ** 2) ** 0.5
                a = max(0.0, min(1.0, r_out - d + 0.5))          # anti-aliased edge
                if a <= 0:
                    px[y * size + x] = 0
                    continue
                r, g, b = dark if d > r_in else rgb               # a darker ring around the dot
                px[y * size + x] = (int(a * 255) << 24) | (r << 16) | (g << 8) | b
        mask = g32.CreateBitmap(size, size, 1, 1, None)
        info = ICONINFO(True, 0, 0, mask, color)
        return u32.CreateIconIndirect(ctypes.byref(info))

    icons = {k: make_icon(v) for k, v in COLORS.items()}
    shown = {"state": "stopped", "tip": "DLC: checking..."}
    lock = threading.Lock()
    hwnd_box: Dict[str, int] = {}

    def nid(flags: int) -> NOTIFYICONDATAW:
        n = NOTIFYICONDATAW()
        n.cbSize = ctypes.sizeof(NOTIFYICONDATAW)
        n.hWnd, n.uID, n.uFlags, n.uCallbackMessage = hwnd_box["h"], 1, flags, WM_TRAY
        with lock:
            n.hIcon, n.szTip = icons[shown["state"]], shown["tip"]
        return n

    def open_home() -> None:
        try:
            os.startfile(fe)                               # the default browser, also from the windowless dlcw.exe
        except OSError:
            webbrowser.open(fe)

    def run_script(script: str) -> None:
        # its own console like the shortcut: the script shows progress and waits for Enter when a part does not answer
        try:
            subprocess.Popen(start_command(script), cwd=os.path.dirname(os.path.dirname(script)),
                             creationflags=0x00000010)    # CREATE_NEW_CONSOLE
        except OSError as e:
            print("dlc tray: could not run %s: %s" % (script, e), file=sys.stderr, flush=True)

    @WNDPROC
    def wndproc(hwnd, msg, wparam, lparam):
        if msg == WM_TRAY:
            if lparam == WM_LBUTTONUP:
                open_home()
            elif lparam == WM_RBUTTONUP:
                with lock:
                    label, which = engine_item(shown["state"])
                script = scripts.get(which, "")
                menu = u32.CreatePopupMenu()
                u32.AppendMenuW(menu, 0, ID_OPEN, "Open DLC")
                u32.AppendMenuW(menu, 0 if script else MF_GRAYED, ID_ENGINE, label)
                u32.AppendMenuW(menu, 0, ID_QUIT, "Quit tray")
                pt = w.POINT()
                u32.GetCursorPos(ctypes.byref(pt))
                u32.SetForegroundWindow(hwnd)
                cmd = u32.TrackPopupMenu(menu, 0x0100 | 0x0020, pt.x, pt.y, 0, hwnd, None)   # RETURNCMD | BOTTOMALIGN
                u32.DestroyMenu(menu)
                if cmd == ID_OPEN:
                    open_home()
                elif cmd == ID_ENGINE and script:
                    run_script(script)
                elif cmd == ID_QUIT:
                    u32.DestroyWindow(hwnd)
            return 0
        if msg == WM_STATE:
            s32.Shell_NotifyIconW(NIM_MODIFY, ctypes.byref(nid(NIF_ICON | NIF_TIP)))
            return 0
        if msg == TASKBAR_CREATED:
            s32.Shell_NotifyIconW(NIM_ADD, ctypes.byref(nid(NIF_MESSAGE | NIF_ICON | NIF_TIP)))
            return 0
        if msg == WM_DESTROY:
            s32.Shell_NotifyIconW(NIM_DELETE, ctypes.byref(nid(0)))
            u32.PostQuitMessage(0)
            return 0
        return u32.DefWindowProcW(hwnd, msg, wparam, lparam)

    hinst = k32.GetModuleHandleW(None)
    wc = WNDCLASSW()
    wc.lpfnWndProc, wc.hInstance, wc.lpszClassName = wndproc, hinst, "DlcTrayWindow"
    u32.RegisterClassW(ctypes.byref(wc))
    hwnd = u32.CreateWindowExW(0, "DlcTrayWindow", "DLC tray", 0, 0, 0, 0, 0, None, None, hinst, None)
    hwnd_box["h"] = hwnd
    if not s32.Shell_NotifyIconW(NIM_ADD, ctypes.byref(nid(NIF_MESSAGE | NIF_ICON | NIF_TIP))):
        print("dlc tray: the shell refused the icon (no taskbar yet?); it is added when the taskbar starts",
              file=sys.stderr, flush=True)
    else:
        print("dlc tray: icon added", flush=True)

    stop = threading.Event()

    def poll() -> None:                                 # off the window thread: a slow part never freezes the menu
        while not stop.is_set():
            state, tip = probe(engine, fe, kh)
            with lock:
                changed = (state, tip) != (shown["state"], shown["tip"])
                shown.update(state=state, tip=tip)
            if changed:
                u32.PostMessageW(hwnd, WM_STATE, 0, 0)
            stop.wait(POLL_S)

    threading.Thread(target=poll, name="dlc-tray-poll", daemon=True).start()
    msg = w.MSG()
    while u32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
        u32.TranslateMessage(ctypes.byref(msg))
        u32.DispatchMessageW(ctypes.byref(msg))
    stop.set()
    k32.CloseHandle(mutex)
    return 0


def main(argv: list) -> int:
    ap = argparse.ArgumentParser(prog="dlc tray")
    ap.add_argument("--engine", default=os.environ.get("DLC_TRAY_ENGINE", ENGINE))
    ap.add_argument("--fe", default=os.environ.get("DLC_TRAY_FE", FE))
    ap.add_argument("--kh", default=os.environ.get("DLC_TRAY_STORE", STORE))
    ap.add_argument("--start", default=os.environ.get("DLC_TRAY_START"),
                    help="the script of the menu item Start Engine (default: <root>\\bin\\Start-DLC.ps1)")
    ap.add_argument("--stop", default=os.environ.get("DLC_TRAY_STOP"),
                    help="the script of the menu item Stop Engine (default: <root>\\bin\\Stop-DLC.ps1)")
    ap.add_argument("--once", action="store_true", help="print the status once and exit")
    a = ap.parse_args(argv)
    if a.once or sys.platform != "win32":
        state, tip = probe(a.engine, a.fe, a.kh)
        print("%s: %s" % (state, tip))
        return 0 if state == "ready" else 1
    scripts = {"start": default_script("Start-DLC.ps1") if a.start is None else a.start,
               "stop": default_script("Stop-DLC.ps1") if a.stop is None else a.stop}
    return _tray(a.engine, a.fe, a.kh, scripts)


__all__ = ["status", "probe", "default_script", "engine_item", "start_command", "main"]
