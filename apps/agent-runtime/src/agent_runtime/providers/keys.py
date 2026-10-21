"""WRK-FR-10 · spec §7 · Khoá provider có implementation + môi trường được phép — nhẹ, không import
SDK (process cha lọc `AGENT_RT_PROVIDERS` mà không nạp `claude_agent_sdk` ~5 s; review H1 #8).

ai-tiers-rag: "làn" của cùng gói Claude (`claude-sub-<làn>`, vd `claude-sub-haiku`) dùng chung CLI + đăng
nhập với `claude-sub` nhưng có `provider_state` riêng ⇒ profile chuyển bước theo `on: [quota|error]` giữa
model khác nhau (hết hạn mức riêng của opus không chặn sonnet). Có `claude-sub` trong `AGENT_RT_PROVIDERS`
⇒ tự claim thêm `CLAUDE_LANES` (không cần đổi env khi triển khai).
"""

import re

CLAUDE_KEY = "claude-sub"
FAKE_KEY = "fake-cli"
DEV_APP_ENVS = frozenset({"development", "test"})
CLAUDE_LANES = ("claude-sub-haiku", "claude-sub-opus")
_LANE_RE = re.compile(r"^claude-sub-[a-z0-9]{1,20}$")


def is_claude_key(key: str) -> bool:
    """`claude-sub` hoặc một làn `claude-sub-<làn>` (cùng implementation Claude)."""
    return key == CLAUDE_KEY or bool(_LANE_RE.match(key))


def is_available(key: str, app_env: str | None) -> bool:
    """`key` có implementation và được phép ở `app_env` (không dựng provider)."""
    return is_claude_key(key) or (key == FAKE_KEY and app_env in DEV_APP_ENVS)


def with_lanes(keys: list[str]) -> list[str]:
    """Có `claude-sub` ⇒ thêm các làn mặc định ngay sau nó (không trùng, giữ thứ tự)."""
    out: list[str] = []
    for k in keys:
        if k not in out:
            out.append(k)
        if k == CLAUDE_KEY:
            out.extend(lane for lane in CLAUDE_LANES if lane not in out and lane not in keys)
    return out
