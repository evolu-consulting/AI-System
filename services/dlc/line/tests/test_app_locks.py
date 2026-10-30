"""One agent at a time per app (line.sidecar.app_locks), wired into the agents' page tools, with apps of the
machine's App Session Manager (line.sidecar.asm) as well as DLC Autologin's own."""

from __future__ import annotations

import json
import threading
import time
import types
import unittest
from unittest import mock

from line import agent_tools
from line.sidecar import app_locks, asm, autologin


class LocksTest(unittest.TestCase):
    def setUp(self):
        app_locks.reset()
        self.addCleanup(app_locks.reset)

    def test_one_holder_the_next_waits_then_gets_it(self):
        self.assertTrue(app_locks.acquire("app:SAP", "A", "builder of run R1")[0])
        self.assertTrue(app_locks.acquire("app:sap", "A")[0])                     # mine again, any case
        ok, info = app_locks.acquire("app:SAP", "B", "qas of run R2", wait_s=0)
        self.assertFalse(ok)
        self.assertEqual(info["holder_label"], "builder of run R1")
        got = []
        t = threading.Thread(target=lambda: got.append(app_locks.acquire("app:SAP", "B", wait_s=10)[0]))
        t.start()
        time.sleep(0.3)
        self.assertEqual(got, [])                                                # B waits in line
        app_locks.release("app:SAP", "A")
        t.join(5)
        self.assertEqual(got, [True])
        self.assertIn("in use by", app_locks.busy_note("app:SAP", "C"))
        self.assertEqual(app_locks.busy_note("app:SAP", "B"), " (held by you)")

    def test_first_in_line_goes_first(self):
        app_locks.acquire("x", "A")
        app_locks.acquire("x", "B", wait_s=0)                                    # B queues
        app_locks.acquire("x", "C", wait_s=0)                                    # C queues behind B
        app_locks.release("x", "A")
        self.assertFalse(app_locks.acquire("x", "C", wait_s=0)[0])               # not C's turn
        self.assertTrue(app_locks.acquire("x", "B", wait_s=0)[0])

    def test_released_when_the_agent_call_ends_or_goes_idle(self):
        app_locks.acquire("x", "tok1")
        app_locks.acquire("y", "tok1")
        self.assertEqual(sorted(app_locks.release_all("tok1")), ["x", "y"])
        clock = [0.0]
        app_locks.acquire("z", "A", clock=lambda: clock[0])
        clock[0] = app_locks.IDLE_S + 1
        self.assertTrue(app_locks.acquire("z", "B", wait_s=0, clock=lambda: clock[0])[0])   # A went quiet
        with mock.patch.object(agent_tools, "_tokens", {}):
            app_locks.acquire("w", "tok2")
            agent_tools.revoke("tok2")
        self.assertEqual(app_locks.status().get("w"), None)


class RoutingTest(unittest.TestCase):
    def setUp(self):
        app_locks.reset()
        self.addCleanup(app_locks.reset)
        p = mock.patch.object(autologin, "_allowed", return_value=[])           # no DLC Autologin entry
        p.start()
        self.addCleanup(p.stop)

    def test_app_session_manager_apps_and_busy(self):
        page = mock.MagicMock()
        page.url.return_value = "https://jira.example.com/browse/X-1"
        page.call.return_value = {"result": {"value": json.dumps({"status": 200, "type": "application/json",
                                                                  "body": "{\"key\": \"X-1\"}"})}}
        with mock.patch.object(asm, "enabled", return_value=True), \
                mock.patch.object(asm, "list_apps", return_value="- Jira (dev): jira.example.com, signin allowed"), \
                mock.patch.object(asm, "get_session", return_value={"text": "Signed in to Jira. Tab: ... (debug port "
                                                                           "9440, reach it at ...)", "port": 9440}), \
                mock.patch("line.sidecar.cdp.Page", return_value=page) as P:
            listing = autologin.call("list_apps", "spec", {}, holder="T1")
            self.assertIn("- Jira (dev)", listing)
            self.assertIn("one agent at a time", listing)
            out = autologin.call("fetch", "spec", {"app": "Jira", "url": "https://jira.example.com/rest/api/2/issue/X-1"},
                                 holder="T1", label="spec_analyst of run R1")
            self.assertIn("HTTP 200", out)
            P.assert_called_once_with(9440)
            with mock.patch.object(app_locks, "WAIT_S", 0):   # T1 still holds Jira: T2 is told to wait
                busy = autologin.call("open_page", "test", {"app": "jira", "url": "https://jira.example.com/"},
                                      holder="T2", label="qas of run R2")
            self.assertTrue(busy.startswith("BUSY: jira is in use by spec_analyst of run R1"), busy)
            self.assertEqual(P.call_count, 1)                 # the busy call never touched the tab
            self.assertIn("Released Jira", autologin.call("release_app", "spec", {"app": "Jira"}, holder="T1"))
            self.assertEqual(app_locks.status(), {})

    def test_cf_login_shares_one_lock_for_the_machine(self):
        with mock.patch.object(asm, "enabled", return_value=True), \
                mock.patch.object(asm, "cf_login", return_value="OK") as cf:
            self.assertEqual(autologin.call("cf_login", "deploy", {"app": "us21 Passcode", "org": "o"}, holder="T1"),
                             "OK")
            cf.assert_called_once_with("us21 Passcode", "o", "")
        self.assertIn("cf", app_locks.status())

    def test_tools_offered_when_the_bridge_is_on(self):
        with mock.patch.object(asm, "enabled", return_value=True), \
                mock.patch.object(autologin, "entries_for", return_value=[]):
            self.assertIn("release_app", agent_tools.tools_for("builder"))
        with mock.patch.object(asm, "enabled", return_value=False), \
                mock.patch.object(autologin, "entries_for", return_value=[]):
            self.assertNotIn("get_session", agent_tools.tools_for("builder"))


class AsmBridgeTest(unittest.TestCase):
    def test_rpc_over_stdio(self):
        sent = {}

        def run(argv, input, **kw):
            sent["argv"], sent["msgs"] = argv, [json.loads(x) for x in input.splitlines()]
            out = [{"jsonrpc": "2.0", "id": 1, "result": {}},
                   {"jsonrpc": "2.0", "id": 2, "result": {"content": [{"type": "text", "text":
                       "Signed in to DLC App Demo. Tab: 'AI DLC' at http://127.0.0.1:8795/ (debug port 9435, reach "
                       "it at http://127.0.0.1:9435)."}]}}]
            return types.SimpleNamespace(stdout="\n".join(json.dumps(m) for m in out), stderr="", returncode=0)

        r = asm.get_session("DLC App Demo", run=run)
        self.assertEqual(r["port"], 9435)
        self.assertEqual(sent["argv"][1:], ["mcp"])
        self.assertEqual([m.get("method") for m in sent["msgs"]], ["initialize", "notifications/initialized",
                                                                    "tools/call"])
        self.assertEqual(sent["msgs"][2]["params"], {"name": "get_session", "arguments": {"app": "DLC App Demo"}})

        def denied(argv, input, **kw):
            m = {"jsonrpc": "2.0", "id": 2, "result": {"content": [{"type": "text", "text": "DENIED: the person said "
                                                                                             "no"}]}}
            return types.SimpleNamespace(stdout=json.dumps(m), stderr="", returncode=0)
        self.assertIsNone(asm.get_session("Pacific Prod shared tester", run=denied)["port"])


if __name__ == "__main__":
    unittest.main()
