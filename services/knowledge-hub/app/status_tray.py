"""Status tray for a KH that runs as a service: `KnowledgeHub.exe --tray [--port N]` (2026-10-20).

The service (scheduled task 'KH Server' as SYSTEM, session 0) has no desktop, so its own tray never shows and the
person cannot tell whether KH is up. This tray runs in the person's session, starts NO server and opens no store:
it asks /health every few seconds and shows the answer as the icon's dot (green ready, amber starting, red
stopped), with a notice when the state changes. Same split as the DLC tray: server in a service, tray in the
user session.

It never stops or kills a KH process: the service may be loading its model while the tray starts.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from typing import Optional

from app.desktop import tray_supported

TASK_NAME = "KH Server"
POLL_S = 5.0
CREATE_NO_WINDOW = 0x08000000

READY, STARTING, STOPPED = "ready", "starting", "stopped"
DOT = {READY: (34, 197, 94, 255), STARTING: (245, 158, 11, 255), STOPPED: (239, 68, 68, 255)}
LABEL = {READY: "đang chạy", STARTING: "đang khởi động (nạp model)", STOPPED: "không chạy"}

logger = logging.getLogger("kh.status_tray")


def _app_dir() -> str:
    return (os.path.dirname(sys.executable) if getattr(sys, "frozen", False)
            else os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _bundle_dir() -> str:
    return getattr(sys, "_MEIPASS", _app_dir())


def port_from_env_file(path: str) -> Optional[int]:
    """KH_PORT from a .env file; None when the file is missing or unreadable (a service's .env may be locked)."""
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                key, sep, value = line.strip().partition("=")
                if sep and key.strip() == "KH_PORT" and value.strip().isdigit():
                    return int(value.strip())
    except OSError:
        pass
    return None


def probe(port: int, timeout: float = 2.0) -> str:
    """READY when /health says ok, STARTING when the port is open or the KH task is running, else STOPPED."""
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/health" % port, timeout=timeout) as r:
            body = json.loads(r.read().decode("utf-8", "replace") or "{}")
            if r.status == 200 and body.get("status") == "ok":
                return READY
    except Exception:
        pass
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        if s.connect_ex(("127.0.0.1", port)) == 0:
            return STARTING
    return STARTING if task_running() else STOPPED


def task_running() -> bool:
    """True while the scheduled task 'KH Server' is running (the model loads before the port opens)."""
    try:
        out = subprocess.run(["schtasks", "/Query", "/TN", TASK_NAME, "/FO", "CSV", "/NH"], capture_output=True,
                             text=True, timeout=10, creationflags=CREATE_NO_WINDOW).stdout
        return out.strip().split(",")[-1].strip('" \r\n').lower() == "running"
    except Exception:
        return False


def _single_instance(port: int) -> bool:
    """One status tray per port and session (a named mutex; released when the process ends)."""
    try:
        import ctypes
        ctypes.windll.kernel32.CreateMutexW(None, False, "Local\\KnowledgeHubStatusTray-%d" % port)
        return ctypes.windll.kernel32.GetLastError() != 183      # ERROR_ALREADY_EXISTS
    except Exception:
        return True


def icon_image(state: str):
    from PIL import Image, ImageDraw
    size = 64
    try:
        img = Image.open(os.path.join(_bundle_dir(), "assets", "kh.ico")).convert("RGBA").resize((size, size))
    except Exception:
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        ImageDraw.Draw(img).rounded_rectangle([2, 2, size - 2, size - 2], radius=14, fill=(37, 99, 235, 255))
    draw = ImageDraw.Draw(img)
    draw.ellipse([size - 26, size - 26, size - 2, size - 2], fill=DOT[state], outline=(255, 255, 255, 255), width=3)
    return img


def _setup_logging() -> None:
    folder = os.path.join(os.environ.get("LOCALAPPDATA") or _app_dir(), "KnowledgeHub")
    try:
        os.makedirs(folder, exist_ok=True)
        handler: logging.Handler = logging.FileHandler(os.path.join(folder, "status-tray.log"), encoding="utf-8")
    except OSError:
        handler = logging.NullHandler()
    logging.basicConfig(level=logging.INFO, handlers=[handler],
                        format="%(asctime)s  %(levelname)-8s  %(name)s - %(message)s")
    if sys.stdout is None or sys.stderr is None:          # windowed exe: no console streams
        sys.stdout = sys.stderr = open(os.devnull, "w")


def run(port: int) -> int:
    ok, why = tray_supported()
    if not ok:
        logger.info("No status tray: %s", why)
        return 0
    if not _single_instance(port):
        logger.info("A status tray for port %d is already running.", port)
        return 0
    import pystray
    from pystray import Menu, MenuItem

    base = "http://localhost:%d" % port
    state = {"now": None}

    def start_server(icon, item=None) -> None:
        r = subprocess.run(["schtasks", "/Run", "/TN", TASK_NAME], capture_output=True, text=True,
                           creationflags=CREATE_NO_WINDOW)
        if r.returncode != 0:
            logger.warning("schtasks /Run failed: %s", (r.stderr or r.stdout).strip())
            icon.notify("Không chạy được task '%s' (cần quyền admin?)." % TASK_NAME, "KnowledgeHub")

    menu = Menu(
        MenuItem("Mở Home", lambda i, _: webbrowser.open(base + "/home"), default=True),
        MenuItem("Mở Swagger (/docs)", lambda i, _: webbrowser.open(base + "/docs")),
        MenuItem("Mở Health", lambda i, _: webbrowser.open(base + "/health")),
        MenuItem("Mở thư mục log", lambda i, _: os.startfile(os.path.join(_app_dir(), "logs"))),
        Menu.SEPARATOR,
        MenuItem("Khởi động KH", start_server, visible=lambda item: state["now"] == STOPPED),
        MenuItem("Thoát tray", lambda i, _: i.stop()),
    )
    icon = pystray.Icon("KnowledgeHubStatus", icon=icon_image(STOPPED), title="KnowledgeHub :%d" % port, menu=menu)

    def watch(icon) -> None:
        icon.visible = True
        while True:
            now = probe(port)
            if now != state["now"]:
                before, state["now"] = state["now"], now
                icon.icon = icon_image(now)
                icon.title = "KnowledgeHub :%d - %s" % (port, LABEL[now])
                icon.update_menu()
                logger.info("KH on port %d: %s -> %s", port, before, now)
                if before is not None:
                    try:
                        icon.notify("KH %s." % LABEL[now], "KnowledgeHub :%d" % port)
                    except Exception:
                        pass
            time.sleep(POLL_S)

    threading.Thread(target=watch, args=(icon,), name="status-watch", daemon=True).start()
    try:
        icon.run()
    except Exception:
        logger.exception("Status tray failed")
        return 1
    return 0


def main(argv=None) -> int:
    _setup_logging()
    parser = argparse.ArgumentParser(prog="KnowledgeHub.exe --tray")
    parser.add_argument("--tray", action="store_true")
    parser.add_argument("--port", type=int, default=0)
    args, _ = parser.parse_known_args(argv)
    port = args.port or port_from_env_file(os.path.join(_app_dir(), ".env")) or 9000
    return run(port)
