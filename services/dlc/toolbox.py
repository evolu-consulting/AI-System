"""KH tools catalogue - copied from RITA/toolbox.py (catalogue part only) so the SDLC
tool lists the same KH tools RITA does: INDEX.md is authority on meaning, the disk on existence.
"""

from __future__ import annotations

import os
import re

#: The file beside the tools that says what they are.
INDEX_NAME = "INDEX.md"

#: A row of that table. The first cell names the tool, usually in backticks and
#: usually as a path - `sprite_toolkit/spritesheet_slicer.py` - so the folder it
#: belongs to is the part before the first slash. `~~name~~` marks an entry kept
#: as history after the thing itself was deleted, and it is read rather than
#: skipped: "this used to exist and here is what replaced it" is the single most
#: useful line in the file for anybody about to go looking for it.
#: AN ESCAPED PIPE IS TEXT, NOT A COLUMN EDGE, which is why the cells are
#: written as "anything but a pipe or a backslash, or a backslash and whatever
#: follows it" rather than as `[^|]`. _clean turns `\|` back into `|`, so the
#: intent was always there; the pattern did not honour it, and a row whose
#: MIDDLE cell contained one was silently split into the wrong columns. The
#: last cell can stay `.*?` because the end anchor makes it run to the final
#: pipe, which is how the rows carrying `\|` between alternatives already read
#: correctly. Found 2026-09-21 by writing a row that contained one.
INDEX_ROW = re.compile(
    r"^\|\s*(?P<name>(?:[^|\\]|\\.)+?)\s*\|\s*(?P<work>(?:[^|\\]|\\.)*?)\s*\|"
    r"\s*(?P<call>.*?)\s*\|\s*$"
)

#: Files in the tools folder that are not tools.
NOT_A_TOOL = {INDEX_NAME.lower(), "readme.md", "__pycache__", ".git"}


def _clean(cell):
    """One table cell as prose: the markup taken off, the words left alone."""
    text = cell.strip()
    text = re.sub(r"~~(.*?)~~", r"\1", text)
    text = re.sub(r"\*\*(.*?)\*\*", r"\1", text)
    text = text.replace("`", "")
    text = text.replace("\\|", "|")
    return text.strip()


def _label(name):
    """What to CALL a row, as opposed to what to match it against.

    The first cell is usually a path in backticks, and occasionally a path
    followed by a sentence - one row uses that cell to say the tool is not in
    this folder at all. The backticked part is the name; the sentence is not.
    """
    backticked = re.search(r"`([^`]+)`", name)
    return _clean(backticked.group(1) if backticked else name)


def _key(name):
    """The folder or file an index row is about, lowercased for matching.

    The first cell can be `kh.ps1`, `sprite_toolkit/spritesheet_slicer.py` or a
    whole sentence explaining that the tool is somewhere else. Everything after
    the first slash is dropped, because what a listing of the folder can match
    against is the top-level entry and nothing deeper.
    """
    text = name.strip()
    backticked = re.search(r"`([^`]+)`", text)
    if backticked:
        text = backticked.group(1)
    text = text.strip().strip("~*").strip()
    return text.split("/")[0].split("\\")[0].strip().lower()


def parse_index(text):
    """The index table, keyed by the folder or file each row is about.

    Rows that name the same folder are kept together - `sprite_toolkit` has two
    - because the folder is the thing on disk and both rows describe it.
    """
    found = {}
    for line in (text or "").splitlines():
        match = INDEX_ROW.match(line)
        if not match:
            continue
        name = match.group("name").strip()
        # The header and its underline are rows too, by this shape.
        if not name or name.lower() in ("tool", "---") or set(name) <= set("-: "):
            continue
        key = _key(name)
        if not key:
            continue
        found.setdefault(key, []).append({
            "name": _label(name),
            "work": _clean(match.group("work")),
            "call": _clean(match.group("call")),
            "retired": "~~" in name,
        })
    return found


def read_index(tools_dir):
    """The parsed index beside a tools folder, or an empty one."""
    path = os.path.join(tools_dir, INDEX_NAME)
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return parse_index(f.read()), path
    except OSError:
        return {}, ""


def catalogue(tools_dir):
    """Everything in a tools folder, joined to what the index says about it.

    Returns (rows, problem). Each row says where it was seen - `onDisk`,
    `inIndex` - so the two kinds of disagreement stay visible: a tool nobody
    wrote down, and a tool written down that is no longer there.
    """
    if not tools_dir:
        return None, "no tools folder was found on this machine"
    if not os.path.isdir(tools_dir):
        return None, "there is no folder at " + tools_dir

    index, index_path = read_index(tools_dir)

    try:
        entries = sorted(os.listdir(tools_dir))
    except OSError as exc:  # noqa: BLE001
        return None, "could not read " + tools_dir + ": " + str(exc)[:150]

    rows = []
    seen = set()
    for entry in entries:
        if entry.lower() in NOT_A_TOOL:
            continue
        key = entry.lower()
        seen.add(key)
        full = os.path.join(tools_dir, entry)
        described = index.get(key) or []
        rows.append({
            "key": key,
            "name": entry,
            "path": full,
            "folder": os.path.isdir(full),
            "onDisk": True,
            "inIndex": bool(described),
            "retired": all(row["retired"] for row in described) if described else False,
            "work": " ".join(row["work"] for row in described if row["work"]),
            "call": " ".join(row["call"] for row in described if row["call"]),
        })

    # WRITTEN DOWN BUT NOT THERE, which is a real state and not an error: the
    # index says of one entry, in its own words, that it was deleted from the
    # disk and the row is kept so nobody goes looking for the folder.
    for key, described in index.items():
        if key in seen:
            continue
        rows.append({
            "key": key,
            "name": described[0]["name"],
            "path": "",
            "folder": False,
            "onDisk": False,
            "inIndex": True,
            "retired": all(row["retired"] for row in described),
            "work": " ".join(row["work"] for row in described if row["work"]),
            "call": " ".join(row["call"] for row in described if row["call"]),
        })

    rows.sort(key=lambda row: (not row["onDisk"], row["retired"], row["name"].lower()))
    return {"tools": rows, "dir": tools_dir, "index": index_path}, ""


