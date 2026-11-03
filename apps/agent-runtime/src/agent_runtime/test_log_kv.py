"""CR-114 hub-otel · log kv của Runtime: khuôn dòng, escape, trần 400, che bí mật (qua
`configure_logging(fmt="kv")`), id 6 ký tự, `tk=in/out`; cùng khuôn với hub-api."""

import io

from agent_runtime.log import bind_job, configure_logging, get_logger
from agent_runtime.log_kv import KV_MAX_LINE, event_name, format_kv, kv_value

JWT = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ1In0.c2lnbmF0dXJl"


def test_khuon_dong_id_6_ky_tu_agent_day_du() -> None:
    line = format_kv(
        {
            "level": "info",
            "event": "job.finished",
            "run_id": "0a1b2c3d-1111-2222-3333-444455556666",
            "tenant_id": "ffeedd00-0000-0000-0000-000000000000",
            "agent": "contract-reviewer",
            "latency_ms": 1234.6,
            "input_tokens": 120,
            "output_tokens": 45,
        },
        trace="abcdef0123456789",
        now=1_700_000_000.9,
    )
    assert line == (
        "t=1700000000 lvl=info e=job.finished run=0a1b2c tn=ffeedd "
        "ag=contract-reviewer ms=1235 tk=120/45 trace=abcdef01"
    )


def test_ten_su_kien_chu_dau_cham() -> None:
    assert event_name("job.output_retry") == "job.output.retry"
    assert event_name("Run  Started!") == "run.started"
    assert event_name("  ") == "log"


def test_gia_tri_escape_va_ngoac_kep() -> None:
    assert kv_value("ok") == "ok"
    assert kv_value(12) == "12"
    assert kv_value(True) == "true"
    assert kv_value(None) is None
    assert kv_value("two words") == '"two words"'
    assert kv_value("a=b") == '"a=b"'
    assert kv_value('say "hi"\nnow') == '"say \\"hi\\"\\nnow"'
    assert kv_value("") == '""'
    assert kv_value(["a", "b"]) == "a,b"
    one = format_kv({"event": "x", "error": "l1\nl2\r\nl3"}, now=1)
    assert "\n" not in one
    assert "\r" not in one


def test_tran_dong_400() -> None:
    line = format_kv({"event": "big", "error": "x y " * 500}, now=1)
    assert len(line) == KV_MAX_LINE
    assert line.endswith("~")
    assert len(format_kv({"event": "small", "a": 1}, now=1)) < KV_MAX_LINE


def test_exception_chi_dong_cuoi() -> None:
    tb = "Traceback (most recent call last):\n  File x\nValueError: boom\n"
    line = format_kv({"event": "e", "exception": tb}, now=1)
    assert "Traceback" not in line
    assert "ValueError:" in line


def test_configure_logging_kv_che_bi_mat_va_gan_ngu_canh() -> None:
    buf = io.StringIO()
    configure_logging("debug", worker_id="host-1", stream=buf, fmt="kv")
    try:
        with bind_job("11111111-aaaa", "22222222-bbbb", "33333333-cccc"):
            get_logger().info(
                "job.output_retry",
                token="sk-abcdefghijklmnopqrstuvwx",
                note=f"got {JWT} here",
                authorization="Bearer abc.def",
                input_tokens=7,
                output_tokens=3,
            )
    finally:
        configure_logging("info", worker_id="t", stream=io.StringIO())
    out = buf.getvalue().strip()
    assert out.count("\n") == 0
    assert out.startswith("t=")
    assert " lvl=info e=job.output.retry " in out
    assert "run=222222" in out
    assert "job=111111" in out
    assert "tn=333333" in out
    assert "wk=host-1" in out
    assert "tk=7/3" in out
    for leaked in ("sk-abcdef", "eyJ", "abc.def"):
        assert leaked not in out
    assert "token=[REDACTED]" in out


def test_mac_dinh_json_ke_ca_production_kv_chi_khi_dat_tuong_minh() -> None:
    """fix114-log: consumer đọc JSON (verify:prod…) ⇒ production KHÔNG tự đổi sang kv."""
    from agent_runtime.config import Settings

    def fmt(raw: str | None, env: str) -> str:
        s = Settings.model_construct(log_format_raw=raw, app_env=env)  # type: ignore[arg-type]
        return s.log_format

    assert fmt(None, "production") == "json"
    assert fmt(None, "development") == "json"
    assert fmt("kv", "production") == "kv"
    assert fmt("json", "production") == "json"
