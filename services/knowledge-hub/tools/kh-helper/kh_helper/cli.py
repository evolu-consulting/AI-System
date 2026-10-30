"""kh - the Knowledge Hub helper.

  kh login  [--kh-url URL] [--no-browser]   sign in (a person, in a browser, with Google or Microsoft;
                                            --no-browser: finish on another device with a code)
  kh password                                change your own KH password, in a browser (no account console)
  kh logout                                  revoke the sign-in and forget it on this machine
  kh status                                  who is signed in, until when (never shows a token)
  kh me                                      what KH says you may do
  kh call METHOD PATH [JSON]                 call KH as the signed-in person; prints the JSON answer
  kh members people PROJECT                  name, e-mail and level of everyone on a project (any member)
  kh members list PROJECT                    the same with who granted what (needs the right to manage people)
  kh members add PROJECT EMAIL [--level L]   add someone (owner|editable|readonly, default readonly);
                                             a new person (no account) needs a tenant or system admin
  kh members remove PROJECT EMAIL            take someone off a project
  kh members exclude PROJECT EMAIL           shut someone out, even of a semi-public or public project
  kh members include PROJECT EMAIL           lift that; kh members exclusions PROJECT lists them
  kh catalog                                 the access model as it is now: roles, levels, tenants
  kh message send PROJECT RECEIVER TEXT      leave a message for one member (e-mail) or 'all' of a project
  kh message inbox                           your unread messages (delivering them marks them read)
  kh mcp                                    run as an MCP server over stdio, for assistants
  kh setup [--remove] [--settings PATH] [--no-mcp]
                                             connect KH to the CLI this copy is installed in (Claude Code, Grok,
                                             Codex, Gemini): MCP server, plus hooks where the CLI has them;
                                             --remove takes it out AND ends every sign-in of this copy
  kh uninstall                               take KH out of that CLI, end every sign-in, delete this helper
  kh hook EVENT [--cli CLI]                  what a CLI hook runs (SessionStart, UserPromptSubmit, PreToolUse, Stop)
  kh worklog                                 store the queued turns' work logs (the Stop hook starts it)
  kh upgrade [--from URL|FILE] [--force]     install the newest published helper into this copy (the link in
                                             KH's versions row ver_kh-helper, e.g. a public Drive zip), then setup
  kh artifact upload FILE [--module M --version V]
                                             publish a file KH hands out, e.g. a kh-helper wheel (maintainers);
                                             no KH redeploy. kh artifact list: what is published

Exit codes: 0 ok, 1 KH answered with an error, 2 not signed in, 3 this sign-in belongs to another CLI.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import clis, owner
from .session import HOME, NotSignedIn, PasswordNotChanged, Session


def _print(payload) -> None:
    print(json.dumps(payload, indent=2, ensure_ascii=False) if not isinstance(payload, str) else payload)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="kh", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--kh-url", help="KH deployment (default: the last one used, or KH_URL)")
    # --kh-url is accepted after the command too ("kh login --kh-url ..."), which is how people type it.
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--kh-url", default=argparse.SUPPRESS, help=argparse.SUPPRESS)
    sub = parser.add_subparsers(dest="command", required=True)
    add = lambda name: sub.add_parser(name, parents=[common])  # noqa: E731
    login = add("login")
    login.add_argument("--no-browser", action="store_true")
    add("password")
    add("logout")
    add("status")
    add("me")
    call = add("call")
    call.add_argument("method")
    call.add_argument("path")
    call.add_argument("body", nargs="?", help="JSON body, or @file.json, or - for stdin")
    add("mcp")
    mem = add("members")
    mem.add_argument("action", choices=["people", "list", "add", "remove", "exclude", "include", "exclusions"])
    mem.add_argument("project")
    mem.add_argument("email", nargs="?")
    mem.add_argument("--level", default="readonly", choices=["owner", "editable", "readonly"])
    add("catalog")
    msg = add("message")
    msg.add_argument("action", choices=["send", "inbox"])
    msg.add_argument("project", nargs="?")
    msg.add_argument("receiver", nargs="?")
    msg.add_argument("text", nargs="?")
    setup = add("setup")
    setup.add_argument("--remove", action="store_true")
    setup.add_argument("--settings", help="config file to change (default: the CLI's own)")
    setup.add_argument("--no-mcp", action="store_true", help="only the hooks, leave MCP servers alone")
    add("uninstall")
    hook = add("hook")
    hook.add_argument("event")
    hook.add_argument("--cli", default=owner.CLAUDE_CODE, help="which CLI runs the hook (output shape)")
    add("worklog")
    up = add("upgrade")
    up.add_argument("--from", dest="source", default=None, help="a URL, zip or wheel instead of KH's published one")
    up.add_argument("--force", action="store_true", help="install even when not newer")
    art = add("artifact")
    art.add_argument("action", choices=["upload", "list"])
    art.add_argument("file", nargs="?")
    art.add_argument("--module", default="")
    art.add_argument("--version", default="")
    args = parser.parse_args(argv)

    session = Session(args.kh_url)
    try:
        if args.command == "login":
            signed = session.login(open_browser=not args.no_browser)
            print(f"Signed in as {signed.get('email')} until {signed.get('until')}.")
            target = clis.cli_of_home(HOME)
            name = clis.NAMES.get(target, "your CLI")
            answer = None
            if target and sys.stdin.isatty():
                try:
                    answer = input(f"Connect Knowledge Hub to {name} now? [Y/n] ").strip().lower()
                except EOFError:            # a console with nobody at it (an assistant's background run)
                    print()
            if answer is not None:
                if answer in ("", "y", "yes"):
                    reason = _setup_refusal(target, False)
                    _print(f"Skipped: {reason}" if reason else clis.setup(target, session.kh_url))
            else:
                print(f"To connect Knowledge Hub to {name}, run: kh setup")
            return 0
        if args.command == "password":
            signed = session.change_password()
            print(f"Password changed. Signed in as {signed.get('email')} until {signed.get('until')}.")
            return 0
        if args.command == "logout":
            revoked = session.logout()
            print("Signed out" + (" and revoked." if revoked else " (nothing to revoke)."))
            return 0
        if args.command == "status":
            _print(session.status())
            return 0
        if args.command == "me":
            status, payload = session.call("GET", "/auth/me")
            _print(payload)
            return 0 if status < 300 else 1
        if args.command == "call":
            body = None
            if args.body:
                raw = sys.stdin.read() if args.body == "-" else (
                    open(args.body[1:], encoding="utf-8").read() if args.body.startswith("@") else args.body)
                body = json.loads(raw)
            status, payload = session.call(args.method, args.path, body)
            _print(payload)
            return 0 if status < 300 else 1
        if args.command in ("members", "catalog"):
            from .mcp_server import members
            status, payload = (session.call_identity("GET", "catalog") if args.command == "catalog"
                               else members(session, args.project, args.action, args.email, args.level))
            _print(payload if payload is not None else {"status": status})
            return 0 if status < 300 else 1
        if args.command == "message":
            if args.action == "send":
                if not (args.project and args.receiver and args.text):
                    print("usage: kh message send PROJECT RECEIVER TEXT", file=sys.stderr)
                    return 1
                status, payload = session.call("POST", "/messages", {"project": args.project,
                                                                     "receiver": args.receiver, "content": args.text})
            else:
                status, payload = session.call("POST", "/messages/inbox", {})
            _print(payload)
            return 0 if status < 300 else 1
        if args.command == "setup":
            target = clis.cli_of_home(HOME)
            reason = _setup_refusal(target, args.remove)
            if reason:
                raise owner.WrongOwner(reason)
            result = clis.setup(target, session.kh_url, remove=args.remove, mcp=not args.no_mcp,
                                settings=Path(args.settings) if args.settings else None)
            if args.remove:
                # Taking KH out ends the sign-in too; otherwise `kh setup` would bring it all back unasked.
                result["signed_out"] = session.logout_all()
            _print(result)
            return 0
        if args.command == "uninstall":
            target = clis.cli_of_home(HOME)
            # Removing only takes access away, so it is allowed from any caller.
            result = clis.setup(target, session.kh_url, remove=True) if target else {"cli": None}
            if target:
                result["backups_deleted"] = clis.remove_backups(target)
            result["signed_out"] = session.logout_all()
            result["helper"] = _delete_home()
            _print(result)
            return 0
        if args.command == "hook":
            from . import quiet
            from .hooks import run_hook
            try:
                stdin_text = "" if sys.stdin.isatty() else sys.stdin.read()
                return run_hook(args.event, session, stdin_text, cli=args.cli)
            except Exception as e:              # a hook must never end in a red error: log it, carry on (1.9.1)
                quiet.log(f"hook {args.event}", e)
                return 0
        if args.command == "upgrade":
            from .release import upgrade
            _print(upgrade(session, args.source, args.force))
            return 0
        if args.command == "artifact":
            if args.action == "list":
                status, payload = session.call("GET", "/artifacts")
            else:
                if not args.file:
                    print("usage: kh artifact upload FILE [--module M --version V]", file=sys.stderr)
                    return 1
                import base64
                path = Path(args.file)
                status, payload = session.call("POST", "/artifacts", {
                    "name": path.name, "content_b64": base64.b64encode(path.read_bytes()).decode("ascii"),
                    "module": args.module, "version": args.version})
            _print(payload)
            return 0 if status < 300 else 1
        if args.command == "worklog":
            from . import quiet
            from .worklog import drain, handed_session
            try:
                print(f"Stored {drain(handed_session('' if sys.stdin.isatty() else sys.stdin.read()))} work log(s).")
            except Exception as e:              # a detached worker has nobody to show an error to
                quiet.log("worklog", e)
            return 0
        if args.command == "mcp":
            from .session import _load_state
            owner.check(HOME, _load_state())        # refuse to serve another CLI's sign-in at all
            from .mcp_server import run
            run(session)
            return 0
    except NotSignedIn as e:
        print(str(e), file=sys.stderr)
        return 2
    except owner.WrongOwner as e:
        print(f"Refused: {e}", file=sys.stderr)
        return 3
    except PasswordNotChanged as e:
        print(f"Password not changed ({e}).", file=sys.stderr)
        return 4
    return 1


def _setup_refusal(target: str | None, remove: bool) -> str | None:
    """setup connects the CLI whose profile holds this copy, and only that CLI may ask for it.

    Claude Code is recognised for sure (owner.caller). Other CLIs cannot be told apart from the process
    alone, so for them the copy's folder decides; Claude Code itself never sets up another CLI.
    """
    who = owner.caller()
    if target is None:
        return (f"this copy of the helper lives in {HOME}, which is not inside a known CLI's profile "
                f"({', '.join(clis.NAMES.values())}). Install it in your CLI's profile folder, or register "
                "the MCP server in your CLI's own configuration - see /auth/help.")
    if remove:
        return None
    if target == owner.CLAUDE_CODE:
        if who["cli"] != owner.CLAUDE_CODE:
            return ("this copy belongs to Claude Code; only Claude Code can connect it. Install your own "
                    "copy in your CLI's profile folder - see /auth/help.")
        if owner._resolve(HOME.parent) != who["profile"]:
            return (f"this copy of the helper lives in {HOME}, outside this Claude Code profile "
                    f"({who['profile']}). Install the helper in this profile and run setup from there.")
    elif who["cli"] == owner.CLAUDE_CODE:
        return (f"this copy belongs to {clis.NAMES[target]}, not to Claude Code. Claude Code uses the "
                "helper in its own profile - see /auth/help.")
    return None


def _delete_home() -> str:
    """Delete this helper's own folder, but only the documented install: a virtual environment named
    kh-helper that this Python runs from. Anything else is left for the person to remove by hand."""
    import os
    import subprocess
    home = HOME.resolve()
    if not (sys.prefix != sys.base_prefix and Path(sys.prefix).resolve() == home
            and home.name == "kh-helper" and (home / "pyvenv.cfg").exists()):
        return f"left in place (not the documented install): {home}"
    if os.name != "nt":
        import shutil
        shutil.rmtree(home, ignore_errors=True)
        return "deleted" if not home.exists() else f"could not delete: {home}"
    # Windows cannot delete the python.exe that is running (this one, or an MCP server still held open by
    # the CLI), so a hidden child on the base Python keeps retrying until the CLI lets go, for up to 1 hour.
    script = ("import shutil,sys,time,os\n"
              "for _ in range(1800):\n"
              "    shutil.rmtree(sys.argv[1], ignore_errors=True)\n"
              "    if not os.path.exists(sys.argv[1]): break\n"
              "    time.sleep(2)\n")
    from .worklog import windowless
    base = windowless(getattr(sys, "_base_executable", None) or sys.executable)
    flags = subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    subprocess.Popen([base, "-c", script, str(home)], creationflags=flags, close_fds=True,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     cwd=str(home.parent))
    return "deleting (finishes once this app is closed)"


if __name__ == "__main__":
    sys.exit(main())
