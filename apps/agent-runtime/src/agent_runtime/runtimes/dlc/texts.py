"""DLC-R05 · DLC-R06 · (thuần) Câu chữ agent DLC trả về chat (tiếng Việt, Markdown).

Dòng tiến độ được stream (`job.delta`) rồi giữ nguyên làm đầu câu trả lời cuối (Hub đối chiếu tiền
tố, H2b R23): mọi hàm ở đây chỉ dựng chữ, không quyết định luồng.
"""

from __future__ import annotations

from typing import Any

from agent_runtime.runtimes.dlc.client import obj, objs

STATE_VI = {
    "admitted": "Đã nhận yêu cầu",
    "understanding": "Đang đọc hiểu spec",
    "planning": "Đang lập kế hoạch",
    "building": "Đang viết code",
    "integrating": "Đang ghép code",
    "testing": "Đang chạy test",
    "qas": "Đang kiểm thử trên QAS",
    "deploying": "Đang triển khai",
    "parked": "Đang chờ trả lời câu hỏi",
    "green": "Hoàn tất",
    "escalated": "Dừng lại",
}
FLOW_VI = {"new-system": "New System", "enhancement": "Enhancement", "bug-fix": "Bug Fix"}
HELP = (
    "Lệnh: `trạng thái` · `tạm dừng` · `tiếp tục` · `huỷ` · `thử lại <gợi ý>` · `app` · "
    "`dự án mới` (bắt đầu lại). Gửi spec Markdown (dán hoặc đính kèm `.md`) để thêm tính năng, "
    "bắt đầu tin bằng `lỗi:` để báo lỗi."
)


def started(flow: str, project: str, run: str, workflow: str | None = None) -> str:
    wf = f" theo workflow `#{workflow}`" if workflow else ""
    return f"▶ Bắt đầu **{FLOW_VI.get(flow, flow)}**{wf} cho dự án `{project}` (run `{run}`).\n\n"


def unknown_workflow(key: str) -> str:
    return f"Không có workflow DLC `#{key}` đang bật (Evolu Control › Workflow Process).\n"


def following(run: str) -> str:
    return f"↻ Theo dõi run `{run}`.\n\n"


def state_line(state: str, summary: dict[str, Any]) -> str:
    units, merged = int(summary.get("units") or 0), _merged(summary)
    tail = f" — {merged}/{units} phần đã ghép" if units else ""
    return f"- {STATE_VI.get(state, state)}{tail}\n"


def merged_line(summary: dict[str, Any]) -> str:
    return f"- ✓ {_merged(summary)}/{int(summary.get('units') or 0)} phần đã ghép\n"


def _merged(summary: dict[str, Any]) -> int:
    return int(obj(summary.get("unit_states")).get("merged") or 0)


def spent(summary: dict[str, Any]) -> str:
    usd = obj(summary.get("detail")).get("spent_usd")
    return f" Chi phí: {float(usd):.2f} USD." if isinstance(usd, int | float) else ""


def green(run: str, summary: dict[str, Any], app: dict[str, Any] | None) -> str:
    done = f"run `{run}` đã qua test, ghép vào `main` và triển khai QAS."
    out = f"\n✅ **Xong** — {done}{spent(summary)}\n"
    if app and app.get("url") and app.get("state") in ("running", "starting"):
        out += f"Mở app: {app['url']}\n"
    elif app and app.get("state") == "failed":
        out += f"App chưa chạy được: {str(app.get('error') or '')[:300]}\n"
    return out + "\nGửi thêm spec để làm tiếp (Enhancement), hoặc `lỗi: …` để sửa lỗi (Bug Fix).\n"


def questions(run: str, items: list[dict[str, Any]]) -> str:
    lines = [f"\n❓ Run `{run}` cần bạn quyết định {len(items)} điểm:\n"]
    for i, q in enumerate(items, start=1):
        lines.append(f"\n**{i}. {q.get('decision', '')}**\n")
        rec = str(q.get("recommended") or "")
        for opt in objs(q.get("options")):
            mark = " _(đề xuất)_" if str(opt.get("id")) == rec else ""
            lines.append(f"- `{opt.get('id')}` {opt.get('text', '')}{mark}\n")
    lines.append(
        "\nTrả lời mỗi dòng một câu, vd `1: a` (hoặc ghi câu trả lời khác), "
        "hoặc `ok` để theo đề xuất.\n"
    )
    return "".join(lines)


def attention(run: str, view: dict[str, Any]) -> str:
    title = str(view.get("title") or view.get("what") or "Run dừng lại")
    out = f"\n⚠️ **{title}** (run `{run}`)\n"
    for key, label in (("what", "Chuyện gì"), ("why", "Vì sao"), ("do", "Bạn có thể")):
        if view.get(key) and key != "title":
            out += f"- {label}: {str(view[key])[:600]}\n"
    reason = view.get("reason")
    if reason:
        out += f"- Chi tiết: {str(reason)[:600]}\n"
    return out + "\nGõ `thử lại <gợi ý>` để chạy lại kèm gợi ý.\n"


def escalated(run: str, summary: dict[str, Any], view: dict[str, Any] | None) -> str:
    if view and view.get("needed"):
        return attention(run, view)
    return f"\n⚠️ Run `{run}` dừng lại.{spent(summary)}\n"


def paused(run: str) -> str:
    return f"\n⏸ Run `{run}` đang tạm dừng. Gõ `tiếp tục` để chạy tiếp.\n"


def still_running(run: str) -> str:
    return (
        f"\n⏳ Run `{run}` vẫn đang chạy (việc lớn có thể mất hàng giờ). "
        "Gõ `trạng thái` bất cứ lúc nào để xem tiếp.\n"
    )


def answered(remaining: int) -> str:
    if remaining > 0:
        return f"✔ Đã ghi câu trả lời, còn {remaining} câu chưa trả lời.\n\n"
    return "✔ Đã ghi câu trả lời, run chạy tiếp.\n\n"


def no_project() -> str:
    return (
        "Chưa có dự án nào trong cuộc trò chuyện này. Gửi spec Markdown để bắt đầu New System.\n\n"
        + HELP
    )


def engine_error(code: str, message: str) -> str:
    detail = f": {message}" if message else ""
    return f"\n⚠️ Engine DLC từ chối yêu cầu (`{code}`){detail}\n"
