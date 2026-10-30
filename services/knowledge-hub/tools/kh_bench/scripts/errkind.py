"""Error kinds and step outcomes from worklog text, in code (no model). Slice S4 of
docs/roadmap-e-to-5-design.md (sections 5.2, 5.5 and 8).

Three things come out of one piece of text, all deterministic:

  outcome    'corrected' > 'failed' > 'done', the precedence of 5.2. A historical worklog has no hook
             payload, so the signals are re-read from its words: a person's correction, or an error line.
  error_cls  a coarse class (auth, network, dependency, ...) with an anchor (the exception name or HTTP
             code when there is one). The same error told in other words lands in one class+anchor, which
             is what "error-kind signatures are stable" in section 8 asks for.
  error_kind the design's live formula: sha12(project, action, context, normalised error line), with digits,
             paths, ids, hex and quoted values stripped. The live KH (S7) stores this one; replay reports it
             next to the class kind so the two can be compared on the same history.

Why not the distil seed word list for 'correction': words such as 'always', 'never' and 'instead' are in
it because they mark a lesson worth distilling, but in a worklog they are mostly the author's own plan.
A correction here needs a person as the subject or a 'was wrong' form. 'failed' likewise needs an error
line, and 'no errors' / '0 failed' / 'without error' are read as success.

Label precision is measured with measure() on audited samples (tests/test_replay.py holds a labelled
sample; replay.py --audit takes a real one, the 100-step gate of 5.9).

    python errkind.py "Traceback ... KeyError: 'x'"      # prints the classification as JSON
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import unicodedata

OUTCOMES = ("done", "failed", "corrected")
RANK = {"done": 0, "failed": 1, "corrected": 2}
NONE_KEY = "-"


def fold(text: str) -> str:
    """Lowercase and strip accents (the Vietnamese worklogs fold to ASCII), keep punctuation."""
    n = unicodedata.normalize("NFD", text or "")
    n = "".join(ch for ch in n if not unicodedata.combining(ch))
    return n.replace("đ", "d").replace("Đ", "d").lower()


# ── failure evidence ────────────────────────────────────────────────────────

# Phrases that say the opposite of a failure; they are blanked before the failure patterns run.
_NEGATED = re.compile(
    r"\b(?:no|zero|0|without(?: any)?|none of the|never)\s+(?:new\s+|more\s+|real\s+)?"
    r"(?:errors?|failures?|failed|exceptions?|regressions?|issues?|problems?|warnings?|loi)\b"
    r"|\b(?:errors?|failures?|exceptions?)(?: count)?\s*[:=]\s*0\b"
    r"|\berror[- ]free\b|\bfail[- ]safe\b|\bon[- ]error\b|\berror handling\b|\berror messages? (?:is|are) clear"
    r"|\bpassed\b[^.\n]{0,20}\b0 failed\b|\bkhong (?:co )?loi\b|\bhet loi\b")

_FAIL = re.compile(
    r"traceback \(most recent call last\)|\b[a-z_]*(?:error|exception)\b\s*:|\bexception\b|\berror\b|\berrors\b"
    r"|\bfail(?:ed|s|ure|ing)?\b|\bcrash(?:ed|es)?\b|\bbroke(?:n)?\b|\btimed out\b"
    r"|\btimeout (?:error|after|expired|exceeded|again)\b|\b(?:read|connect|gateway|hana|request) timeout\b"
    r"|\bhttp\s*[45]\d\d\b|\b[45]\d\d (?:unauthorized|forbidden|not found|bad request|conflict|"
    r"internal server error|bad gateway|service unavailable|gateway timeout|too many requests)\b"
    r"|\bexit (?:code|status) [1-9]\d*\b|\bnon-?zero exit\b|\brefused\b|\bdenied\b|\bpanic\b"
    r"|\bsegfault\b|\b429\b|\brate.?limit(?:ed)?\b|\bquota exceeded\b|\b[a-z]+(?:error|exception)\b|\bnot found\b|\bno such file\b|\bconflict\b|\brejected\b|\binvalid\b"
    r"|\bloi\b|\bhong\b|\bbi treo\b")

# A failure that was planned or hypothetical ("if it fails", "to avoid errors") does not count.
_HYPOTHETICAL = re.compile(r"\b(?:if|in case|unless|to avoid|prevent(?:s|ing)?|handle[sd]?|catch(?:es)?|"
                           r"would|could|might|may)\b[^.\n]{0,25}$")

# ── correction evidence ─────────────────────────────────────────────────────

_CORRECTION = re.compile(
    r"\b(?:user|fen|owner|reviewer|maintainer|customer|he|she|they|anh|chi)\b[^.\n]{0,40}"
    r"\b(?:corrected|correct(?:ed)? me|pointed out|said (?:it|this|that) (?:was|is) wrong|rejected|"
    r"told me (?:to|not)|asked (?:me )?to (?:redo|revert|undo|change)|did not want|didn't want|"
    r"noi sai|bao sai)\b"
    r"|\bcorrection\s*:|\b(?:i|we|my|our|the agent|claude)\b[^.\n]{0,30}\b(?:was|were) wrong\b"
    r"|\bmy mistake\b|\bmisunderstood\b|\bwrong assumption\b|\breverted\b[^.\n]{0,40}\b(?:at|on) (?:the )?"
    r"(?:user|fen|owner|reviewer)'?s? request\b|\b(?:em|toi) (?:da )?lam sai\b|\bsua lai theo (?:y|yeu cau)\b")

# ── classes ─────────────────────────────────────────────────────────────────
# Order matters: the first class whose pattern matches the error line (then the text) wins.
CLASSES: list[tuple[str, re.Pattern]] = [(name, re.compile(rx)) for name, rx in [
    ("dependency", r"modulenotfounderror|importerror|no module named|pip (?:install )?(?:failed|error)|"
                   r"version conflict|incompatible version|could not resolve|npm err|dependency|requirements\.txt|"
                   r"cannot find module|package .{0,20}not installed"),
    ("encoding", r"unicode(?:de|en)codeerror|codec can'?t|mojibake|encoding|charmap|utf-?8"),
    ("auth", r"\b401\b|unauthori[sz]ed|invalid[_ ]grant|invalid[_ ]token|token (?:has )?expired|expired token|"
             r"jwt|not signed in|login failed|keycloak|authenticat|invalid credentials|signature (?:has )?expired"),
    ("permission", r"\b403\b|forbidden|permission denied|access denied|eacces|not allowed|insufficient (?:rights|scope)|"
                   r"khong co quyen"),
    ("rate_limit", r"\b429\b|rate.?limit|too many requests|quota|overloaded|\b529\b"),
    ("resource", r"out of memory|\boom\b|memoryerror|disk (?:is )?full|no space left|memory limit|killed"),
    ("network", r"timed? ?out|timeout|connection (?:refused|reset|aborted|error)|econn(?:refused|reset)|"
                r"\b50[234]\b|bad gateway|service unavailable|name or service not known|dns|ssl|certificate|"
                r"unreachable|network|socket"),
    ("database", r"\bhana\b|\bsql|sqlite|deadlock|constraint|duplicate key|unique violation|integrity ?error|"
                 r"no such table|no such column|invalid (?:table|column) name|database|chroma|transaction"),
    ("git", r"merge conflict|conflict \(content\)|rebase|non-fast-forward|detached head|\bgit\b|push rejected|"
            r"failed to push"),
    ("test", r"assertionerror|assert(?:ion)? fail|tests? (?:failed|failing|fail)|\bpytest\b|\bfailed\b.{0,20}\bpassed\b|"
             r"\bpassed\b.{0,20}\bfailed\b|expected .{1,40} (?:got|but was|actual)"),
    ("build_deploy", r"build failed|compil|cf push|deploy(?:ment)? failed|docker (?:build|run)|staging failed|"
                     r"container|manifest|buildpack|deploy"),
    ("config", r"env(?:ironment)? var|not set|missing (?:setting|config|variable|key)|misconfigur|invalid config|"
               r"config(?:uration)? error|wrong (?:setting|config|path|port|url)|\.env\b"),
    ("not_found", r"\b404\b|not found|no such file|filenotfounderror|does not exist|missing file|cannot find"),
    ("code", r"syntaxerror|typeerror|attributeerror|nameerror|keyerror|indexerror|valueerror|zerodivisionerror|"
             r"nullpointer|undefined is not|is not a function|null reference|recursionerror|runtimeerror|"
             r"traceback|\bbug\b|exception"),
    ("data", r"invalid (?:json|data|format|input)|jsondecodeerror|parse error|schema|validation (?:error|failed)|"
             r"malformed|wrong format|422"),
]]

_ANCHOR = re.compile(r"\b([a-z_]*(?:error|exception))\b|\bhttp\s*([45]\d\d)\b|\b([45]\d\d)\b(?= [a-z])|"
                     r"\b(e[a-z]{4,12})\b(?=[: ])")
_GENERIC_ANCHORS = {"error", "exception", "errors"}


def _strip_negated(text: str) -> str:
    return _NEGATED.sub(" ", text)


def error_line(text: str) -> str:
    """The first line (or sentence) that carries failure evidence, as written; '' when there is none."""
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    # Prefer the exception line of a traceback ("KeyError: 'x'") to its header.
    for ln in lines:
        if re.match(r"^[A-Za-z_.]*(?:Error|Exception)\b\s*:", ln):
            return ln[:300]
    for ln in lines:
        for sent in re.split(r"(?<=[.;!?])\s+", ln):
            f = _strip_negated(fold(sent))
            m = _FAIL.search(f)
            if m and not _HYPOTHETICAL.search(f[:m.start()]):
                return sent.strip()[:300]
    return ""


def normalise(line: str) -> str:
    """The error line with what varies between occurrences removed (5.2): urls, paths, ids, hex, digits,
    quoted values. What stays is the shape of the error."""
    s = fold(line)
    s = re.sub(r"https?://\S+", " <url> ", s)
    s = re.sub(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+", " <email> ", s)
    s = re.sub(r"(?:[a-z]:)?(?:[\\/][\w.~-]+){2,}[\\/]?", " <path> ", s)
    s = re.sub(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", " <id> ", s)
    s = re.sub(r"\b(?:0x)?[0-9a-f]*\d[0-9a-f]*\b", lambda m: " <n> " if len(m.group()) < 7 else " <hex> ", s)
    s = re.sub(r"\b\w*\d\w*\b", " <n> ", s)
    s = re.sub(r"'[^']*'|\"[^\"]*\"|`[^`]*`", " <v> ", s)
    s = re.sub(r"[^\w<>]+", " ", s)
    return " ".join(s.split())


def sha12(*parts: str) -> str:
    return hashlib.sha256("\x1f".join(p or NONE_KEY for p in parts).encode("utf-8")).hexdigest()[:12]


def error_kind(project: str, action: str, context: str, line: str) -> str:
    """The live formula of 5.2: sha12(project, action, context, normalised error line)."""
    return sha12(project, action, context, normalise(line))


def classify_error(text: str, line: str | None = None) -> tuple[str, str]:
    """(class, anchor). The line decides first, the whole text breaks a tie; 'other' when nothing fits."""
    line = error_line(text) if line is None else line
    for hay in (fold(line), _strip_negated(fold(text))):
        if not hay:
            continue
        for name, rx in CLASSES:
            if rx.search(hay):
                return name, anchor(hay)
    return "other", anchor(fold(line))


def anchor(folded: str) -> str:
    for m in _ANCHOR.finditer(folded or ""):
        a = next(g for g in m.groups() if g)
        if a not in _GENERIC_ANCHORS:
            return a
    return ""


def outcome(text: str) -> str:
    f = fold(text)
    if _CORRECTION.search(f):
        return "corrected"
    return "failed" if error_line(text) else "done"


def classify(text: str, project: str = "", action: str = NONE_KEY, context: str = NONE_KEY) -> dict:
    """Everything replay needs about one step. 'kind' is the class kind used for repeats; 'error_kind' is
    the live per-line formula. Both are empty for a step with no error."""
    out = outcome(text)
    line = error_line(text)
    if not line:
        return {"outcome": out, "error_line": "", "error_cls": "", "anchor": "", "kind": "", "error_kind": ""}
    cls, anc = classify_error(text, line)
    return {"outcome": out, "error_line": line, "error_cls": cls, "anchor": anc,
            "kind": sha12(project, action, context, cls, anc),
            "error_kind": error_kind(project, action, context, line)}


# ── precision ───────────────────────────────────────────────────────────────

def measure(pairs: list[tuple[str, str]]) -> dict:
    """pairs = [(predicted, gold)]. Precision and recall per label, plus overall accuracy and n."""
    labels = sorted({p for p, _ in pairs} | {g for _, g in pairs})
    per = {}
    for lab in labels:
        tp = sum(1 for p, g in pairs if p == lab and g == lab)
        pp = sum(1 for p, _ in pairs if p == lab)
        gp = sum(1 for _, g in pairs if g == lab)
        per[lab] = {"precision": round(tp / pp, 3) if pp else None, "recall": round(tp / gp, 3) if gp else None,
                    "predicted": pp, "gold": gp}
    acc = sum(1 for p, g in pairs if p == g) / len(pairs) if pairs else None
    return {"n": len(pairs), "accuracy": round(acc, 3) if acc is not None else None, "per_label": per}


if __name__ == "__main__":
    print(json.dumps(classify(" ".join(sys.argv[1:]) or sys.stdin.read()), indent=2, ensure_ascii=False))
