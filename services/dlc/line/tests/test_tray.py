"""The tray's status (line.tray): which colour for which parts answering, read from real HTTP answers."""

from __future__ import annotations

import http.server
import json
import os
import tempfile
import threading
import unittest

from line import tray


class StatusTest(unittest.TestCase):
    def test_all_up_is_ready_none_is_stopped_some_is_starting(self):
        self.assertEqual(tray.status({"engine": True, "fe": True, "kh": True}, "0.3.3"), ("ready", "DLC 0.3.3: ready"))
        self.assertEqual(tray.status({"engine": True, "fe": True}), ("ready", "DLC: ready"))
        self.assertEqual(tray.status({"engine": False, "fe": False, "kh": False})[0], "stopped")
        state, tip = tray.status({"engine": True, "fe": True, "kh": False})
        self.assertEqual(state, "starting")
        self.assertIn("knowledge store", tip)
        self.assertLessEqual(len(tray.status({"engine": False, "fe": False, "kh": True})[1]), 127)


class StartEngineTest(unittest.TestCase):
    def test_the_scripts_of_the_install_the_tray_runs_from(self):
        with tempfile.TemporaryDirectory() as root:
            exe = os.path.join(root, "apps", "dlc", "dlcw.exe")
            self.assertEqual(tray.default_script("Start-DLC.ps1", exe), "")   # no such script: the item is greyed
            os.makedirs(os.path.join(root, "bin"))
            script = os.path.join(root, "bin", "Start-DLC.ps1")
            open(script, "w").close()
            self.assertEqual(tray.default_script("Start-DLC.ps1", exe), script)
            self.assertEqual(tray.default_script("Stop-DLC.ps1", exe), "")

    def test_start_when_stopped_stop_when_starting_or_ready(self):
        self.assertEqual(tray.engine_item("stopped"), ("Start Engine", "start"))
        self.assertEqual(tray.engine_item("starting"), ("Stop Engine", "stop"))
        self.assertEqual(tray.engine_item("ready"), ("Stop Engine", "stop"))

    def test_the_command_line_of_the_desktop_shortcut(self):
        cmd = tray.start_command(r"C:\DLC\bin\Start-DLC.ps1")
        self.assertEqual(cmd[1:], ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", r"C:\DLC\bin\Start-DLC.ps1"])
        self.assertIn(os.path.basename(cmd[0]).lower().split(".")[0], ("pwsh", "powershell"))


class Handler(http.server.BaseHTTPRequestHandler):
    answers = {}

    def do_GET(self):
        body = self.answers.get(self.path)
        if body is None:
            self.send_response(503)
            self.end_headers()
            return
        self.send_response(200)
        self.end_headers()
        self.wfile.write(body.encode())

    def log_message(self, *a):
        pass


class ProbeTest(unittest.TestCase):
    def setUp(self):
        self.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.base = "http://127.0.0.1:%d" % self.srv.server_address[1]

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()

    def probe(self):
        return tray.probe(self.base + "/api/health", self.base + "/", self.base + "/health")

    def test_the_knowledge_store_still_loading_keeps_it_red(self):
        Handler.answers = {"/api/health": json.dumps({"ok": True, "version": "0.3.3"}), "/": "<html>",
                           "/health": json.dumps({"status": "loading"})}
        self.assertEqual(self.probe()[0], "starting")
        Handler.answers["/health"] = json.dumps({"status": "ok"})
        self.assertEqual(self.probe(), ("ready", "DLC 0.3.3: ready"))

    def test_nothing_answering_is_stopped(self):
        Handler.answers = {}
        self.assertEqual(self.probe()[0], "stopped")

    def test_no_knowledge_store_in_the_install(self):
        Handler.answers = {"/api/health": json.dumps({"ok": True}), "/": "<html>"}
        self.assertEqual(tray.probe(self.base + "/api/health", self.base + "/", "")[0], "ready")


if __name__ == "__main__":
    unittest.main()
