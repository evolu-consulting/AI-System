"""Drive Chrome over its DevTools debug port to perform a saved sign-in (DLC Autologin).

Vendored from the App Session Manager (repo Stools, windows/signin_driver.py at 4227d2c, version 1.10, same
author; the step language is line.sidecar.steps) with three changes for the engine service: profiles live
under DLC_HOME/autologin/profiles, Chrome runs headless unless DLC_AUTOLOGIN_HEADLESS=0 (the service has no
desktop), and debug ports start at 9600 so they never meet the App Session Manager's 9400+.

Original notes:

The caller passes an account id. This module launches (or reuses) a dedicated Chrome profile
for that account, opens the account's URL, fills the saved user and secret fields with CDP
input (which the page treats as genuine user input), submits, and waits for the page to leave
the sign-in host.

What it returns to the caller: whether it is signed in, the tab (title + URL) and the debug port.
It never returns the secret value, and it never writes that value to the log.
"""
import json
import logging
import os
import re
import shutil
import subprocess
import threading
import time
import urllib.request
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import websockets.sync.client as ws_client
from websockets.exceptions import ConnectionClosed

from .steps import STEP_ACTIONS, account_steps, parse_steps, preset_steps  # noqa: F401 (re-exported)


def _profiles_dir():
    home = os.environ.get('DLC_HOME', '').strip() or os.path.join(os.path.expanduser('~'), 'dlc')
    return Path(home) / 'autologin' / 'profiles'


def headless():
    return os.environ.get('DLC_AUTOLOGIN_HEADLESS', '1').strip() != '0'

CHROME_CANDIDATES = [
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
]

# Signals that the current page is still a sign-in step (not the signed-in app).
SIGNIN_HOST_HINTS = ('accounts.ondemand.com', 'onelogin', 'okta', 'authentication.',
                     'login.microsoftonline', 'accounts.google')
SIGNIN_PATH_HINTS = ('/login', '/signin', '/sign-in', '/sso', '/auth', '/oauth', '/saml')
SIGNIN_QUERY_HINTS = ('samlrequest', 'code_challenge', 'redirect_uri', 'next=', 'returnurl')
# A login page anywhere in the path, by its last segment: Jenkins serves its plugin login at
# /securityRealm/moLogin (miniOrange) or /securityRealm/commenceLogin, which the prefixes above miss.
SIGNIN_SEGMENT_WORDS = ('login', 'signin', 'sign-in', 'logon')
# What a login page shows when its URL does not say so: a visible password field, or a title like
# 'Sign in [Jenkins]' / 'Log in'.
# Or a sign-in gate: the app's own page that shows no field, only a 'Sign in' button sending the
# browser on to the IdP. AI DLC serves that at '/' (then Keycloak), so URL and title said signed in
# (2026-10-14).
GATE_WORDS_RE = r'^(sign ?in|log ?in|login|log ?on|đăng nhập)( with .{1,25}| to .{1,25})?$'
GATE_JS = (
    "(()=>{const re=new RegExp(%s,'i');"
    "const e=[...document.querySelectorAll('button,a,[role=button],input[type=submit]')]"
    ".find(e=>e.offsetParent!==null&&re.test((e.innerText||e.value||e.getAttribute('aria-label')||'').trim()));"
    "if(!e)return null;if(%%s){e.scrollIntoView({block:'center'});e.click();}"
    "return (e.innerText||e.value||'').trim().slice(0,40);})()") % json.dumps(GATE_WORDS_RE)
SIGNIN_PAGE_JS = (
    "(()=>{const pw=[...document.querySelectorAll('input[type=password]')].some(e=>e.offsetParent!==null);"
    "const t=(document.title||'').toLowerCase();"
    "return pw||!!" + GATE_JS % 'false' + "||/^(sign ?in|log ?in|login)\\b/.test(t);})()")

# Field heuristics, tried in order
USER_SELECTORS = ['#j_username', 'input[autocomplete=username]', 'input[type=email]',
                  'input[name=username]', '#username', 'input[name=email]', 'input[type=text]']
SECRET_SELECTORS = ['#j_password', 'input[type=password]', 'input[autocomplete=current-password]']
SUBMIT_SELECTORS = ['#logOnFormSubmit', 'button[type=submit]', 'input[type=submit]',
                    'button[name=submit]']

# Words that identify an SSO provider's button on a login page. The account's `provider` picks one.
PROVIDER_KEYWORDS = {
    'microsoft': ['microsoft', 'entra', 'azure', 'office 365', 'work or school', 'work account'],
    'google': ['google'],
    'okta': ['okta'],
    'keycloak': ['keycloak'],
    'apple': ['apple'],
    'github': ['github'],
    'saml': ['saml', 'sso'],
}


def find_chrome():
    for path in CHROME_CANDIDATES:
        if Path(path).exists():
            return path
    raise FileNotFoundError('Chrome or Edge not found')


# Chrome binds its debug port to "localhost", which some builds take as IPv6 only ([::1]); 2026-10-07 a
# window the tray had opened answered only there, so every later sign-in timed out on 127.0.0.1.
LOOPBACKS = ('127.0.0.1', '[::1]')
_HOSTS = {}                     # port -> the loopback address that answered last


def debug_url(port):
    """The address a caller can reach this debug port on (the one that answered here)."""
    return f"http://{_HOSTS.get(port, '127.0.0.1')}:{port}"


def _http_json(port, path):
    error = None
    hosts = sorted(LOOPBACKS, key=lambda h: h != _HOSTS.get(port))
    for host in hosts:
        try:
            with urllib.request.urlopen(f'http://{host}:{port}{path}', timeout=10) as r:
                answer = json.loads(r.read().decode('utf-8'))
            _HOSTS[port] = host
            return answer
        except OSError as e:
            error = e
    raise error


def wait_for_port(port, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            return _http_json(port, '/json/version')
        except OSError:
            time.sleep(0.3)
    raise TimeoutError(f'debug port {port} did not open')


PORT_FILE = 'asm-debug-port'    # in the profile: the debug port its running Chrome was started with
HEADLESS_WINDOW_SIZE = '--window-size=1618,996'  # 'Hidden' entries: page viewport 1600x900 (16:9 like 1920x1080)


def launch_profile(account_id, port, hidden=False):
    """Open (or reuse) the account's Chrome window; returns (profile, the debug port it really uses).

    A second Chrome on a profile that is already open only hands its window to the running one, so
    the port asked for now never opens if that one was started with another. The port each launch
    used is kept in the profile and tried first. hidden=True starts Chrome headless (no window,
    same profile, cookies and debug port); a Chrome already running is reused as it is.
    """
    profile = _profiles_dir() / f'acct-{account_id}'
    profile.mkdir(parents=True, exist_ok=True)
    record = profile / PORT_FILE
    try:
        running = int(record.read_text(encoding='utf-8').strip())
    except (OSError, ValueError):
        running = None
    # Already open (this account's own port, or the one its running Chrome was started with)? Reuse
    # that window as it is: starting Chrome again would only add one more window per call.
    for candidate in dict.fromkeys(p for p in (running, port) if p):
        try:
            _http_json(candidate, '/json/version')
        except OSError:
            continue
        record.write_text(str(candidate), encoding='utf-8')
        return profile, candidate
    # Chrome ignores SW_HIDE / -WindowStyle Hidden (tested 2026-10-15), so hidden runs headless.
    view = ['--headless=new', HEADLESS_WINDOW_SIZE] if hidden else ['--new-window']
    subprocess.Popen(
        [find_chrome(), f'--remote-debugging-port={port}', f'--user-data-dir={profile}',
         '--no-first-run', '--no-default-browser-check'] + view,
        # all three: the packaged tray has no console, so an inherited stdin handle is invalid
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        wait_for_port(port)
    except TimeoutError:
        if _profile_in_use(profile):
            raise TimeoutError(f'debug port {port} did not open: this account\'s Chrome window is already '
                               f'open from an earlier start with an unknown port; close that window and '
                               f'retry') from None
        raise
    record.write_text(str(port), encoding='utf-8')
    return profile, port


def _profile_in_use(profile):
    """True when a running Chrome holds the profile (Windows keeps its lockfile open)."""
    lock = profile / 'lockfile'
    if not lock.exists():
        return False
    try:
        lock.rename(lock)
        return False
    except OSError:
        return True


def close_browser(port):
    """Close the whole Chrome window for this debug port (its profile/cookies stay on disk)."""
    try:
        ws = _http_json(port, '/json/version').get('webSocketDebuggerUrl')
        if ws:
            conn = ws_client.connect(ws, open_timeout=5)
            conn.send(json.dumps({'id': 1, 'method': 'Browser.close'}))
            time.sleep(0.5)
            conn.close()
    except Exception:
        pass


def account_profile(account_id):
    return _profiles_dir() / f'acct-{int(account_id)}'


def release_profile(profile, timeout=10):
    """Close the profile's Chrome when this tool drives it (debug port known), so it can be started
    again another way. False when a Chrome still holds it, e.g. the window opened by hand."""
    try:
        close_browser(int((profile / PORT_FILE).read_text(encoding='utf-8').strip()))
    except (OSError, ValueError):
        pass
    deadline = time.monotonic() + timeout
    while _profile_in_use(profile):
        if time.monotonic() > deadline:
            return False
        time.sleep(0.5)
    return True


def open_by_hand(account_id, url):
    """Open the account's own profile as a plain Chrome window, no debug port, for the user to sign in
    by hand once. Google refuses to sign in a browser that is driven over DevTools (2026-10-19); once
    signed in here, the profile keeps the session for the driven runs. Opened again while this
    window is open, Chrome just adds a window to it."""
    profile = account_profile(account_id)
    profile.mkdir(parents=True, exist_ok=True)
    release_profile(profile, timeout=5)
    (profile / PORT_FILE).unlink(missing_ok=True)
    subprocess.Popen([find_chrome(), f'--user-data-dir={profile}', '--no-first-run',
                      '--no-default-browser-check', '--new-window', url],
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


CDP_TIMEOUT = 20        # seconds one DevTools command may take before the page is attached again


class Page:
    """One CDP connection to the active page target."""

    def __init__(self, port):
        self._port = port
        self._id = 0
        self._connect()

    def _connect(self, timeout=10, ready_timeout=30):
        """Attach to the page target. Retries briefly: during a cross-site redirect (app -> IdP ->
        app) Chrome may swap the target, and for a moment there is none. A socket opened while a fresh
        Chrome was still starting its tab never got an answer (2026-10-19), so each one is pinged and
        replaced until the page answers."""
        deadline = time.monotonic() + timeout
        ready_deadline = time.monotonic() + ready_timeout
        while True:
            pages = [t for t in _http_json(self._port, '/json') if t.get('type') == 'page']
            if not pages:
                if time.monotonic() > deadline:
                    raise RuntimeError('no page target')
                time.sleep(0.5)
                continue
            self._ws = ws_client.connect(pages[0]['webSocketDebuggerUrl'],
                                         open_timeout=10, max_size=None)
            if self._answers() or time.monotonic() > ready_deadline:
                return
            logging.info('devtools page not answering yet; attaching again')
            self.close()

    def _answers(self, timeout=2):
        self._id += 1
        ping = self._id
        self._ws.send(json.dumps({'id': ping, 'method': 'Runtime.evaluate', 'params': {'expression': '1'}}))
        try:
            end = time.monotonic() + timeout
            while True:
                if json.loads(self._ws.recv(timeout=max(0.1, end - time.monotonic()))).get('id') == ping:
                    return True
        except TimeoutError:
            return False

    def call(self, method, **params):
        try:
            return self._call(method, **params)
        except (ConnectionClosed, TimeoutError) as e:
            # The page's DevTools socket dropped mid-redirect, or it attached to a target a fresh Chrome
            # was still replacing and no answer comes (2026-10-19): attach again and retry once.
            logging.info('devtools %s during %s; reconnecting',
                         'timeout' if isinstance(e, TimeoutError) else 'socket closed', method)
            time.sleep(1)
            self.close()
            self._connect()
            return self._call(method, **params)

    def _call(self, method, **params):
        self._id += 1
        self._ws.send(json.dumps({'id': self._id, 'method': method, 'params': params}))
        deadline = time.monotonic() + CDP_TIMEOUT
        while True:
            msg = json.loads(self._ws.recv(timeout=max(0.1, deadline - time.monotonic())))
            if msg.get('id') == self._id:
                if 'error' in msg:
                    raise RuntimeError(f"{method}: {msg['error'].get('message')}")
                return msg.get('result', {})

    def eval(self, expr):
        r = self.call('Runtime.evaluate', expression=expr, returnByValue=True)
        return r.get('result', {}).get('value')

    def navigate(self, url):
        self.call('Page.enable')
        self.call('Page.navigate', url=url)

    def url(self):
        return self.eval('location.href') or ''

    def wait_for(self, selectors, timeout=20):
        """Return the first selector that matches a visible element, or None."""
        deadline = time.monotonic() + timeout
        js = ("(()=>{for(const s of %s){const e=document.querySelector(s);"
              "if(e&&e.offsetParent!==null)return s;}return null;})()")
        while time.monotonic() < deadline:
            hit = self.eval(js % json.dumps(selectors))
            if hit:
                return hit
            time.sleep(0.4)
        return None

    def fill(self, selector, text):
        """Focus the field and enter text as genuine input (not logged)."""
        self.eval(f"(()=>{{const e=document.querySelector({json.dumps(selector)});"
                  "if(e){e.focus();e.select&&e.select();e.value='';}})()")
        self.call('Input.insertText', text=text)

    def clickable_texts(self):
        """Visible button/link labels on the page (to show which SSO providers are offered)."""
        js = ("JSON.stringify([...document.querySelectorAll("
              "'button,a,[role=button],input[type=submit]')].filter(e=>e.offsetParent!==null)"
              ".map(e=>(e.innerText||e.value||e.getAttribute('aria-label')||'').trim())"
              ".filter(Boolean))")
        try:
            return json.loads(self.eval(js) or '[]')
        except (ValueError, TypeError):
            return []

    def click_text(self, keywords):
        """Click the first visible clickable whose label contains any keyword. Returns its text.

        Uses the element's own click(): provider buttons navigate in the same tab (window.location),
        which this triggers reliably -- a coordinate click misses under display scaling.
        """
        js = ("(()=>{const kw=%s;const els=[...document.querySelectorAll("
              "'button,a,[role=button],input[type=submit]')].filter(e=>e.offsetParent!==null);"
              "for(const e of els){const t=(e.innerText||e.value||e.getAttribute('aria-label')||'')"
              ".toLowerCase();if(kw.some(k=>t.includes(k))){e.scrollIntoView({block:'center'});"
              "e.click();return (e.innerText||e.value||'').trim().slice(0,60);}}return null;})()")
        return self.eval(js % json.dumps([k.lower() for k in keywords]))

    def click(self, selector):
        """Click via the element's own click(); a coordinate click misses under display scaling
        (e.g. 125%), so the mouse event is only the fallback when the element cannot be found."""
        if self.eval(f"(()=>{{const e=document.querySelector({json.dumps(selector)});"
                     "if(!e)return false;e.click();return true;})()"):
            return True
        box = self.eval(
            f"(()=>{{const e=document.querySelector({json.dumps(selector)});"
            "if(!e)return null;const r=e.getBoundingClientRect();"
            "return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2});})()")
        if not box:
            return False
        pos = json.loads(box)
        for kind in ('mousePressed', 'mouseReleased'):
            self.call('Input.dispatchMouseEvent', type=kind, x=pos['x'], y=pos['y'],
                      button='left', clickCount=1)
        return True

    def close(self):
        try:
            self._ws.close()
        except Exception:
            pass


# Buttons that advance a multi-step IdP form (Next / Sign in / Stay signed in -> Yes / consent).
NEXT_WORDS = ['next', 'sign in', 'continue', 'verify', 'yes', 'allow', 'accept', 'log in',
              'weiter', 'siguiente', 'tiếp', 'đăng nhập']


def complete_idp(page, username, secret, app_host, account_pick=None, timeout=45):
    """Walk a provider's multi-step sign-in: pick the account or type the email, then the password,
    clicking Next/Continue between steps. Stops when it can make no more progress (e.g. MFA), which
    the caller reports as awaiting_user. Only acts on the IdP's own host, never on the app's own
    login form (and never if the IdP bounced us back to the app's login)."""
    picked_account = filled_user = filled_secret = False
    idle = 0
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        here = page.url()
        if (urlsplit(here).hostname or '') == app_host:
            # Back on the app's own host. If it's no longer a login page we are signed in; if it is
            # (the chooser, or a bounce-back), do not fill the app's own local form.
            if not is_signin_page(here):
                return
            idle += 1
            if idle >= 3:
                return
            time.sleep(1)
            continue
        # Otherwise we are on the IdP's host -- keep driving its (possibly multi-step) form, whose
        # intermediate URLs do not always look like a login page.
        # Each round does at most one thing; progress resets the idle counter. The IdP is often a
        # SPA whose URL does not change between steps, so progress is tracked by action, not URL.
        # Fill visible fields first; only treat a username match as an account tile when there is
        # no field to fill (a dedicated account/role picker page).
        acted = False
        psel = page.wait_for(SECRET_SELECTORS, timeout=1)
        usel = page.wait_for(USER_SELECTORS, timeout=1)
        if psel and secret and not filled_secret:
            page.fill(psel, secret)
            filled_secret = True
            _advance(page)
            acted = True
        elif usel and username and not filled_user:
            page.fill(usel, username)
            filled_user = True
            _advance(page)
            acted = True
        elif account_pick and page.click_text([account_pick]):
            acted = True               # an account / role tile (e.g. SAP super vs personal)
        elif username and not picked_account and page.click_text([username]):
            picked_account = True      # an account-picker tile keyed by the email
            acted = True
        elif _advance(page):           # a plain Continue / Yes / consent step
            acted = True
        logging.info('idp step host=%s path=%s psel=%s usel=%s filled_user=%s filled_secret=%s '
                     'acted=%s idle=%s', urlsplit(here).hostname, urlsplit(here).path[:24],
                     bool(psel), bool(usel), filled_user, filled_secret, acted, idle)
        if acted:
            idle = 0
            time.sleep(2)
        else:
            idle += 1                      # an unknown step (e.g. MFA or a role chooser)
            if idle >= 3:
                return
            time.sleep(1.5)


def extract_passcode(page):
    """Read a one-time passcode from a passcode page (e.g. SAP's 'Temporary Authentication Code').
    Returns the code only when that exact label is present, to avoid grabbing an unrelated token
    off a login page. The value is never logged."""
    js = ("(()=>{const hs=[...document.querySelectorAll('h1,h2,h3')];"
          "const i=hs.findIndex(e=>/temporary authentication code|your (one-time |)passcode/i"
          ".test(e.innerText||''));"
          "if(i<0)return null;"
          "for(let j=i+1;j<hs.length;j++){const t=(hs[j].innerText||'').trim();"
          "if(/^[A-Za-z0-9._-]{5,64}$/.test(t))return t;}return null;})()")
    return page.eval(js)


CLI_URL_TIMEOUT = 30    # seconds the 'run' command has to print its sign-in URL
CLI_EXIT_TIMEOUT = 60   # seconds it has to finish once the code is in (or with no URL at all)
CLI_OUTPUT_MAX = 2000   # characters of its output kept for the caller


class CliCommand:
    """The 'run' step's PowerShell command (kind 'cli'). Its output is read on a thread, so the sign-in
    URL it prints can be opened while it waits, and the 'code' step can write the code to its stdin."""

    def __init__(self, command):
        shell = shutil.which('pwsh') or shutil.which('powershell') or 'powershell'
        self.proc = subprocess.Popen(
            [shell, '-NoProfile', '-Command', command], stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8',
            errors='replace', env={**os.environ, 'PYTHONUNBUFFERED': '1'},
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        self.lines, self.secrets = [], []
        threading.Thread(target=lambda: self.lines.extend(iter(self.proc.stdout.readline, '')),
                         daemon=True).start()
        logging.info('cli step: started %r (pid %s)', command, self.proc.pid)

    def wait_url(self, timeout=CLI_URL_TIMEOUT):
        """The first https:// URL it prints, or None when it ends (or stays silent) without one."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            for line in list(self.lines):
                m = re.search(r'https://\S+', line)
                if m:
                    return m.group(0)
            if self.proc.poll() is not None:
                time.sleep(0.3)               # let the reader take the last lines
                if not any('https://' in line for line in self.lines):
                    return None
            time.sleep(0.3)
        return None

    def send(self, text):
        self.secrets.append(text)
        self.proc.stdin.write(text + '\n')
        self.proc.stdin.flush()

    def finish(self, timeout=CLI_EXIT_TIMEOUT):
        """(exit code or None when it had to be stopped, its output with every sent code masked)."""
        try:
            rc = self.proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            subprocess.run(['taskkill', '/T', '/F', '/PID', str(self.proc.pid)], capture_output=True)
            rc = None
        time.sleep(0.3)
        out = ''.join(self.lines)
        for s in self.secrets:
            out = out.replace(s, '***')
        out = re.sub(r'\x1b\[[0-9;]*m', '', out).strip()
        return rc, out[-CLI_OUTPUT_MAX:]


def extract_code(page):
    """The verification code a CLI sign-in ends on: gcloud's authcode page carries it in the URL
    (?code=...) and shows it in a box; else the one visible token-like text in a field or code box."""
    code = (parse_qs(urlsplit(page.url()).query).get('code') or [None])[0]
    if code:
        return code
    return page.eval(
        "(()=>{const v=[...document.querySelectorAll('textarea,input,code,pre,kbd')]"
        ".filter(e=>e.offsetParent!==null).map(e=>(e.value||e.innerText||'').trim())"
        ".filter(t=>t.length>=20&&!/\\s/.test(t));return v.length===1?v[0]:null;})()")


def _advance(page):
    """Click a submit button, or a Next/Continue/Yes button, via the element's own click()
    (reliable across display scaling, where a coordinate click can miss)."""
    js = ("(()=>{let e=document.querySelector('#logOnFormSubmit,button[type=submit],"
          "input[type=submit]');if(e&&e.offsetParent!==null){e.click();return 'submit';}"
          "const kw=%s;const els=[...document.querySelectorAll('button,a,[role=button],"
          "input[type=submit]')].filter(x=>x.offsetParent!==null);"
          "for(const x of els){const t=(x.innerText||x.value||'').toLowerCase().trim();"
          "if(kw.some(k=>t.includes(k))){x.click();return (x.innerText||x.value||'').trim()"
          ".slice(0,40);}}return null;})()")
    return page.eval(js % json.dumps(NEXT_WORDS))


def is_signin_page(url):
    """True while the browser is on a sign-in / redirect page, by host, path or query.

    This is what tells a signed-in app (we stay on the target page) from one that bounced us to
    a login screen -- whether that screen is a separate SSO host or the app's own /login path.
    """
    p = urlsplit(url)
    host = (p.hostname or '').lower()
    path = (p.path or '').lower().rstrip('/')
    query = (p.query or '').lower()
    if any(hint in host for hint in SIGNIN_HOST_HINTS):
        return True
    if any(path == s or path.startswith(s + '/') for s in SIGNIN_PATH_HINTS):
        return True
    last = path.rsplit('/', 1)[-1]
    if any(word in last for word in SIGNIN_SEGMENT_WORDS):
        return True
    return any(hint in query for hint in SIGNIN_QUERY_HINTS)


def settle(page, quiet=2.5, timeout=15, clock=time.monotonic, sleep=time.sleep):
    """Wait until the tab stops moving: loaded, and the same URL for `quiet` seconds (or `timeout`).

    A single-page app answers the first request with its shell and only then redirects to its login
    in JavaScript. Judging at a fixed 2 s mark said 'signed in' on Keycloak's admin console, whose shell
    sat on /admin/master/console/ just before it bounced to the realm's login page (2026-10-11).
    Returns the URL it settled on.
    """
    deadline = clock() + timeout
    last, since = None, clock()
    while True:
        try:
            url = page.url()
            ready = page.eval('document.readyState') == 'complete'
        except Exception:
            url, ready = None, False          # mid-navigation: the context is being replaced
        now = clock()
        if url != last or not ready:
            last, since = url, now
        elif now - since >= quiet:
            return url or ''
        if now >= deadline:
            return url or ''
        sleep(0.5)


def on_signin_page(page):
    """is_signin_page on the tab's URL, or the page itself looks like a login (password field,
    'Sign in' title). The URL alone said 'signed in' on Jenkins' login page (2026-10-09).
    Chrome's own error page (no network, certificate) is never 'signed in' (Scrubb, 2026-10-14)."""
    url = page.url()
    if is_signin_page(url) or url.startswith('chrome-error://'):
        return True
    try:
        return bool(page.eval(SIGNIN_PAGE_JS))
    except Exception:
        logging.exception('reading the page for a login form failed')
        return False


def sign_in(account, secret, port=9600, settle_s=6):
    """account: public dict from the vault. secret: the stored value. Returns a status dict.

    kind='sso': never type anything. The account's browser profile is persistent, so the user
    signs in once in the window it opens; afterwards the session is reused with no secret.
    """
    steps = parse_steps(account_steps(account))
    if steps and steps[0][0] == 'run':
        return _cli_sign_in(account, secret, steps, port)
    profile, port = launch_profile(account['id'], port, hidden=headless())
    page = Page(port)
    try:
        if _bare_ip(account['url']):
            # A server reached by bare IP (a VPS, a lab box) can only have a self-signed certificate,
            # and Chrome stops on its warning page. For such an entry only, accept it in this tab.
            page.call('Security.setIgnoreCertificateErrors', ignore=True)
        page.navigate(account['url'])
        time.sleep(1)
        settle(page)

        # Already authenticated? Then the target URL stayed put instead of bouncing to a login page.
        if not on_signin_page(page):
            return _result(account, port, profile, page.url(), reused=True, page=page)

        # Every kind is a list of steps (2026-10-15): password, sso and passcode are presets made of
        # the smart steps 'login', 'sso' and 'passcode'; a custom entry mixes them with plain ones.
        run = run_steps(page, steps, account.get('username'), secret,
                        app_host=urlsplit(account['url']).hostname)
        if run['sso']:
            time.sleep(1)             # the sso step already waited for the IdP to hand back
        elif not run['failed']:       # failed: it already waited out its timeout
            _wait_off_signin(page, settle_s)
        result = _result(account, port, profile, page.url(), reused=False, awaiting_user=run['sso'],
                         page=page, provider_clicked=run['provider_clicked'],
                         providers_available=run['providers_available'], passcode=run['passcode'],
                         step_failed=run['failed'])
        if run['passcode'] or run['failed']:
            # Got the one-time code, or the steps timed out on a screen none of them knows -> close
            # the window so it doesn't pile up. The profile's cookies stay on disk, so the next
            # fetch can reuse the session.
            close_browser(port)
        return result
    finally:
        page.close()


def _cli_sign_in(account, secret, steps, port):
    """kind 'cli': start the command, finish the sign-in it opens in the entry's Chrome window, and
    report how the command ended. The window is closed afterwards; its cookies stay for next time."""
    cli = CliCommand(steps[0][1])
    page = profile = None
    run = {'failed': None, 'sso': False, 'provider_clicked': None, 'providers_available': [],
           'passcode': None, 'code_sent': False}
    try:
        url = cli.wait_url()
        if url:
            profile, port = launch_profile(account['id'], port, hidden=headless())
            page = Page(port)
            page.navigate(url)
            time.sleep(1)
            settle(page)
            run = run_steps(page, steps[1:], account.get('username'), secret,
                            app_host=urlsplit(url).hostname, cli=cli, first=2)
        # A command that printed no URL just runs to its end (e.g. already signed in). With a URL and
        # no code sent, it is still waiting for one: give it a moment, then stop it.
        wait = CLI_EXIT_TIMEOUT if (not url or run['code_sent']
                                    or not any(a == 'code' for a, _, _ in steps)) else 5
        rc, out = cli.finish(wait)
        logging.info('cli sign-in account=%s exit=%s code_sent=%s', account['id'], rc, run['code_sent'])
        final_url = page.url() if page else ''
        result = _result(account, port, profile, final_url, reused=False, page=None,
                         step_failed=run['failed'])
        result.update(signed_in=rc == 0, command_exit=rc, command_output=out,
                      awaiting_user=bool(url) and rc is None and not run['failed'])
        return result
    finally:
        if cli.proc.poll() is None:
            cli.finish(0)
        if page is not None:
            page.close()
            close_browser(port)


def password_login(page, username, secret):
    """The 'login' step: find the user and secret fields by heuristics, fill them and submit.
    Clicks a sign-in gate first and handles two-step forms (user, Next, then secret)."""
    user_sel = page.wait_for(USER_SELECTORS, timeout=8)
    if not user_sel and not page.wait_for(SECRET_SELECTORS, timeout=1):
        # A gate page: no field yet, only a 'Sign in' button leading to the real login form.
        gate = page.eval(GATE_JS % 'true')
        if gate:
            logging.info('clicked sign-in gate %r', gate)
            time.sleep(1)
            settle(page, quiet=1.5)
            user_sel = page.wait_for(USER_SELECTORS, timeout=10)
    secret_sel = page.wait_for(SECRET_SELECTORS, timeout=5)
    if user_sel:
        page.fill(user_sel, username or '')
    if secret_sel:
        page.fill(secret_sel, secret or '')
    else:
        # Two-step forms: submit the user, then wait for the secret field
        if user_sel and page.wait_for(SUBMIT_SELECTORS, timeout=3):
            page.click(page.wait_for(SUBMIT_SELECTORS, timeout=3))
            time.sleep(2)
        secret_sel = page.wait_for(SECRET_SELECTORS, timeout=8)
        if secret_sel:
            page.fill(secret_sel, secret or '')
    submit_sel = page.wait_for(SUBMIT_SELECTORS, timeout=5)
    if submit_sel:
        page.click(submit_sel)


def sso_login(page, provider, account_pick, username, secret, app_host):
    """The 'sso' step: click the provider's button, then drive the IdP (pick the saved account or
    type the email + password). Whatever can't be automated (MFA) is left for the user.
    Returns (the button text it clicked or None, the buttons the page offered)."""
    provider = (provider or '').strip().lower()
    keywords = PROVIDER_KEYWORDS.get(provider, [provider] if provider else [])
    clicked, available = None, []
    # Wait for the (often SPA) login page to render its buttons, then let the click
    # handlers wire up before clicking.
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        available = page.clickable_texts()
        if available:
            break
        time.sleep(0.5)
    time.sleep(1.5)
    if keywords:
        clicked = page.click_text(keywords)
    if not clicked:
        # A remembered session shows an account tile instead of the IdP chooser -- click it.
        clicked = ((account_pick and page.click_text([account_pick]))
                   or (username and page.click_text([username])))
    if clicked:
        # Wait to leave the app's login page (to the IdP, or straight to the final page)
        # before touching any field -- the app's own login page may have its own inputs.
        idp_deadline = time.monotonic() + 15
        while time.monotonic() < idp_deadline:
            time.sleep(0.5)
            if urlsplit(page.url()).hostname != app_host or not on_signin_page(page):
                break
        complete_idp(page, username, secret, app_host, account_pick)
        # The IdP hands back to the app with a few redirects (about 10 s for Jenkins):
        # wait for the app to leave its login page before judging the result.
        back_deadline = time.monotonic() + 20
        while time.monotonic() < back_deadline and on_signin_page(page):
            time.sleep(1)
    return clicked, available


def read_passcode(page, timeout=15):
    """The 'passcode' step: wait for the passcode page to render the code; clicks nothing."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        passcode = extract_passcode(page)
        if passcode:
            return passcode
        time.sleep(1.5)
    return None


def _bare_ip(url):
    import ipaddress
    try:
        ipaddress.ip_address(urlsplit(url).hostname or '')
        return urlsplit(url).scheme == 'https'
    except ValueError:
        return False


def _wait_off_signin(page, settle_s):
    """Wait for the post-submit redirect to settle back on the app (or give up after a while)."""
    deadline = time.monotonic() + settle_s + 12
    while time.monotonic() < deadline:
        time.sleep(1)
        if not on_signin_page(page):
            break
    settle(page)                          # an SPA may still bounce back to its login after a redirect


# Find the element a person means by `t`: an exact CSS selector, an id, a name, then the visible text
# of a button/link/tab, a field's label, placeholder or aria-label. For a field, a label resolves to the
# input it names. Looks inside same-origin iframes and open shadow roots too.
FIND_JS = r"""(t, forInput) => {
  const vis = e => !!(e && (e.offsetParent !== null || e.getClientRects().length));
  const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const want = norm(t);
  const roots = [];
  const walk = r => { roots.push(r); r.querySelectorAll('*').forEach(e => { if (e.shadowRoot) walk(e.shadowRoot); });
    r.querySelectorAll('iframe').forEach(f => { try { if (f.contentDocument) walk(f.contentDocument); } catch (_) {} }); };
  walk(document);
  const all = sel => roots.flatMap(r => [...r.querySelectorAll(sel)]).filter(vis);
  const isField = e => /^(input|textarea|select)$/i.test(e.tagName) || e.isContentEditable;
  const fieldOf = e => { if (!e) return null; if (isField(e)) return e;
    if (e.htmlFor) { const f = e.getRootNode().getElementById?.(e.htmlFor) || document.getElementById(e.htmlFor); if (f) return f; }
    return e.querySelector('input,textarea,select'); };
  const pick = e => forInput ? fieldOf(e) : e;
  try { const hit = all(t)[0]; if (hit) return pick(hit); } catch (_) {}
  for (const e of all('[id],[name],[data-testid]'))
    if ([e.id, e.getAttribute('name'), e.getAttribute('data-testid')].some(v => v && norm(v) === want)) return pick(e);
  const fields = all('input,textarea,select');
  for (const e of fields)
    if ([e.placeholder, e.getAttribute('aria-label'), e.labels && [...e.labels].map(l => l.innerText).join(' ')]
        .some(v => norm(v) === want)) return e;
  const clickables = 'button,a,[role=button],[role=tab],[role=link],[role=menuitem],input[type=submit],input[type=button],label,summary';
  const label = e => norm(e.innerText || e.value || e.getAttribute('aria-label') || e.title);
  for (const exact of [true, false]) {
    for (const e of all(clickables)) { const l = label(e); if (exact ? l === want : l.includes(want)) return pick(e); }
    if (forInput) for (const e of fields)
      if ([e.placeholder, e.getAttribute('aria-label')].some(v => exact ? norm(v) === want : norm(v).includes(want))) return e;
  }
  if (!forInput) for (const e of all('div,span,p,h1,h2,h3,li,td')) if (norm(e.innerText) === want) return e;
  return null;
}"""

KEYS = {'enter': ('Enter', 13, '\r'), 'tab': ('Tab', 9, '\t'), 'escape': ('Escape', 27, None),
        'space': (' ', 32, ' ')}


def _step_eval(page, target, for_input, act):
    """Run `act` (JS on the found element `e`) on the element `target` names; None when not found."""
    return page.eval(f"(()=>{{const e=({FIND_JS})({json.dumps(target)},{json.dumps(for_input)});"
                     f"if(!e)return null;e.scrollIntoView({{block:'center'}});{act}}})()")


# Steps that act without looking at the page (or drive their own waits) when they are the next one.
BLIND_STEPS = ('pause', 'press', 'login', 'sso', 'passcode')
SKIP_GRACE = 2.0        # seconds the next step must stay missing before a later step's screen is taken


def _on_screen(page, step, app_host):
    """True when the page shows what this step acts on: its element, or for a smart step its kind of
    screen (a login form or gate, the provider's button or the IdP, the passcode). pause/press: never."""
    action, target, value = step
    try:
        if action in ('click', 'wait', 'fill'):
            return bool(_step_eval(page, target, action == 'fill', 'return true;'))
        if action == 'login':
            return bool(page.eval("[...document.querySelectorAll(%s)].some(e=>e.offsetParent!==null)"
                                  % json.dumps(','.join(USER_SELECTORS + SECRET_SELECTORS)))
                        or page.eval(GATE_JS % 'false'))
        if action == 'sso':
            keywords = PROVIDER_KEYWORDS.get((target or '').lower(), [target.lower()] if target else [])
            texts = [t.lower() for t in page.clickable_texts()]
            return (any(k in t for k in keywords for t in texts)
                    or bool(app_host and (urlsplit(page.url()).hostname or '') != app_host))
        if action == 'passcode':
            return bool(extract_passcode(page))
        if action == 'code':
            return bool(extract_code(page))
    except Exception:
        pass                                  # mid-navigation: the context is being replaced
    return False


def _do_step(page, run, n, step, username, secret, app_host, cli=None):
    """Perform one step. False when its element was gone by the time it acted (look again)."""
    action, target, value = step
    if action == 'code':
        code = extract_code(page)
        if not code or cli is None:
            return False
        try:
            cli.send(code)
        except OSError:                       # the command ended meanwhile; run_steps sees it next round
            return False
        run['code_sent'] = True
        logging.info('custom sign-in step %s: code sent to the command', n)
    elif action == 'pause':
        time.sleep(target)
    elif action == 'login':
        password_login(page, username, secret)
        logging.info('custom sign-in step %s: login ran', n)
    elif action == 'sso':
        run['sso'] = True
        clicked, available = sso_login(page, target, value, username, secret, app_host)
        run['provider_clicked'] = run['provider_clicked'] or clicked
        run['providers_available'] = available
    elif action == 'passcode':
        run['passcode'] = read_passcode(page)
    elif action == 'press':
        key, code, text = KEYS.get(target.lower(), (target, 0, target if len(target) == 1 else None))
        for kind in ('keyDown', 'keyUp'):
            params = {'type': kind, 'key': key, 'windowsVirtualKeyCode': code}
            if kind == 'keyDown' and text:
                params['text'] = text
            page.call('Input.dispatchKeyEvent', **params)
        time.sleep(0.8)
    else:
        try:
            if action == 'wait':
                done = _step_eval(page, target, False, 'return true;')
            elif action == 'click':
                done = _step_eval(page, target, False, 'e.click();return true;')
            else:   # fill: focus + clear, then type as genuine input
                done = _step_eval(page, target, True,
                                  "e.focus();e.select&&e.select();"
                                  "if('value' in e){e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));}"
                                  "return true;")
                if done:
                    page.call('Input.insertText', text=value.replace('{{username}}', username or '')
                              .replace('{{password}}', secret or ''))
        except Exception:
            done = None                       # mid-navigation; look again
        if not done:
            return False
        logging.info('custom sign-in step %s: %s %r ok', n, action, target)
        time.sleep(1.2 if action == 'click' else 0.3)
    return True


def run_steps(page, steps, username, secret, app_host=None, timeout=20,
              clock=time.monotonic, sleep=time.sleep, cli=None, first=1, progress=None):
    """Run the steps by what the screen shows, not by blind order (2026-10-16).

    A site does not always show every screen: Scrubb's certificate warning (steps 'Advanced',
    'Proceed') never appears once the tab accepts the certificate, so step 1 waited for nothing.
    Each round looks for the next step's element first; when it stays missing for SKIP_GRACE while a
    later step's screen is showing, the steps in between are skipped and that one runs. Forward only:
    a step that ran is never run again. When no remaining step matches for `timeout` (the app
    changed, or the page never loaded) the run stops; it is a failure only while the tab is still on
    a login page. Returns {failed: None or where it stopped (never a value), sso: whether an sso
    step ran, provider_clicked, providers_available, passcode, code_sent}. `cli`: the command a
    'code' step writes to; `first`: the number of steps[0] (2 after a 'run' step); `progress(n)`: told
    after each step that ran, n = how many of `steps` are behind (ran or skipped)."""
    run = {'failed': None, 'sso': False, 'provider_clicked': None, 'providers_available': [],
           'passcode': None, 'code_sent': False}
    i, idle_since, missing_since = 0, clock(), None
    while i < len(steps):
        if cli is not None and cli.proc.poll() is not None:
            logging.info('custom sign-in: the command ended before step %s', i + first)
            return run
        if steps[i][0] in BLIND_STEPS:
            _do_step(page, run, i + first, steps[i], username, secret, app_host, cli)
            i, idle_since, missing_since = i + 1, clock(), None
            if progress:
                progress(i)
            continue
        hit = next((j for j in range(i, len(steps))
                    if steps[j][0] not in ('pause', 'press') and _on_screen(page, steps[j], app_host)), None)
        now = clock()
        if hit is not None and hit > i:
            missing_since = missing_since or now
            if now - missing_since < SKIP_GRACE:
                hit = None                    # give the expected screen a moment to finish loading
            else:
                logging.info('custom sign-in: the page shows step %s, skipping step(s) %s-%s',
                             hit + first, i + first, hit + first - 1)
        if hit is not None:
            if _do_step(page, run, hit + first, steps[hit], username, secret, app_host, cli):
                i, idle_since, missing_since = hit + 1, clock(), None
                if progress:
                    progress(i)
            continue
        if now - idle_since > timeout:
            action, target, _ = steps[i]
            what = f'step {i + first}: {action}' + (f' {target!r}' if target is not None else '')
            if on_signin_page(page):
                logging.info('custom sign-in stopped at %s: no remaining step matches the page', what)
                run['failed'] = (f'{what} - the page shows none of the remaining steps '
                                 f'(the app changed or did not finish loading)')
            else:
                logging.info('custom sign-in: off the login page at %s; remaining steps not needed', what)
            return run
        sleep(0.5)
    return run


def _result(account, port, profile, final_url, reused, awaiting_user=False, page=None,
            provider_clicked=None, providers_available=None, passcode=None, step_failed=None):
    """The outcome for the caller: signed in or not, and which tab holds the session.

    Deliberately lean: no cookies, no profile path, no secret. The session stays inside the
    account's own Chrome window; the caller drives that tab over debug_port.
    """
    if page is not None:
        signed_in = not on_signin_page(page) or bool(passcode)
    else:
        signed_in = not is_signin_page(final_url) or bool(passcode)
    title = ''
    if page is not None:
        try:
            title = page.eval('document.title') or ''
        except Exception:
            logging.exception('reading the tab title failed')
    logging.info('sign-in account=%s host=%s signed_in=%s reused=%s awaiting_user=%s',
                 account['id'], account['host'], signed_in, reused,
                 awaiting_user and not signed_in)
    return {
        'account_id': account['id'],
        'host': account['host'],
        'kind': account.get('kind', 'password'),
        'debug_port': port,
        'debug_url': debug_url(port),
        'final_url': final_url,
        'tab': {'title': title, 'url': final_url},
        'provider': account.get('provider', ''),
        'signed_in': signed_in,
        'reused_session': reused,
        'awaiting_user': awaiting_user and not signed_in,
        'provider_clicked': provider_clicked,
        'providers_available': providers_available or [],
        'passcode': passcode,
        'step_failed': step_failed,
    }
