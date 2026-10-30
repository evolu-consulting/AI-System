"""DLC Autologin on the App Session Manager 1.10 driver: the sign-in step language (line.sidecar.steps), steps that
follow the screen, CLI sign-in (line.sidecar.cdp) and the steps / cli entries of the vault (line.sidecar.autologin).

The driver tests are ported from the App Session Manager's own (Stools AutoLogin/tests/test_custom_steps.py at
4227d2c), so the vendored copy keeps the behaviour it was tested for there."""

from __future__ import annotations

import json
import os
import re
import shutil
import sys
import tempfile
import unittest
from unittest import mock

from line.sidecar import autologin, cdp, steps


class FakePage:
    def __init__(self, url, looks_like_login=False):
        self._url, self._login = url, looks_like_login

    def url(self):
        return self._url

    def eval(self, expr):
        return self._login


class ParseStepsTest(unittest.TestCase):
    def test_reads_hand_written_and_recorded_lines(self):
        self.assertEqual(steps.parse_steps(
            'click "Sign in"\n\n// a comment\nfill "Username or email" = {{username}}\n'
            'fill "Password" = "{{password}}"\nfill #tenant = acme corp\npress Enter\nwait "Welcome"\npause 2\n'), [
            ('click', 'Sign in', None), ('fill', 'Username or email', '{{username}}'),
            ('fill', 'Password', '{{password}}'), ('fill', '#tenant', 'acme corp'), ('press', 'Enter', None),
            ('wait', 'Welcome', None), ('pause', 2.0, None)])

    def test_bad_lines_name_their_line(self):
        for text, said in (('click "x"\njump "y"', 'step 2'), ('fill "User"', 'fill needs'),
                           ('click', 'needs a target'), ('pause soon', 'seconds')):
            with self.assertRaises(ValueError) as caught:
                steps.parse_steps(text)
            self.assertIn(said, str(caught.exception))

    def test_presets_round_trip_through_the_parser(self):
        for kind, provider in (('password', ''), ('sso', 'microsoft'), ('passcode', 'a "b" :: c'), ('cli', '')):
            self.assertTrue(steps.parse_steps(steps.preset_steps(kind, provider)))
        self.assertEqual(steps.parse_steps(steps.preset_steps('sso', 'idp :: S00123')), [('sso', 'idp', 'S00123')])
        with self.assertRaises(ValueError):
            steps.preset_steps('sso', '')

    def test_run_and_code(self):
        self.assertEqual(steps.parse_steps('run "gcloud auth login --no-launch-browser"\nclick "Allow"\ncode'), [
            ('run', 'gcloud auth login --no-launch-browser', None), ('click', 'Allow', None), ('code', None, None)])
        for bad, said in (('click "x"\nrun "gcloud"', 'first step'), ('run gcloud auth login', 'in quotes'),
                          ('click "Allow"\ncode', 'run step first')):
            with self.assertRaises(ValueError) as caught:
                steps.parse_steps(bad)
            self.assertIn(said, str(caught.exception))


class ScreenPage:
    """A page that shows one screen at a time: the targets on it; a click moves on."""

    def __init__(self, screens, login=True):
        self.screens, self.at, self.login, self.done = screens, 0, login, []

    def url(self):
        return 'https://10.0.0.5:8000/login' if self.login else 'https://10.0.0.5:8000/home'

    def call(self, method, **params):
        if method == 'Input.insertText':
            self.done.append(('typed', params['text']))

    def eval(self, expr):
        m = re.search(r'\}\)\((".*?"),(true|false)\)', expr)
        if not m:
            return self.login               # SIGNIN_PAGE_JS
        target = json.loads(m.group(1))
        if target not in self.screens[self.at]:
            return None
        if 'e.click()' in expr:
            self.done.append(('click', target))
            self.at = min(self.at + 1, len(self.screens) - 1)
        elif 'e.focus()' in expr:
            self.done.append(('fill', target))
        return True


class ScreenDrivenStepsTest(unittest.TestCase):
    """A certificate warning that shows on some runs only: the steps follow the screen, not their order."""
    STEPS = 'click "Advanced"\nclick "Proceed"\nfill "Password" = {{password}}\nclick "Sign in"'

    def run_on(self, page, timeout=20):
        t = [0.0]

        def sleep(s):
            t[0] += s
        with mock.patch.object(cdp.time, 'sleep', sleep):
            return cdp.run_steps(page, steps.parse_steps(self.STEPS), 'u', 'pw', timeout=timeout,
                                 clock=lambda: t[0], sleep=sleep)

    def test_all_screens_shown_runs_every_step(self):
        page = ScreenPage([{'Advanced'}, {'Proceed'}, {'Password', 'Sign in'}, set()])
        self.assertIsNone(self.run_on(page)['failed'])
        self.assertEqual(page.done, [('click', 'Advanced'), ('click', 'Proceed'), ('fill', 'Password'),
                                     ('typed', 'pw'), ('click', 'Sign in')])

    def test_a_screen_the_site_skipped_is_skipped(self):
        page = ScreenPage([{'Password', 'Sign in'}, set()])
        self.assertIsNone(self.run_on(page)['failed'])
        self.assertEqual(page.done, [('fill', 'Password'), ('typed', 'pw'), ('click', 'Sign in')])

    def test_an_unknown_screen_waits_for_the_timeout_then_fails(self):
        run = self.run_on(ScreenPage([{'Something new'}]), timeout=5)
        self.assertIn('step 1', run['failed'])
        self.assertIn('none of the remaining steps', run['failed'])

    def test_an_unknown_screen_off_the_login_page_is_not_a_failure(self):
        self.assertIsNone(self.run_on(ScreenPage([{'Dashboard'}], login=False), timeout=5)['failed'])


class DriverTest(unittest.TestCase):
    def test_smart_steps_go_to_their_flows(self):
        calls = []
        with mock.patch.object(cdp, 'password_login', lambda page, u, s: calls.append(('login', u, s))), \
                mock.patch.object(cdp, 'sso_login', lambda page, p, pick, u, s, host:
                                  calls.append(('sso', p, pick, host)) or ('Microsoft', ['Microsoft'])), \
                mock.patch.object(cdp, 'read_passcode', lambda page: 'CODE'):
            run = cdp.run_steps(None, steps.parse_steps('login\nsso "microsoft" pick "Team"\npasscode'), 'me', 'pw',
                                app_host='app.example.com')
        self.assertEqual(calls, [('login', 'me', 'pw'), ('sso', 'microsoft', 'Team', 'app.example.com')])
        self.assertEqual((run['sso'], run['passcode'], run['failed']), (True, 'CODE', None))

    def test_code_step_sends_the_code_to_the_command(self):
        class Cli:
            proc, sent = mock.Mock(poll=lambda: None), []

            def send(self, text):
                self.sent.append(text)
        cli = Cli()
        run = cdp.run_steps(FakePage('https://sdk.cloud.google.com/authcode.html?state=s&code=4/0AbCd'),
                            [('code', None, None)], '', '', cli=cli, first=2)
        self.assertEqual((cli.sent, run['code_sent']), (['4/0AbCd'], True))

    @unittest.skipUnless(os.name == 'nt', 'the run step is a PowerShell command')
    def test_command_output_masks_the_code(self):
        with mock.patch.dict(os.environ, {'DLC_TEST_PY': sys.executable}):
            cli = cdp.CliCommand('Write-Output "Go to https://accounts.example.com/auth?x=1"; '
                                 '& $env:DLC_TEST_PY -c "print(\'got\', input())"')
            self.assertEqual(cli.wait_url(), 'https://accounts.example.com/auth?x=1')
            cli.send('4/SECRET')
            rc, out = cli.finish(30)
        self.assertEqual(rc, 0)
        self.assertIn('got ***', out)
        self.assertNotIn('SECRET', out)

    def test_gate_and_error_pages(self):
        gate = re.compile(cdp.GATE_WORDS_RE, re.I)
        self.assertTrue(gate.match('Sign in with Microsoft'))
        self.assertFalse(gate.match('Sign out'))
        self.assertTrue(cdp.on_signin_page(FakePage('chrome-error://chromewebdata/')))
        self.assertTrue(cdp._bare_ip('https://10.0.0.5:8000'))
        self.assertFalse(cdp._bare_ip('http://127.0.0.1:8795'))

    def test_engine_service_changes_are_kept(self):
        with mock.patch.dict(os.environ, {'DLC_HOME': os.path.join('X', 'home'), 'DLC_AUTOLOGIN_HEADLESS': ''}):
            self.assertEqual(cdp.account_profile(3), cdp.Path('X', 'home', 'autologin', 'profiles', 'acct-3'))
            self.assertTrue(cdp.headless())
        with mock.patch.dict(os.environ, {'DLC_AUTOLOGIN_HEADLESS': '0'}):
            self.assertFalse(cdp.headless())
        self.assertEqual(cdp.sign_in.__defaults__[0], autologin.PORT_BASE)


class EntryTest(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp(prefix="dlc-home-")
        self.env = mock.patch.dict(os.environ, {"DLC_HOME": self.home, "LINE_ASM": "0"})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        shutil.rmtree(self.home, ignore_errors=True)

    def test_steps_set_the_kind_and_provider(self):
        e = autologin.add({"name": "S", "url": "https://s.example.com", "kind": "steps", "secret": "pw",
                           "steps": 'click "Use SSO"\nsso "Google" pick "Team"\npasscode'})
        self.assertEqual((e["kind"], e["provider"]), ("passcode", "Google :: Team"))
        e = autologin.change(e["id"], {"kind": "steps", "steps": 'click "Guest"'})
        self.assertEqual((e["kind"], e["provider"]), ("steps", ""))
        with self.assertRaises(ValueError):
            autologin.change(e["id"], {"steps": 'jump "x"'})
        with self.assertRaises(ValueError):
            autologin.add({"name": "T", "url": "https://t.example.com", "kind": "steps", "steps": ""})
        with self.assertRaises(ValueError):
            autologin.add({"name": "U", "url": "https://u.example.com", "kind": "sso"})    # sso needs a provider

    def test_a_built_in_kind_still_works_without_steps(self):
        e = autologin.add({"name": "Old", "url": "https://o.example.com", "kind": "sso", "provider": "microsoft"})
        self.assertEqual((e["kind"], e["steps"]), ("sso", ""))

    def test_only_steps_that_type_the_password_need_one(self):
        guest = autologin.add({"name": "Guest", "url": "https://g.example.com", "kind": "steps",
                               "steps": 'click "Guest"', "roles": ["dev"]})
        typed = autologin.add({"name": "Typed", "url": "https://t.example.com", "kind": "steps",
                               "steps": 'fill "Password" = {{password}}', "roles": ["dev"]})
        with mock.patch("line.sidecar.cdp.sign_in", return_value={"signed_in": True, "debug_port": 9601,
                                                                  "tab": {"title": "Home", "url": "x"}}):
            self.assertIn("Signed in to Guest", autologin.call("get_session", "dev", {"app": guest["name"]}))
            with self.assertRaises(ValueError) as cm:
                autologin.call("get_session", "dev", {"app": typed["name"]})
        self.assertIn("no password stored", str(cm.exception))

    def test_cli_entry_signs_its_command_in_through_cli_login_only(self):
        e = autologin.add({"name": "gcloud", "url": "https://accounts.google.com", "kind": "cli", "roles": ["dev"]})
        self.assertEqual(e["kind"], "cli")
        self.assertIn("cli entry: use cli_login", autologin.call("list_apps", "dev", {}))
        with self.assertRaises(ValueError) as cm:
            autologin.call("get_session", "dev", {"app": "gcloud"})
        self.assertIn("use cli_login", str(cm.exception))
        done = {"command_exit": 0, "command_output": "You are now logged in as bot@x.", "tab": {}}
        with mock.patch("line.sidecar.cdp.sign_in", return_value=done) as si:
            out = autologin.call("cli_login", "dev", {"app": "gcloud"})
        self.assertIn("the command finished (exit 0)", out)
        self.assertIn("logged in as bot@x", out)
        self.assertEqual(si.call_args[0][1], "")                       # no password: the browser part needs none
        stuck = {"command_exit": None, "command_output": "", "step_failed": "step 2: click 'Allow'", "tab": {}}
        with mock.patch("line.sidecar.cdp.sign_in", return_value=stuck):
            with self.assertRaises(ValueError) as cm:
                autologin.call("cli_login", "dev", {"app": "gcloud"})
        self.assertIn("still waiting", str(cm.exception))
        with mock.patch("line.sidecar.cdp.sign_in", return_value=done):
            self.assertEqual(autologin.test(e["id"])["signed_in"], True)

    def test_a_stopped_step_says_where(self):
        e = autologin.add({"name": "App", "url": "https://a.example.com", "secret": "pw", "roles": ["dev"]})
        r = {"signed_in": False, "step_failed": "step 1: login - the page shows none of the remaining steps",
             "tab": {"title": "Login", "url": "https://a.example.com/login"}}
        with mock.patch("line.sidecar.cdp.sign_in", return_value=r):
            self.assertIn("stopped at step 1: login", autologin.test(e["id"])["text"])


if __name__ == "__main__":
    unittest.main()
