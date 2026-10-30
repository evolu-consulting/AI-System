# 2026-09-26 - kh-helper 1.3.1: a machine-wide install keeps one sign-in per profile

fen found a Claude Code session in one profile (`~/.claude_julian`) signed in to KH although only the
default profile (`~/.claude`) had been signed in. The two profiles were not in fact sharing: the default
profile's helper lives in its own venv and kept its own entry. But `~/.claude_julian` has no helper of
its own, so it ran the machine-wide `kh`, which fell back to the one shared `~/.kh` and found an older
sign-in there. Every profile without its own helper shared that one sign-in, against the design.

## What changed

- **`kh_helper/session.py`:** `_home()` for a machine-wide install is now
  `<profile>/kh-helper`, with `profile_dir()` = `$CLAUDE_CONFIG_DIR`, else `~/.claude`. That is the
  same folder the documented venv install uses, so a profile has one sign-in whichever copy runs.
  `KH_HELPER_HOME` still wins, and still accepts `~/.kh` with its old entry name.
- **`kh_helper/hooks.py`:** `claude_settings_path()` uses `profile_dir()` (one copy of the rule).
- **Version 1.3.1.**
- **Tests:** `tests/test_kh_helper_home.py`, 7 new checks run with the base interpreter (outside any
  venv): state in the calling profile, two profiles two entries, default profile, never `~/.kh`.

## Effect

A sign-in kept in `~/.kh` by a machine-wide install is no longer read; sign in again in each profile.
The machine-wide helper on fen's machine was upgraded from 1.1.0 to 1.3.1. The wheel served by
`/auth/download` is rebuilt on the next deploy.
