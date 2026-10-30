"""Can this process show a system-tray icon? (2026-10-20)

KH runs in three places: BTP / Docker (Linux, `uvicorn main:app`, never a tray), a Windows service or a SYSTEM
scheduled task (session 0, no desktop the user sees) and a person's own Windows session. Only the last one gets
a tray. tray_supported() decides it from the process itself, so no setting has to be right for the tray to stay
away from a place where it would fail; KH_NO_TRAY=1 still turns it off by hand.

Light on purpose: the status tray (app/status_tray.py) imports this before any of the server's heavy modules.
"""
from __future__ import annotations

import os
import sys
from typing import Optional, Tuple

# Set by Cloud Foundry (BTP), Kubernetes and Docker-style hosts; any one of them means 'no desktop here'.
CLOUD_MARKERS = ("VCAP_APPLICATION", "CF_INSTANCE_GUID", "KUBERNETES_SERVICE_HOST")


def _truthy(value: Optional[str]) -> bool:
    return (value or "").strip().lower() in ("1", "true", "yes", "on")


def session_id() -> Optional[int]:
    """Windows session of this process (0 = services); None when it cannot be read."""
    try:
        import ctypes
        sid = ctypes.c_ulong()
        if ctypes.windll.kernel32.ProcessIdToSessionId(os.getpid(), ctypes.byref(sid)):
            return int(sid.value)
    except Exception:
        pass
    return None


def visible_window_station() -> Optional[bool]:
    """True when this process's window station is the interactive one (WinSta0 with WSF_VISIBLE)."""
    try:
        import ctypes
        from ctypes import wintypes

        class USEROBJECTFLAGS(ctypes.Structure):
            _fields_ = [("fInherit", wintypes.BOOL), ("fReserved", wintypes.BOOL), ("dwFlags", wintypes.DWORD)]

        user32 = ctypes.windll.user32
        user32.GetProcessWindowStation.restype = wintypes.HANDLE
        station = user32.GetProcessWindowStation()
        if not station:
            return None
        flags, needed = USEROBJECTFLAGS(), wintypes.DWORD()
        UOI_FLAGS, WSF_VISIBLE = 1, 0x0001
        if not user32.GetUserObjectInformationW(station, UOI_FLAGS, ctypes.byref(flags), ctypes.sizeof(flags),
                                                ctypes.byref(needed)):
            return None
        return bool(flags.dwFlags & WSF_VISIBLE)
    except Exception:
        return None


def tray_supported(env=None, platform: Optional[str] = None) -> Tuple[bool, str]:
    """(True, 'desktop') when a tray icon can be shown here, else (False, why). Never raises."""
    env = os.environ if env is None else env
    platform = sys.platform if platform is None else platform
    if _truthy(env.get("KH_NO_TRAY")):
        return False, "KH_NO_TRAY is set"
    for marker in CLOUD_MARKERS:
        if env.get(marker):
            return False, "cloud host (%s)" % marker
    if platform != "win32":
        return False, "not Windows (%s)" % platform
    if session_id() == 0:
        return False, "Windows service session (session 0)"
    if visible_window_station() is False:
        return False, "no interactive desktop"
    try:
        import pystray  # noqa: F401
    except Exception as e:          # ImportError, or a backend that fails on import
        return False, "pystray unavailable (%s)" % type(e).__name__
    return True, "desktop"
