# ruff: noqa: T201 — spike throwaway, in kết quả ra stdout
"""S1 (P-process-engine) — so chế độ điều phối Nhóm BA với Claude CLI thật (claude-sub, dev/test CR-019).

Chạy trong WSL user `worker` (đã login). Mỗi lệnh = 1 lần gọi `claude -p --output-format json`
(không tool, không MCP, không session). Trần cứng: 40 lần gọi CLI (đếm ở out/calls.log).
Cách chạy (Git Bash):
  wsl.exe -d Ubuntu -u worker -- bash -lc 'cd /mnt/d/AI/ai-system/apps/agent-runtime/spikes/process_team && python3 team_spike.py A 1'
Chế độ: A | B | C | redo | judge ; đối số 2 = lần lặp (1|2). Không retry; lỗi CLI (chưa login/hết quota) => dừng ngay.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
CALLS = OUT / "calls.log"
MAX_CALLS = 40
CWD = Path(os.environ.get("SPIKE_CWD", str(Path.home() / "spike-pt")))

INPUT = "Yêu cầu: Cho phép xuất hoá đơn ra PDF để gửi khách, có logo công ty."
FEEDBACK = "Thiếu trường hợp hoá đơn nhiều trang; thêm số trang 1/2 ở chân trang"
TEMPLATE = "# Mục tiêu\n## User story\n## Tiêu chí chấp nhận (AC)\n## Trường hợp biên\n## Ngoài phạm vi"

# Tiền tố ổn định (giống nhau mọi vai) -> cache; phần riêng vai đặt SAU.
PREFIX = (
    "Bạn là thành viên Nhóm BA của một phần mềm quản lý. Viết tiếng Việt. Sản phẩm là một file spec.md "
    f"theo đúng khung:\n{TEMPLATE}\n"
    "Quy tắc: chỉ trả về nội dung file markdown đầy đủ (không lời dẫn, không khối ```); AC đánh số, mỗi AC kiểm thử được; "
    "không bịa phạm vi ngoài yêu cầu; giữ phần người trước đã viết nếu đúng, chỉ bổ sung/sửa."
)
ROLES = {
    "analyst": ("sonnet", "Vai: Analyst. Viết/bổ sung mục tiêu, user story, AC chức năng, nguồn logo, ngoài phạm vi."),
    "domain": ("sonnet", "Vai: Domain Expert hoá đơn VN. Bổ sung AC + trường hợp biên đặc thù: hoá đơn điều chỉnh/thay thế, nhiều trang, định dạng tiền/ngày VN."),
    "ux": ("haiku", "Vai: UX Writer. Chuẩn hoá câu chữ thông báo lỗi/nhãn nút/chân trang, nêu rõ lỗi khi thiếu logo; không đổi nghĩa AC."),
    "lead": ("haiku", "Vai: BA Lead."),
}


def count_calls() -> int:
    return len(CALLS.read_text().splitlines()) if CALLS.exists() else 0


def call(tag: str, model: str, system: str, user: str) -> dict:
    if count_calls() >= MAX_CALLS:
        sys.exit("HẾT NGÂN SÁCH 40 LẦN GỌI")
    CWD.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(exist_ok=True)
    t0 = time.time()
    with CALLS.open("a") as f:
        f.write(f"{time.strftime('%H:%M:%S')} {tag} {model}\n")
    p = subprocess.run(
        ["claude", "-p", "--output-format", "json", "--model", model, "--tools", "", "--no-session-persistence",
         "--disable-slash-commands", "--strict-mcp-config", "--setting-sources", "", "--system-prompt", system],
        input=user, capture_output=True, text=True, cwd=CWD, timeout=300, check=False,
    )
    wall = time.time() - t0
    try:
        j = json.loads(p.stdout)
    except json.JSONDecodeError:
        sys.exit(f"CLI lỗi ({tag}) rc={p.returncode} stderr={p.stderr[:200]!r} stdout={p.stdout[:200]!r}")
    if j.get("is_error"):
        sys.exit(f"CLI is_error ({tag}): {str(j.get('result'))[:200]}")
    u = j.get("usage", {})
    rec = {
        "tag": tag, "model": model, "wall_s": round(wall, 1),
        "in": u.get("input_tokens", 0), "out": u.get("output_tokens", 0),
        "cache_read": u.get("cache_read_input_tokens", 0), "cache_write": u.get("cache_creation_input_tokens", 0),
        "cost_usd": j.get("total_cost_usd"), "text": j.get("result", ""),
    }
    print(f"[{tag}] {model} {rec['wall_s']}s in={rec['in']} out={rec['out']} cr={rec['cache_read']} cw={rec['cache_write']}", flush=True)
    return rec


def member(tag: str, role: str, user: str) -> dict:
    model, rtxt = ROLES[role]
    return call(f"{tag}:{role}", model, f"{PREFIX}\n{rtxt}", user)


def strip_fence(t: str) -> str:
    t = t.strip()
    return re.sub(r"^```(?:markdown|md)?\n|\n```$", "", t)


def finish(name: str, final: str, calls: list[dict], wall: float) -> None:
    (OUT / f"{name}.md").write_text(final)
    summ = {k: sum(c[k] for c in calls) for k in ("in", "out", "cache_read", "cache_write")}
    summ.update(calls=len(calls), wall_s=round(wall, 1), cost_usd=round(sum(c["cost_usd"] or 0 for c in calls), 4))
    slim = [{k: v for k, v in c.items() if k != "text"} for c in calls]
    (OUT / f"{name}.json").write_text(json.dumps({"summary": summ, "calls": slim}, ensure_ascii=False, indent=1))
    print("TỔNG", name, summ, flush=True)


def mode_a(n: str) -> None:
    t0, calls, cur = time.time(), [], ""
    for role in ("analyst", "domain", "ux"):
        u = f"{INPUT}\n\n--- FILE spec.md HIỆN TẠI ---\n{cur or '(chưa có, hãy viết bản đầu)'}"
        r = member(f"A{n}", role, u)
        calls.append(r)
        cur = strip_fence(r["text"])
    finish(f"A{n}", cur, calls, time.time() - t0)


def mode_b(n: str) -> None:
    t0 = time.time()
    with ThreadPoolExecutor(3) as ex:
        futs = [ex.submit(member, f"B{n}", role, f"{INPUT}\n\nViết bản spec.md đầy đủ từ góc nhìn vai của bạn.") for role in ("analyst", "domain", "ux")]
        drafts = [f.result() for f in futs]
    body = "\n\n".join(f"=== BẢN CỦA {r['tag']} ===\n{strip_fence(r['text'])}" for r in drafts)
    m = member(f"B{n}", "lead", f"{INPUT}\n\nGộp 3 bản sau thành MỘT spec.md thống nhất (bỏ trùng, giữ mọi AC/biên có giá trị).\n\n{body}")
    finish(f"B{n}", strip_fence(m["text"]), [*drafts, m], time.time() - t0)


def mode_c(n: str) -> None:
    t0, calls = time.time(), []
    plan_q = (f"{INPUT}\n\nThành viên có sẵn: analyst (viết spec nền), domain (hoá đơn VN: điều chỉnh/thay thế, nhiều trang, tiền/ngày), "
              'ux (câu chữ thông báo/nhãn). Chỉ trả JSON, không chữ khác: {"steps":[{"member":"analyst|domain|ux","task":"việc cụ thể ≤ 30 từ"}]}')
    pl = member(f"C{n}", "lead", plan_q)
    calls.append(pl)
    try:
        steps = json.loads(re.search(r"\{.*\}", pl["text"], re.S).group(0))["steps"][:5]
    except Exception:  # noqa: BLE001
        sys.exit(f"Kế hoạch JSON hỏng: {pl['text'][:200]!r}")
    cur, sums = "", []
    for s in steps:
        if s.get("member") not in ("analyst", "domain", "ux"):
            sys.exit(f"member lạ trong kế hoạch: {s}")
        u = (f"{INPUT}\n\nViệc của bạn: {s['task']}\n\n--- FILE spec.md HIỆN TẠI ---\n{cur or '(chưa có)'}\n\n"
             "Trả về file đầy đủ, rồi một dòng `=====TÓM TẮT=====` và tóm tắt ≤ 200 token (bạn đã đổi gì, điểm còn hở).")
        r = member(f"C{n}", s["member"], u)
        calls.append(r)
        file_part, _, summ = r["text"].partition("=====TÓM TẮT=====")
        cur = strip_fence(file_part)
        sums.append(f"[{s['member']}] {summ.strip()}")
    chk = member(f"C{n}", "lead", f"{INPUT}\n\nTóm tắt các thành viên:\n" + "\n".join(sums) + f"\n\nFILE CUỐI:\n{cur}\n\nKiểm 1 lần: trả 'OK' hoặc ≤ 3 gạch đầu dòng lỗi còn lại. Không viết lại file.")
    calls.append(chk)
    (OUT / f"C{n}.plan.txt").write_text(pl["text"] + "\n---\n" + "\n".join(sums) + "\n---\n" + chk["text"])
    finish(f"C{n}", cur, calls, time.time() - t0)


def redo(_n: str) -> None:
    base = (OUT / "A1.md").read_text()
    for name, roles in (("redo_full", ("analyst", "domain", "ux")), ("redo_sel", ("domain", "ux"))):
        t0, calls, cur = time.time(), [], base
        for role in roles:
            u = f"{INPUT}\n\nGóp ý của người duyệt: {FEEDBACK}\n\n--- FILE spec.md HIỆN TẠI ---\n{cur}\n\nSửa file theo góp ý (phần thuộc vai bạn), giữ phần còn lại."
            r = member(name, role, u)
            calls.append(r)
            cur = strip_fence(r["text"])
        finish(name, cur, calls, time.time() - t0)


CHECKLIST = ("1 đủ 5 mục khung (Mục tiêu, User story, Tiêu chí chấp nhận (AC), Trường hợp biên, Ngoài phạm vi); 2 ≥5 AC kiểm thử được; "
             "3 nêu nguồn logo (cấu hình công ty/tải lên); 4 hoá đơn nhiều trang + số trang; 5 hoá đơn điều chỉnh/thay thế; 6 lỗi khi thiếu logo; "
             "7 định dạng tiền/ngày VN (VND, dd/mm/yyyy); 8 không bịa phạm vi (không thêm email tự động, ký số, đa ngôn ngữ... ngoài yêu cầu)")


def auto_check(t: str) -> dict:
    low = t.lower()
    heads = [h for h in ("# mục tiêu", "## user story", "## tiêu chí chấp nhận", "## trường hợp biên", "## ngoài phạm vi") if h in low]
    ac = len(re.findall(r"^\s*(?:\d+[.)]|[-*]\s*\*\*AC|[-*]\s*AC|AC-?\d+)", t, re.M | re.I))
    return {
        "sections": len(heads), "ac_lines": ac,
        "logo_source": bool(re.search(r"logo.{0,60}(cấu hình|tải lên|upload|thiết lập|hồ sơ công ty)|(cấu hình|tải lên|thiết lập).{0,60}logo", low)),
        "multipage": bool(re.search(r"nhiều trang", low)) and bool(re.search(r"\d+\s*/\s*\d+|số trang", low)),
        "adjust_replace": bool(re.search(r"điều chỉnh", low)) and bool(re.search(r"thay thế", low)),
        "no_logo_err": bool(re.search(r"(thiếu|không có|chưa có|không tìm thấy).{0,40}logo|logo.{0,40}(thiếu|không tồn tại|lỗi|không hợp lệ)", low)),
        "vn_format": bool(re.search(r"vnd|vnđ|₫", low)) and bool(re.search(r"dd/mm/yyyy|dd/mm", low)),
        "chars": len(t),
    }


def judge(_n: str) -> None:
    res = {}
    for name in ("A1", "A2", "B1", "B2", "C1", "C2", "redo_full", "redo_sel"):
        f = OUT / f"{name}.md"
        if not f.exists():
            continue
        t = f.read_text()
        r = call(f"judge:{name}", "haiku", "Bạn là giám khảo chất lượng spec. Chỉ trả JSON.",
                 f"Checklist: {CHECKLIST}\n\nChấm FILE dưới đây. Trả JSON duy nhất: "
                 '{"items":[0|1 x8 theo thứ tự],"score":<tổng 0-8>,"hallucinated":"<phạm vi bịa nếu có, hoặc rỗng>"}\n\nFILE:\n' + t)
        try:
            jd = json.loads(re.search(r"\{.*\}", r["text"], re.S).group(0))
        except Exception:  # noqa: BLE001
            jd = {"raw": r["text"][:200]}
        res[name] = {"judge": jd, "auto": auto_check(t), "judge_tokens": {k: r[k] for k in ("in", "out", "cache_read", "cache_write")}}
    (OUT / "judge.json").write_text(json.dumps(res, ensure_ascii=False, indent=1))
    print(json.dumps({k: [v["judge"].get("score"), v["auto"]] for k, v in res.items()}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    {"A": mode_a, "B": mode_b, "C": mode_c, "redo": redo, "judge": judge}[sys.argv[1]](sys.argv[2] if len(sys.argv) > 2 else "1")
