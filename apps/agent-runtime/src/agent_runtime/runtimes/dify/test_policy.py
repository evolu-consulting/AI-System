"""WRK-FR-06 · WRK-FR-07 · R15 · R17 — ca biên `policy` ngoài bảng khoá P28–P30."""

from __future__ import annotations

import base64
from decimal import Decimal
from urllib.parse import quote, quote_plus

from agent_runtime.runtimes.dify.policy import RetryFlags, mask, retry_delay, usage_row

NO_FLAGS = RetryFlags(first_seen=False, side_effect=False)


def test_wrk_fr_06_retry_delay_attempt_out_of_range() -> None:
    assert retry_delay("connect", 0, NO_FLAGS) is None
    assert retry_delay("connect", 2, NO_FLAGS, (0.5,)) is None  # backoff ngắn → hết lượt sớm
    assert retry_delay("connect", 3, NO_FLAGS, (1.0, 2.0, 3.0)) is None  # tối đa 2 retry


def test_hub_fr_80_usage_row_garbage_is_zero() -> None:
    usage = {"prompt_tokens": "x", "completion_tokens": -3, "total_price": "abc", "currency": "USD"}
    row = usage_row("chat", usage, 5, None)
    assert (row.input_tokens, row.output_tokens, row.cost_usd) == (0, 0, Decimal(0))
    row = usage_row(
        "agent", {"prompt_tokens": "7", "total_price": "NaN", "currency": "USD"}, 5, None
    )
    assert (row.input_tokens, row.cost_usd) == (7, Decimal(0))
    assert usage_row("workflow", {"total_tokens": True}, 0, None).input_tokens == 0


def test_hub_fr_80_usage_row_price_number_exact() -> None:
    row = usage_row("chat", {"total_price": 0.1, "currency": "USD"}, 0, None)
    assert row.cost_usd == Decimal("0.1")


def test_wrk_fr_06_mask_forms_and_empty_key() -> None:
    key = "k3y-ÿ"
    raw = key.encode()
    text = f"{raw.hex().upper()} {key}"
    assert mask(text, key) == "*** ***"
    assert mask("abc", "") == "abc"
    assert mask("abc", "k", max_len=0) == ""


def test_review1_c7_mask_base64url_nopad_and_percent() -> None:
    """C7: key có ký tự base64url/URL đặc biệt — base64url không padding, percent-encoded (hoa,
    thường, `+` cho dấu cách) đều bị che."""
    key = "k?>~ a/b+c=1"  # base64 có `+`/`/`, URL cần mã hoá
    b64u = base64.urlsafe_b64encode(key.encode()).decode().rstrip("=")
    pct = quote(key, safe="")
    forms = (b64u, pct, pct.lower(), quote_plus(key, safe=""))
    out = mask(" | ".join(forms), key)
    for form in forms:
        assert form not in out
    assert out == " | ".join(["***"] * 4)
