"""The sign-in step language of DLC Autologin, shared by the entry store (validation) and the driver (cdp).

Vendored from the App Session Manager (repo Stools, windows/steps.py at 4227d2c, same author) unchanged, so
an entry's steps read the same in both tools. No Chrome or network here.
"""
import shlex


# Custom steps (kind='steps'): one step per line, written for people, not developers.
#   click "Sign in"                 a button, link, field, label or tab by the text on it
#   fill "Username or email" = {{username}}
#   fill #password = {{password}}   a target may also be an id (#x), a name, or any CSS selector
#   press Enter
#   wait "Welcome"                  wait until that text or element shows (max 20 s)
#   pause 2                         seconds
# Smart steps, the built-in kinds are made of them (see preset_steps):
#   login                           find the user + password fields, fill them and submit
#   sso "microsoft" pick "P2009"    click that provider's button and drive its IdP; pick = an
#                                   account/role tile to choose (optional)
#   passcode                        read the SAP one-time passcode off the page
# CLI sign-in (kind='cli', 2026-10-19), e.g. gcloud:
#   run "gcloud auth login --no-launch-browser"
#                                   step 1 only: start this PowerShell command; the sign-in URL it
#                                   prints opens in the entry's Chrome window (none: it just runs)
#   code                            send the code the page shows (gcloud's authcode page) to the
#                                   command, then wait for it to finish
# {{username}} and {{password}} are the entry's stored values; nothing else is ever substituted.
STEP_ACTIONS = ('click', 'fill', 'press', 'wait', 'pause', 'login', 'sso', 'passcode', 'run', 'code')
GCLOUD_LOGIN = 'gcloud auth login --no-launch-browser'


def _q(text):
    return '"' + str(text).replace('\\', '\\\\').replace('"', '\\"') + '"'


def preset_steps(kind, provider=''):
    """The steps a built-in kind stands for; '' for 'steps' (the user's own).
    provider may carry an account/role pick after '::': "default identity provider :: S0027619414"."""
    if kind == 'password':
        return 'login'
    if kind in ('sso', 'passcode'):
        name, _, pick = (provider or '').partition('::')
        if not name.strip():
            raise ValueError(f'a {kind} account needs a provider')
        line = 'sso ' + _q(name.strip()) + (' pick ' + _q(pick.strip()) if pick.strip() else '')
        return line + ('\npasscode' if kind == 'passcode' else '')
    if kind == 'cli':
        return 'run ' + _q(GCLOUD_LOGIN) + '\ncode'
    return ''


def account_steps(account):
    """The steps an entry runs: its own, or its kind's preset."""
    return (account.get('steps') or '').strip() or preset_steps(account.get('kind') or 'password',
                                                                account.get('provider'))


def parse_steps(text):
    """[(action, target, value)] from the step lines; blank lines and '#'-comments are skipped.
    Raises ValueError naming the first line it cannot read."""
    steps = []
    for n, raw in enumerate((text or '').splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith('//') or line.startswith('# '):
            continue
        action, _, rest = line.partition(' ')
        action = action.lower()
        if action not in STEP_ACTIONS:
            raise ValueError(f"step {n}: '{action}' is not one of {', '.join(STEP_ACTIONS)}")
        target, value = rest.strip(), None
        if action in ('login', 'passcode', 'code'):
            steps.append((action, None, None))
            continue
        if action == 'run':
            if steps:
                raise ValueError(f'step {n}: run must be the first step')
            try:
                parts = shlex.split(rest, posix=True)
            except ValueError as e:
                raise ValueError(f'step {n}: {e}') from None
            if len(parts) != 1 or not parts[0].strip():
                raise ValueError(f'step {n}: run needs the command in quotes: run "gcloud auth login"')
            steps.append(('run', parts[0].strip(), None))
            continue
        if action == 'sso':
            try:
                parts = shlex.split(rest, posix=True)
            except ValueError as e:
                raise ValueError(f'step {n}: {e}') from None
            if not parts:
                raise ValueError(f'step {n}: sso needs a provider')
            pick = None
            if len(parts) >= 3 and parts[-2].lower() == 'pick':
                pick, parts = parts[-1], parts[:-2]
            provider = ' '.join(parts)
            if '::' in provider and not pick:     # the stored "provider :: role" form
                provider, _, pick = (s.strip() for s in provider.partition('::'))
            steps.append(('sso', provider, pick or None))
            continue
        if action == 'fill':
            # the value follows the last ' = ' (a target text may hold '=' itself only inside quotes)
            try:
                parts = shlex.split(rest, posix=True)
            except ValueError as e:
                raise ValueError(f'step {n}: {e}') from None
            if '=' not in parts or parts.index('=') == 0:
                raise ValueError(f"step {n}: fill needs  <target> = <value>")
            i = len(parts) - 1 - parts[::-1].index('=')
            target, value = ' '.join(parts[:i]), ' '.join(parts[i + 1:])
        elif target[:1] in '"\'' and target[-1:] == target[:1] and len(target) > 1:
            target = target[1:-1]
        if action in ('click', 'fill', 'wait', 'press') and not target:
            raise ValueError(f'step {n}: {action} needs a target')
        if action == 'pause':
            try:
                target = float(target or 1)
            except ValueError:
                raise ValueError(f'step {n}: pause takes seconds') from None
        steps.append((action, target, value))
    if any(a == 'code' for a, _, _ in steps) and not (steps and steps[0][0] == 'run'):
        raise ValueError('a code step needs a run step first: it sends the code to that command')
    return steps
