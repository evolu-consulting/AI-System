"""Sinh agent-hub-spec.html từ ba-agent-hub.md + ba-worker.md (+ phần tổng quan viết tay bên dưới).

Chạy: python docs/design/agent-hub/build-spec.py   (cần gói `markdown`)
Nguồn sự thật vẫn là các file .md; sửa .md rồi chạy lại, không sửa tay file .html.
"""

from __future__ import annotations

import datetime as dt
import html
import re
from pathlib import Path

import markdown

HERE = Path(__file__).resolve().parent
DESIGN = HERE.parent
OUT = HERE / "agent-hub-spec.html"
PARTS = [
    ("a", "A. Agent Hub — Business Requirements", HERE / "ba-agent-hub.md"),
    ("b", "B. Agent Runtime (Worker) — Business Requirements", DESIGN / "worker" / "ba-worker.md"),
]

OVERVIEW = """
<section id="overview">
<h2>0. Tổng quan</h2>
<p><strong>Agent Hub</strong> là cổng runtime duy nhất của hệ thống AI multi-tenant: nhận yêu cầu từ Chat App / Extension,
kiểm tra danh tính và quyền, điều phối agent qua <strong>Orchestrator</strong>, chạy command qua Dify, stream kết quả, ghi
chi phí theo tenant. <strong>Agent Studio</strong> là UI của Hub để <code>platform_admin</code> tạo và cấu hình agent.</p>
<div class="arch" role="img" aria-label="Sơ đồ: Chat App và Admin gọi Hub; Hub giao job cho Agent Runtime qua Postgres và Redis Streams">
  <div class="box"><b>Chat App / Extension</b><span>client · SSE</span></div>
  <div class="arrow">→</div>
  <div class="box main"><b>Hub · TypeScript/Bun</b><span>auth JWT · quyền · quota · hội thoại/flow · SSE<br>vòng Orchestrator · command → Dify · MCP · Studio API</span></div>
  <div class="arrow">⇄</div>
  <div class="box"><b>Agent Runtime · Python</b><span>WSL2/Linux · chạy mọi agent: agentic-cli (Claude Agent SDK, Codex, Gemini), llm, python</span></div>
</div>
<p class="muted">Hub ↔ Runtime chỉ nói chuyện qua Postgres (<code>hub.jobs</code>, <code>SKIP LOCKED</code>, NOTIFY) và Redis Streams
(<code>run:&lt;id&gt;</code> nội bộ, <code>sse:&lt;id&gt;</code> do Hub ghi). Admin giữ tenant/user/group/feature/command/catalog workflow;
Hub chỉ đọc schema <code>admin</code>.</p>

<h3>Định tuyến một tin nhắn</h3>
<table><thead><tr><th>Tin bắt đầu bằng</th><th>Đi đâu</th><th>Quyền</th></tr></thead><tbody>
<tr><td><code>/lệnh</code></td><td>Command Runner → workflow Dify</td><td>feature (entitlement + grant)</td></tr>
<tr><td><code>@agent</code> (CR-033)</td><td>Gọi thẳng agent đó; nhiều tag → Orchestrator chọn trong nhóm tag</td><td>agent (entitlement + grant)</td></tr>
<tr><td>còn lại</td><td>Orchestrator (mặc định hoặc riêng tenant, CR-032) → <code>delegate</code> / <code>answer</code> / <code>ask</code></td><td>chỉ thấy agent user được dùng</td></tr>
</tbody></table>

<h3>Mốc triển khai</h3>
<table><thead><tr><th>Mốc</th><th>Nội dung</th><th>Trạng thái</th></tr></thead><tbody>
<tr><td>H1</td><td>Hub lõi (hội thoại, flow, SSE + Last-Event-ID, huỷ, cách ly tenant, Orchestrator, quyền agent từ seed) + Agent Runtime tối thiểu (queue, agentic-cli/claude-sub, sandbox, resume, slot)</td><td>Code xong, <code>done:h1</code> xanh; đang sửa review vòng 1; chạy Claude thật chờ WSL2</td></tr>
<tr><td>H2</td><td>Command <code>/</code> + Dify, MCP, runtime llm/python/dify-*, fallback nhiều provider, <code>@agent</code>, Orchestrator theo tenant (runtime), đính kèm file, giới hạn run/user, xác nhận tool có tác dụng phụ</td><td>Đề xuất</td></tr>
<tr><td>H3</td><td><code>/agent-grants</code>, quota + cảnh báo + chặn cứng tuỳ chọn, price book / số thu, trace theo role</td><td>Đề xuất</td></tr>
<tr><td>H4</td><td>Agent Studio UI (canvas đã duyệt: <code>agent-hub/canvas/</code>), Playground, kiểm thử định tuyến, audit, import/export</td><td>Đề xuất</td></tr>
</tbody></table>

<h3>Quyết định chính (Change Requests)</h3>
<ul class="cr">
<li><b>CR-019</b> Subscription chỉ cho dev/test; profile không bắt buộc bước API cuối.</li>
<li><b>CR-020/025/026</b> Orchestrator là một agent được chọn; mọi tin đều qua Orchestrator; kết quả agent có cấu trúc <code>done/partial/need_input</code>; pass-through.</li>
<li><b>CR-028 / ADR-0007</b> Hub TypeScript + Agent Runtime Python; queue Postgres; sự kiện qua Redis Streams; manifest <code>agent_types</code>.</li>
<li><b>CR-029</b> Agent Runtime chạy trong WSL2 Ubuntu; sandbox chặn đường dẫn; huỷ theo process group.</li>
<li><b>CR-030/031</b> id SSE = số nguyên 1…n theo run (hai stream); sửa chữ BA theo plan H1.</li>
<li><b>CR-032</b> Orchestrator mặc định + riêng theo tenant (chỉ <code>platform_admin</code>).</li>
<li><b>CR-033</b> Gọi thẳng agent bằng <code>@agent</code>, <code>AGENT_NOT_FOUND</code>, <code>GET /agents</code>.</li>
<li><b>CR-034</b> Quyền command và agent độc lập; đính kèm MUST (H2); quota chặn cứng tuỳ chọn; giới hạn run/user; xác nhận tool <code>side_effect</code>; container mỗi job trước production.</li>
</ul>
</section>
"""

CSS = """
:root{--bg:#F7F6FA;--card:#FFFFFF;--fg:#1D1733;--muted:#635C78;--border:#E6E3EE;--row:#F0EEF4;--primary:#6B4FA0;--primary-strong:#4A3278;--accent:#EDE6FB;--ink:#2E2150;--code-bg:#F3F1F7;--quote:#FBFAFD}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#15111F;--card:#1E1930;--fg:#ECE8F6;--muted:#ABA3C2;--border:#332C48;--row:#2A2440;--primary:#B9A4F0;--primary-strong:#D6CBEF;--accent:#2E2150;--ink:#0E0B16;--code-bg:#282140;--quote:#1A1529}}
:root[data-theme="dark"]{--bg:#15111F;--card:#1E1930;--fg:#ECE8F6;--muted:#ABA3C2;--border:#332C48;--row:#2A2440;--primary:#B9A4F0;--primary-strong:#D6CBEF;--accent:#2E2150;--ink:#0E0B16;--code-bg:#282140;--quote:#1A1529}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.65 'Be Vietnam Pro',system-ui,sans-serif}
a{color:var(--primary)}a:hover{color:var(--primary-strong)}
code,pre{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12.5px}
code{background:var(--code-bg);padding:1px 5px;border-radius:4px}
pre{background:var(--code-bg);border:1px solid var(--border);border-radius:10px;padding:14px 16px;overflow-x:auto;line-height:1.5}
pre code{background:none;padding:0}
.layout{display:flex;flex-wrap:wrap;max-width:1440px;margin:0 auto}
nav.toc{flex:1 1 260px;padding:24px 20px;border-right:1px solid var(--border);background:var(--card)}
nav.toc h2{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:18px 0 6px}
nav.toc a{display:block;padding:4px 8px;border-radius:6px;color:var(--fg);text-decoration:none;font-size:13.5px}
nav.toc a:hover{background:var(--accent)}
main{flex:999 1 600px;min-width:0;padding:32px clamp(16px,4vw,56px) 80px}
header.doc{border-bottom:1px solid var(--border);padding-bottom:20px;margin-bottom:28px}
header.doc h1{font-size:30px;margin:0 0 6px}
.meta{display:flex;flex-wrap:wrap;gap:8px;color:var(--muted);font-size:13px}
.pill{display:inline-block;padding:2px 10px;border-radius:999px;background:var(--accent);color:var(--primary-strong);font-weight:500}
h2{font-size:24px;margin:48px 0 12px;padding-top:8px;border-top:2px solid var(--primary)}
h3{font-size:19px;margin:32px 0 10px}
h4{font-size:16px;margin:24px 0 8px}
.part{font-size:26px;margin:56px 0 4px;color:var(--primary-strong)}
table{width:100%;border-collapse:collapse;margin:12px 0 20px;background:var(--card);border:1px solid var(--border);border-radius:10px;overflow:hidden;font-size:14px;display:block;overflow-x:auto}
th{text-align:left;font-weight:600;color:var(--muted);font-size:12.5px;padding:9px 12px;border-bottom:1px solid var(--border);background:var(--card)}
td{padding:9px 12px;border-bottom:1px solid var(--row);vertical-align:top}
blockquote{margin:14px 0;padding:10px 16px;background:var(--quote);border:1px solid var(--border);border-radius:10px}
blockquote p{margin:4px 0}
.muted{color:var(--muted)}
.arch{display:flex;flex-wrap:wrap;align-items:stretch;gap:10px;margin:16px 0}
.arch .box{flex:1 1 200px;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:4px}
.arch .box.main{border:2px solid var(--primary)}
.arch .box span{font-size:13px;color:var(--muted)}
.arch .arrow{align-self:center;font-size:22px;color:var(--primary)}
ul.cr li{margin:4px 0}
footer{margin-top:64px;color:var(--muted);font-size:12.5px;border-top:1px solid var(--border);padding-top:14px}
"""


def render(prefix: str, path: Path) -> tuple[str, list[tuple[str, str]]]:
    text = path.read_text(encoding="utf-8")
    text = re.sub(r"\A# .*\n", "", text, count=1)  # bỏ tiêu đề cấp 1, dùng tiêu đề phần
    md = markdown.Markdown(extensions=["tables", "fenced_code", "toc", "sane_lists"])
    body = md.convert(text)
    body = re.sub(r'id="', f'id="{prefix}-', body)
    for lvl in (4, 3, 2):  # hạ một cấp: ## → h3
        body = re.sub(rf"<(/?)h{lvl}\b", rf"<\1h{lvl + 1}", body)
    toc = re.findall(r'<h3 id="([^"]+)">(.*?)</h3>', body)
    return body, [(i, re.sub(r"<[^>]+>", "", t)) for i, t in toc]


def main() -> None:
    sections, nav = [], ['<h2>Tổng quan</h2><a href="#overview">0. Tổng quan</a>']
    for prefix, title, path in PARTS:
        body, toc = render(prefix, path)
        sections.append(f'<h2 class="part" id="part-{prefix}">{html.escape(title)}</h2>\n{body}')
        nav.append(f"<h2>{html.escape(title.split(' — ')[0])}</h2>")
        nav += [f'<a href="#{i}">{t}</a>' for i, t in toc]
    today = dt.date.today().isoformat()
    page = f"""<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent Hub Specification</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>{CSS}</style></head><body>
<div class="layout">
<nav class="toc" aria-label="Mục lục">{"".join(nav)}</nav>
<main>
<header class="doc"><h1>Agent Hub — Specification</h1>
<div class="meta"><span class="pill">v0.5</span><span>cập nhật {today}</span><span>· mã yêu cầu HUB-* / WRK-*</span><span>· nguồn: ba-agent-hub.md, ba-worker.md, CHANGE-REQUESTS, ROADMAP</span></div></header>
{OVERVIEW}
{"".join(sections)}
<footer>Sinh tự động bởi <code>docs/design/agent-hub/build-spec.py</code> từ các file .md (nguồn sự thật). Không sửa tay.</footer>
</main></div></body></html>
"""
    OUT.write_text(page, encoding="utf-8", newline="\n")
    print(f"ghi {OUT} ({len(page):,} byte)")


if __name__ == "__main__":
    main()
