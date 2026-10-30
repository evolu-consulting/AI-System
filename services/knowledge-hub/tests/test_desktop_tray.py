"""Tests for the tray detection and the status tray (app/desktop.py, app/status_tray.py), 2026-10-20.

WHAT IS UNDER TEST
  1. DETECTION. No tray with KH_NO_TRAY, on a cloud host (Cloud Foundry, Kubernetes), off Windows, in session 0.
  2. STATUS. /health ok = ready, an open port without ok = starting, nothing = stopped (or starting while the
     'KH Server' task runs).
  3. PORT. Read from --port, else KH_PORT in the .env beside the exe; a missing file is not an error.
  4. LAUNCH. `main.py --tray` returns before the server's modules load (they open the stores the service holds).

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_desktop_tray.py
"""
import http.server
import os
import socket
import subprocess
import sys
import tempfile
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from app import desktop, status_tray  # noqa: E402

FAILURES = []


def check(name, cond, detail=""):
    print(("ok   " if cond else "FAIL ") + name + ("" if cond else "  -> %s" % (detail,)))
    if not cond:
        FAILURES.append(name)


# 1. detection
check("KH_NO_TRAY turns it off", desktop.tray_supported({"KH_NO_TRAY": "1"}, "win32")[0] is False)
check("Cloud Foundry has no tray", desktop.tray_supported({"VCAP_APPLICATION": "{}"}, "win32")
      == (False, "cloud host (VCAP_APPLICATION)"))
check("Kubernetes has no tray", desktop.tray_supported({"KUBERNETES_SERVICE_HOST": "10.0.0.1"}, "win32")[0] is False)
check("Linux has no tray", desktop.tray_supported({}, "linux") == (False, "not Windows (linux)"))
real_session = desktop.session_id
desktop.session_id = lambda: 0
check("session 0 (service) has no tray", desktop.tray_supported({}, "win32")
      == (False, "Windows service session (session 0)"))
desktop.session_id = real_session
here = desktop.tray_supported()
print("     this process: %s" % (here,))
check("never raises and gives a reason", isinstance(here, tuple) and isinstance(here[1], str) and here[1])


# 2. status
def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Health(http.server.BaseHTTPRequestHandler):
    body = b'{"status":"ok"}'

    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(self.body)

    def log_message(self, *a):
        pass


def serve(body):
    handler = type("H", (Health,), {"body": body})
    srv = http.server.HTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


status_tray.task_running = lambda: False
up = serve(b'{"status":"ok","model":"x"}')
check("health ok is ready", status_tray.probe(up.server_port) == status_tray.READY)
up.shutdown()
loading = serve(b'{"status":"loading"}')
check("open port without ok is starting", status_tray.probe(loading.server_port) == status_tray.STARTING)
loading.shutdown()
nothing = free_port()
check("nothing listening is stopped", status_tray.probe(nothing, timeout=0.5) == status_tray.STOPPED)
status_tray.task_running = lambda: True
check("task running before the port opens is starting", status_tray.probe(nothing, timeout=0.5) == status_tray.STARTING)

# 3. port
tmp = tempfile.mkdtemp(prefix="kh_tray_")
env_file = os.path.join(tmp, ".env")
with open(env_file, "w", encoding="utf-8") as f:
    f.write("# comment\nKH_HOST=127.0.0.1\nKH_PORT=9010\n")
check("KH_PORT read from .env", status_tray.port_from_env_file(env_file) == 9010)
check("missing .env gives None", status_tray.port_from_env_file(os.path.join(tmp, "nope.env")) is None)
check("icon has the state dot", status_tray.icon_image(status_tray.READY).getpixel((50, 50)) == status_tray.DOT["ready"])

# 4. launch: --tray exits before fastapi / the stores are imported
probe_code = ("import runpy, sys; sys.argv = ['main.py', '--tray', '--port', '1']\n"
              "try:\n    runpy.run_path('main.py', run_name='__main__')\n"
              "except SystemExit as e:\n    print('exit', e.code, 'fastapi' in sys.modules, 'chromadb' in sys.modules)\n")
out = subprocess.run([sys.executable, "-c", probe_code], cwd=ROOT, capture_output=True, text=True, timeout=120,
                     env=dict(os.environ, KH_NO_TRAY="1", LOCALAPPDATA=tmp))
check("--tray returns before the server modules load", out.stdout.strip() == "exit 0 False False",
      (out.stdout + out.stderr)[-500:])

# 5. a starting server's preflight never takes the status tray for a stale server (it killed it, 2026-10-20)
import preflight  # noqa: E402


class _Proc:
    def __init__(self, cmdline):
        self.info = {"name": "python.exe", "cmdline": cmdline, "exe": sys.executable, "cwd": ROOT}


check("a server instance is found", preflight._is_kh_instance(_Proc(["python", os.path.join(ROOT, "main.py")])))
check("the status tray is not a stale server",
      not preflight._is_kh_instance(_Proc(["python", os.path.join(ROOT, "main.py"), "--tray", "--port", "9010"])))

print("\nALL PASS" if not FAILURES else "\n%d FAILED: %s" % (len(FAILURES), FAILURES))
sys.exit(1 if FAILURES else 0)
