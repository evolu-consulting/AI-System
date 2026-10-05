"""WRK-FR-03 · R19–R21, R25 · `StreamScanner` — đọc JSON kết quả tăng dần, phát chữ đã giải mã
của khoá `text` cấp 1 khi vai cho phép (plan-runtime H2b §3.2).

Thuần (không I/O, không SDK): dùng chung `claude` (mảnh `text_delta`/`partial_json`) và `fake`.
- Bỏ mọi ký tự trước `{` đầu tiên; chỉ xét khoá cấp 1, giá trị lồng đi qua (độ sâu, chuỗi, escape).
- `orchestrator`: `text` sau `decision == "answer"` ⇒ `kind="answer"`; `agent`: `text` sau
  `status ∈ {done, partial}` ⇒ `kind=status`; còn lại ⇒ `off` (không bao giờ phát).
- Escape giải dần qua ranh giới chunk; cặp surrogate ghép; surrogate lẻ ⇒ `U+FFFD`.
- Không ném: JSON hỏng trước khi stream ⇒ `off`; đang stream ⇒ `closed` (dừng).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import ClassVar, Literal

Mode = Literal["orchestrator", "agent"]
Kind = Literal["answer", "done", "partial"]
State = Literal["seeking", "streaming", "off", "closed"]

_SIMPLE = {'"': '"', "\\": "\\", "/": "/", "b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t"}
_HEX = frozenset("0123456789abcdefABCDEF")
_WS = frozenset(" \t\r\n")
_SCALAR_END = frozenset(",}") | _WS
_REPL = "�"
_ROLE_KEY: dict[Mode, str] = {"orchestrator": "decision", "agent": "status"}


class _BadJsonError(Exception):
    """Nội bộ: JSON hỏng — `feed` bắt và chuyển `off`/`closed` (không ném ra ngoài)."""


class _StrDecoder:
    """Giải chuỗi JSON (sau dấu `"` mở) từng ký tự; giữ escape dở và high surrogate chờ low."""

    def __init__(self) -> None:
        self.esc = ""
        self.high: int | None = None

    def push(self, c: str, out: list[str]) -> bool:
        """Thêm một ký tự; trả True khi gặp `"` đóng chuỗi. Escape sai ⇒ `_BadJsonError`."""
        if self.esc:
            self.esc += c
            self._escape(out)
            return False
        if c == "\\":
            self.esc = c
            return False
        self._flush_high(out)
        if c == '"':
            return True
        out.append(c)
        return False

    def _escape(self, out: list[str]) -> None:
        esc = self.esc
        if esc[1] != "u":
            char = _SIMPLE.get(esc[1])
            if char is None:
                raise _BadJsonError
            self.esc = ""
            self._flush_high(out)
            out.append(char)
            return
        if len(esc) > 2 and esc[-1] not in _HEX:
            raise _BadJsonError
        if len(esc) == 6:
            self.esc = ""
            self._unit(int(esc[2:], 16), out)

    def _unit(self, unit: int, out: list[str]) -> None:
        if 0xDC00 <= unit <= 0xDFFF and self.high is not None:
            out.append(chr(0x10000 + ((self.high - 0xD800) << 10) + (unit - 0xDC00)))
            self.high = None
            return
        self._flush_high(out)
        if 0xD800 <= unit <= 0xDBFF:
            self.high = unit
        elif 0xDC00 <= unit <= 0xDFFF:
            out.append(_REPL)
        else:
            out.append(chr(unit))

    def _flush_high(self, out: list[str]) -> None:
        if self.high is not None:
            out.append(_REPL)
            self.high = None


class StreamScanner:
    """`feed(chunk) -> list[str]` (mảnh chữ đã giải mã của `text`); `kind`, `state` công khai."""

    def __init__(self, mode: Mode) -> None:
        self.mode: Mode = mode
        self.kind: Kind | None = None
        self.state: State = "seeking"
        self._pos = "seek"
        self._str = _StrDecoder()
        self._buf: list[str] = []
        self._key = ""
        self._role: str | None = None
        self._depth = 0
        self._in_str = False
        self._esc = False

    def feed(self, chunk: str) -> list[str]:
        if self._stopped():
            return []
        out: list[str] = []
        try:
            for c in chunk:
                self._step(c, out)
                if self._stopped():
                    break
        except _BadJsonError:
            if self.state == "streaming":
                self.state = "closed"
            else:
                self._off()
        text = "".join(out)
        return [text] if text else []

    def _stopped(self) -> bool:
        return self.state in ("off", "closed")

    def _off(self) -> None:
        self.state = "off"
        self.kind = None

    def _step(self, c: str, out: list[str]) -> None:
        pos = self._pos
        if pos == "text_str":
            if self._str.push(c, out):
                self.state = "closed"
        elif pos in ("key_or_end", "key"):
            self._key_start(c, pos)
        else:
            self._handlers[pos](self, c)

    def _seek(self, c: str) -> None:
        if c == "{":
            self._pos = "key_or_end"

    def _key_start(self, c: str, pos: str) -> None:
        if c == '"':
            self._buf = []
            self._str = _StrDecoder()
            self._pos = "key_str"
        elif c == "}" and pos == "key_or_end":
            self._off()
        elif c not in _WS:
            raise _BadJsonError

    def _key_str(self, c: str) -> None:
        if self._str.push(c, self._buf):
            self._key = "".join(self._buf)
            self._pos = "colon"

    def _colon(self, c: str) -> None:
        if c == ":":
            self._pos = "value"
        elif c not in _WS:
            raise _BadJsonError

    def _val_str(self, c: str) -> None:
        if self._str.push(c, self._buf):
            if self._key == _ROLE_KEY[self.mode]:
                self._role = "".join(self._buf)
            self._pos = "after"

    def _scalar(self, c: str) -> None:
        if c in _SCALAR_END:
            self._after(c)

    def _value_start(self, c: str) -> None:
        if c in _WS:
            return
        if self._key == "text":
            if c != '"' or not self._allowed():
                self._off()
                return
            self.state = "streaming"
            self._str = _StrDecoder()
            self._pos = "text_str"
        elif c == '"':
            self._buf = []
            self._str = _StrDecoder()
            self._pos = "val_str"
        elif c in "{[":
            self._depth, self._in_str, self._esc = 1, False, False
            self._pos = "nested"
        elif c in ",}]":
            raise _BadJsonError
        else:
            self._pos = "scalar"

    def _allowed(self) -> bool:
        role = self._role
        if self.mode == "orchestrator" and role == "answer":
            self.kind = "answer"
        elif self.mode == "agent" and role == "done":
            self.kind = "done"
        elif self.mode == "agent" and role == "partial":
            self.kind = "partial"
        return self.kind is not None

    def _nested(self, c: str) -> None:
        if self._in_str:
            if self._esc:
                self._esc = False
            elif c == "\\":
                self._esc = True
            elif c == '"':
                self._in_str = False
        elif c == '"':
            self._in_str = True
        elif c in "{[":
            self._depth += 1
        elif c in "}]":
            self._depth -= 1
            if self._depth == 0:
                self._pos = "after"

    def _after(self, c: str) -> None:
        if c == ",":
            self._pos = "key"
        elif c == "}":
            self._off()  # object cấp 1 đóng mà chưa gặp `text` hợp lệ
        elif c in _WS:
            self._pos = "after"
        else:
            raise _BadJsonError

    _handlers: ClassVar[dict[str, Callable[[StreamScanner, str], None]]] = {
        "seek": _seek,
        "key_str": _key_str,
        "colon": _colon,
        "value": _value_start,
        "val_str": _val_str,
        "nested": _nested,
        "scalar": _scalar,
        "after": _after,
    }
