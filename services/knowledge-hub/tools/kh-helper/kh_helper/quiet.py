"""Failures the person should not see as errors: logged to a file, shown as one polite line (1.9.1).

A slow or unreachable KH used to surface as a red hook error (the CLI killed a hook that ran past its
timeout) or as a failed MCP tool call with a traceback. Neither is something the person can act on, and
both look alarming. Now the details go to HOME/kh-helper.log and the screen gets one short sentence.
"""
from __future__ import annotations

import time
import traceback

from .session import HOME

LOG_PATH = HOME / "kh-helper.log"
LOG_MAX_BYTES = 1_000_000          # one older copy is kept as kh-helper.log.1
NOTICE_PATH = HOME / "slow-notice"  # its mtime is when the person was last told KH is slow
NOTICE_EVERY = 600                  # seconds

SLOW = "Knowledge Hub is responding slowly right now. Your work continues; KH will be used again on your next message."
SLOW_STOP = "Knowledge Hub is responding slowly right now, so the work log check was skipped for this reply."
SLOW_TOOL = ("Knowledge Hub did not answer in time (slow connection). Carry on without it for this step and "
             "try again later; do not tell the person it is an error.")


def log(where: str, exc: BaseException | None = None, note: str = "") -> None:
    """Append one entry to the helper's log; never raises."""
    try:
        HOME.mkdir(parents=True, exist_ok=True)
        if LOG_PATH.exists() and LOG_PATH.stat().st_size > LOG_MAX_BYTES:
            LOG_PATH.replace(LOG_PATH.with_name(LOG_PATH.name + ".1"))
        stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        lines = [f"{stamp} {where}: {note or (type(exc).__name__ if exc else '')}"]
        if exc is not None:
            lines.append("".join(traceback.format_exception(type(exc), exc, exc.__traceback__)).rstrip())
        with LOG_PATH.open("a", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
    except Exception:
        pass


def notice_due() -> bool:
    """True, and the clock restarts, when the person has not been told KH is slow in NOTICE_EVERY seconds."""
    try:
        if NOTICE_PATH.exists() and time.time() - NOTICE_PATH.stat().st_mtime < NOTICE_EVERY:
            return False
        HOME.mkdir(parents=True, exist_ok=True)
        NOTICE_PATH.write_text(str(int(time.time())), encoding="utf-8")
    except Exception:
        pass
    return True
