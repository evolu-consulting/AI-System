"""Build the AI SDLC guards report (local HTML, neon blueprint style) from sdlc_guard_data.py.

    python make_guards_report.py [OUT]     default OUT = ../AI-SDLC-Guards-Report.html
"""
import html
import os
import sys
from collections import OrderedDict

from sdlc_guard_data import (BUG_FIX, ENHANCEMENT, GUARDS, LANES, NEW_SYSTEM, SOURCES, TEMPLATE)

BG = "#0a0f1a"
TEAL_LINE = "#2dd4bf"
PINK = "#f9a8c4"
LAV = "#c4b5fd"
YELLOW = "#fde68a"
PHASE_COLORS = ["#a3acba", "#5eead4", "#fdba74", "#c4b5fd", "#67e8f9", "#fde68a", "#f9a8c4"]

NODE_W, NODE_H, COL_W = 206, 116, 236
LANE_H, LANE_GAP = 160, 14
X0 = 250                      # first column (lane labels sit left of it)
TOP = 116                     # first lane top
EX_H = 168                    # height of the EX / fallback lane


def esc(s):
    return html.escape(str(s), quote=True)


def wrap(text, width, lines):
    words, out, cur = str(text).split(), [], ""
    for w in words:
        if len(cur) + len(w) + (1 if cur else 0) <= width:
            cur = (cur + " " + w).strip()
        else:
            out.append(cur)
            cur = w
    if cur:
        out.append(cur)
    if len(out) > lines:
        out = out[:lines]
        out[-1] = out[-1][: width - 1].rstrip() + "…"
    return out


def text(x, y, s, size=12, color="#f3f6fb", weight=400, anchor="middle", family="mono"):
    fam = "JetBrains Mono, Cascadia Mono, Consolas, ui-monospace, monospace" if family == "mono" else \
        "Inter, Segoe UI, sans-serif"
    return (f'<text x="{x:.1f}" y="{y:.1f}" font-family="{fam}" font-size="{size}" fill="{color}" '
            f'font-weight="{weight}" text-anchor="{anchor}">{esc(s)}</text>')


def label_on_line(x, y, s, color):
    w = len(s) * 6.4 + 10
    return (f'<rect x="{x - w / 2:.1f}" y="{y - 9:.1f}" width="{w:.1f}" height="16" rx="3" fill="{BG}"/>'
            + text(x, y + 3.5, s, 10.5, color, 700))


def render(steps, title_id):
    used = {s["lane"] for s in steps} | {"learn"}
    lanes = OrderedDict((k, (lbl, acc, fill)) for k, lbl, acc, fill in LANES if k in used)
    lane_keys = list(lanes)
    lane_top = {k: TOP + i * (LANE_H + LANE_GAP) for i, k in enumerate(lane_keys)}
    ex_top = TOP + len(lane_keys) * (LANE_H + LANE_GAP)
    n = len(steps)
    W = X0 + n * COL_W + 40
    H = ex_top + EX_H + 110
    pos = {}
    for i, s in enumerate(steps):
        x = X0 + i * COL_W
        y = lane_top[s["lane"]] + (LANE_H - NODE_H) / 2 + 8
        pos[s["id"]] = (x, y)

    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" '
           f'role="img" aria-labelledby="{title_id}">',
           f'<title id="{title_id}">Swimlane diagram</title>',
           '<defs>',
           '<pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">'
           '<path d="M40 0H0V40" fill="none" stroke="rgba(148,170,210,0.035)" stroke-width="1"/></pattern>',
           ]
    for name, col in (("teal", TEAL_LINE), ("pink", PINK), ("lav", LAV), ("grey", "#7f93b0")):
        out.append(f'<marker id="ar-{name}-{title_id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" '
                   f'markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="{col}"/></marker>')
    out.append('<filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2" '
               'result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>')
    out.append('</defs>')
    out.append(f'<rect width="{W}" height="{H}" fill="{BG}"/><rect width="{W}" height="{H}" fill="url(#grid)"/>')

    # phase bars
    phases = OrderedDict()
    for i, s in enumerate(steps):
        phases.setdefault(s["phase"], []).append(i)
    for pi, (ph, idx) in enumerate(phases.items()):
        x1 = X0 + idx[0] * COL_W - 6
        x2 = X0 + idx[-1] * COL_W + NODE_W + 6
        col = PHASE_COLORS[pi % len(PHASE_COLORS)]
        out.append(f'<rect x="{x1}" y="40" width="{x2 - x1}" height="34" rx="17" fill="#101928" stroke="{col}" '
                   f'stroke-width="1.5"/>')
        out.append(f'<rect x="{x1 + 24}" y="77" width="{x2 - x1 - 48}" height="3" rx="1.5" fill="{col}" '
                   f'opacity="0.55"/>')
        out.append(text((x1 + x2) / 2, 62, ph, 14, col, 800))

    # lanes
    for k in lane_keys:
        lbl, acc, fill = lanes[k]
        y = lane_top[k]
        out.append(f'<rect x="20" y="{y}" width="{W - 40}" height="{LANE_H}" rx="14" fill="{fill}" '
                   f'fill-opacity="0.25" stroke="#263650" stroke-width="2" stroke-dasharray="9 7"/>')
        for j, part in enumerate(wrap(lbl, 26, 3)):
            out.append(text(36, y + 26 + j * 17, part, 12.5, acc if j == 0 else "#6b7a93", 800 if j == 0 else 500,
                            "start"))
    # EX lane
    out.append(f'<rect x="20" y="{ex_top}" width="{W - 40}" height="{EX_H}" rx="14" fill="#2a1421" '
               f'fill-opacity="0.25" stroke="{PINK}" stroke-width="2" stroke-dasharray="9 7"/>')
    out.append(f'<rect x="28" y="{ex_top + 8}" width="{W - 56}" height="{EX_H - 16}" rx="10" fill="none" '
               f'stroke="{PINK}" stroke-opacity="0.35" stroke-width="1" stroke-dasharray="4 6"/>')
    out.append(text(36, ex_top + 28, "EX / Fallback ladder", 12.5, PINK, 800, "start"))
    for j, part in enumerate(["F0 retry · F1 alternate", "F2 degrade · F3 human", "F4 rework · F5 park+escalate",
                              "F6 abort with record"]):
        out.append(text(36, ex_top + 50 + j * 17, part, 11, "#c98aa3", 500, "start"))

    # event bus in the learn lane
    ly = lane_top["learn"] + 22
    out.append(f'<path d="M{X0 - 10} {ly}H{W - 40}" stroke="{LAV}" stroke-width="1.6" stroke-dasharray="6 6" '
               f'fill="none" opacity="0.8"/>')
    labels = [label_on_line(X0 + COL_W * 1.5 + NODE_W / 2, ly, "every step emits events (G1 failure codes) -> RAG System", LAV)]

    # main flow edges
    for i in range(n - 1):
        a, b = steps[i], steps[i + 1]
        ax, ay = pos[a["id"]]
        bx, by = pos[b["id"]]
        y1, y2 = ay + NODE_H / 2, by + NODE_H / 2
        x1, x2 = ax + NODE_W, bx
        if abs(y1 - y2) < 1:
            d = f"M{x1} {y1}H{x2 - 2}"
        else:
            mid = x1 + (COL_W - NODE_W) / 2
            d = f"M{x1} {y1}H{mid}V{y2}H{x2 - 2}"
        out.append(f'<path d="{d}" stroke="{TEAL_LINE}" stroke-width="3" fill="none" filter="url(#glow)" '
                   f'marker-end="url(#ar-teal-{title_id})"/>')

    # rework edges, each on its own track in the EX lane
    track = 0
    for s in steps:
        if not s.get("rework"):
            continue
        tgt, lbl = s["rework"]
        if tgt not in pos:
            continue
        sx, sy = pos[s["id"]]
        tx, ty = pos[tgt]
        ty_track = ex_top + 40 + (track % 6) * 20
        track += 1
        x_src = sx + NODE_W / 2 + 18
        x_tgt = tx + NODE_W / 2 - 18
        d = f"M{x_src} {sy + NODE_H}V{ty_track}H{x_tgt}V{ty + NODE_H + 2}"
        out.append(f'<path d="{d}" stroke="{PINK}" stroke-width="2" stroke-dasharray="9 6" fill="none" '
                   f'marker-end="url(#ar-pink-{title_id})"/>')
        labels.append(label_on_line((x_src + x_tgt) / 2, ty_track, "F4 " + lbl, PINK))

    out.extend(labels)

    # nodes
    for s in steps:
        x, y = pos[s["id"]]
        _, acc, fill = lanes[s["lane"]]
        if s["new"]:
            out.append(f'<rect x="{x - 6}" y="{y - 6}" width="{NODE_W + 12}" height="{NODE_H + 12}" rx="11" '
                       f'fill="none" stroke="{YELLOW}" stroke-width="1.6" stroke-dasharray="5 4"/>')
        out.append(f'<rect x="{x}" y="{y}" width="{NODE_W}" height="{NODE_H}" rx="8" fill="{fill}" '
                   f'stroke="{acc}" stroke-width="2.5" filter="url(#glow)"/>')
        out.append(text(x + 10, y + 16, s["id"], 10.5, acc, 800, "start"))
        if s["new"]:
            out.append(text(x + NODE_W - 10, y + 16, "NEW", 10.5, YELLOW, 800, "end"))
        cx = x + NODE_W / 2
        t_lines = wrap(s["title"], 24, 2)
        ty0 = y + 38 if len(t_lines) == 2 else y + 44
        for j, line in enumerate(t_lines):
            out.append(text(cx, ty0 + j * 16, line, 13, "#f3f6fb", 800))
        for j, line in enumerate(wrap(s["sub"], 31, 2) if s["sub"] else []):
            out.append(text(cx, y + 76 + j * 13, line, 10.5, "#a7b0bf"))
        tag = " ".join(s["guards"]) + (f"  |  {s['scope']}" if s["scope"] else "")
        if tag.strip():
            out.append(text(cx, y + NODE_H - 8, tag, 10.5, acc, 800))

    # legend
    ly = ex_top + EX_H + 40
    out.append(text(36, ly, "Legend", 14, "#f3f6fb", 800, "start", "sans"))
    lx = 110
    items = [(acc, lbl.split(" / ")[1].split(" (")[0], "box") for k, lbl, acc, _ in LANES if k in lanes]
    items += [(TEAL_LINE, "main flow", "line"), (PINK, "F4 rework / fallback", "dash"),
              (LAV, "event bus", "dashlav"), (YELLOW, "NEW step (this report)", "new")]
    for col, lbl, kind in items:
        if kind == "box":
            out.append(f'<rect x="{lx}" y="{ly - 13}" width="26" height="17" rx="4" fill="none" stroke="{col}" '
                       f'stroke-width="2"/>')
        elif kind == "line":
            out.append(f'<path d="M{lx} {ly - 5}H{lx + 26}" stroke="{col}" stroke-width="3"/>')
        elif kind == "new":
            out.append(f'<rect x="{lx}" y="{ly - 13}" width="26" height="17" rx="4" fill="none" stroke="{col}" '
                       f'stroke-width="1.6" stroke-dasharray="4 3"/>')
        else:
            out.append(f'<path d="M{lx} {ly - 5}H{lx + 26}" stroke="{col}" stroke-width="2" '
                       f'stroke-dasharray="6 4"/>')
        out.append(text(lx + 34, ly, lbl, 11.5, "#a7b0bf", 500, "start"))
        lx += 52 + len(lbl) * 7.2
    out.append("</svg>")
    return "\n".join(out)


def change_table(steps):
    rows = []
    for s in steps:
        if not (s["new"] or s["note"]):
            continue
        g = ", ".join(f'<a href="#{c}">{c}</a>' for c in s["guards"]) or "—"
        rows.append(f'<tr><td class="mono">{esc(s["id"])}</td><td>{esc(s["title"])}'
                    f'{" <span class=new>NEW</span>" if s["new"] else ""}</td><td>{g}</td>'
                    f'<td class="mono">{esc(s["scope"] or "—")}</td><td>{esc(s["note"])}</td></tr>')
    return ('<table><thead><tr><th>Step</th><th>Name</th><th>Guards</th><th>Scope</th><th>What changes</th></tr>'
            '</thead><tbody>' + "".join(rows) + "</tbody></table>")


def stats(steps):
    agent = sum(1 for s in steps if s["lane"] == "agent")
    new = sum(1 for s in steps if s["new"])
    guarded = sum(1 for s in steps if s["guards"])
    return f"{len(steps)} steps · {agent} agent · {new} new · {guarded} with guards"


def page():
    guard_rows = "".join(
        f'<tr id="{c}"><td class="mono g">{c}</td><td><b>{esc(name)}</b><br><span class=dim>{esc(prob)}</span></td>'
        f'<td>{esc(how)}</td><td class="num">{esc(nums)}</td>'
        f'<td><a href="{SOURCES[src][1]}">{esc(SOURCES[src][0].split(":")[0])}</a></td></tr>'
        for c, name, prob, how, nums, src in GUARDS)
    sources = "".join(f'<li><a href="{u}">{esc(t)}</a></li>' for t, u in SOURCES.values())
    cases = [("case-template", "3. Một bước agent, mọi workflow đều dùng", TEMPLATE,
              "Khuôn chung cho mọi bước build của agent: nạp lesson theo key bước, plan + claim, build trong sandbox, "
              "3 lớp guard (verifier → scope → reviewer sạch), người duyệt khác người yêu cầu, rồi phát event có mã "
              "lỗi để RAG System học và trả lại đúng bước đó."),
             ("case-new", "4. Case 1 — New system (n1–n35)", NEW_SYSTEM,
              "Build (IV) được tách thành harness → plan + claim → build từng F-item → 3 guard → dev duyệt. Thêm "
              "reviewer sạch cho blueprint, bộ lọc assured cho test, kiểm tra restore trước cutover."),
             ("case-enh", "5. Case 2 — Enhancement (f1–f22)", ENHANCEMENT,
              "Thêm claim + cảnh báo chồng lấn trước khi code, 3 guard sau build, và bước Integrate (hàng đợi, "
              "merge agent không phải người build, chạy hợp hai bộ test) trước khi lên QAS."),
             ("case-bug", "6. Case 3 — Bug fix (b1–b18)", BUG_FIX,
              "Repro phải là script fail trên QAS; fix tối thiểu trên branch hotfix; test hồi quy phải fail trước "
              "và pass sau fix; 3 guard; sau PRD có forward-port về develop bằng merge agent.")]
    sections = []
    for i, (cid, h, steps, lead) in enumerate(cases):
        svg = render(steps, f"d{i}")
        extra = "" if cid == "case-template" else (
            f"<h3>Thay đổi so với flow hiện tại</h3>{change_table(steps)}")
        sections.append(f'<section id="{cid}"><h2>{esc(h)}</h2><p class="lead">{esc(lead)}</p>'
                        f'<p class="dim mono">{stats(steps)}</p>'
                        f'<div class="diagram">{svg}</div>{extra}</section>')
    return TEMPLATE_HTML.format(guard_rows=guard_rows, sections="".join(sections), sources=sources)


TEMPLATE_HTML = """<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI SDLC Guards</title>
<style>
:root{{--bg:#0a0f1a;--panel:#101928;--line:#263650;--text:#f3f6fb;--dim:#a7b0bf;--teal:#5eead4;--pink:#f9a8c4;
--cyan:#67e8f9;--lav:#c4b5fd;--yellow:#fde68a;--orange:#fdba74}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);background-image:linear-gradient(rgba(148,170,210,.035) 1px,transparent 1px),
linear-gradient(90deg,rgba(148,170,210,.035) 1px,transparent 1px);background-size:40px 40px;color:var(--text);
font:15px/1.6 "JetBrains Mono","Cascadia Mono",Consolas,ui-monospace,monospace}}
main{{max-width:1200px;margin:0 auto;padding:32px 16px 80px}}
h1{{font-size:28px;margin:0 0 4px}} h2{{font-size:21px;margin:48px 0 8px;color:var(--teal)}}
h3{{font-size:16px;margin:24px 0 8px;color:var(--cyan)}}
.byline{{color:var(--dim);font-size:13px}} .lead{{max-width:900px}} .dim{{color:var(--dim)}} .mono{{font-family:inherit}}
a{{color:var(--cyan)}} .g{{color:var(--pink);font-weight:800}} .num{{color:var(--yellow);font-size:13px}}
.new{{color:var(--yellow);border:1px dashed var(--yellow);border-radius:4px;padding:0 4px;font-size:11px}}
table{{width:100%;border-collapse:collapse;margin:8px 0 16px;font-size:13px}}
th,td{{border-bottom:1px solid var(--line);padding:8px 10px;vertical-align:top;text-align:left}}
th{{color:var(--dim);font-weight:700;background:var(--panel)}}
.diagram{{width:max-content;margin:12px 0 12px calc(50% - 50vw + 16px);border:2px dashed var(--line);border-radius:14px;background:var(--bg)}}
.diagram svg{{display:block}}
.cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin:12px 0}}
.card{{border:2.5px solid var(--teal);border-radius:8px;background:#0c2a2a;padding:12px 14px;box-shadow:0 0 10px -2px rgba(94,234,212,.45)}}
.card.p{{border-color:var(--pink);background:#2a1421;box-shadow:0 0 10px -2px rgba(249,168,196,.45)}}
.card.l{{border-color:var(--lav);background:#1d1a3a;box-shadow:0 0 10px -2px rgba(196,181,253,.45)}}
.card b{{display:block;margin-bottom:4px}}
nav a{{margin-right:14px;font-size:13px}}
@media (max-width:700px){{table{{font-size:12px}} th,td{{padding:6px}}}}
</style></head><body><main>
<h1>AI SDLC — chắt lọc cách các bên lớn xử lý lỗi, xung đột và agent làm sai</h1>
<p class="byline">2026-10-10 · Rowan · nguồn: ghi chép dự án, vec_803e77e13afb, vec_e4dd71f6a69d</p>
<nav><a href="#s1">1. Kết luận</a><a href="#s2">2. Vấn đề → giải pháp</a><a href="#case-template">3. Khuôn một bước</a>
<a href="#case-new">4. New system</a><a href="#case-enh">5. Enhancement</a><a href="#case-bug">6. Bug fix</a>
<a href="#s7">7. Thứ tự làm</a><a href="#s8">Nguồn</a></nav>

<section id="s1"><h2>1. Kết luận</h2>
<p class="lead">Thiết kế fallback hiện có (thang F0–F6, If-Match, lease, idempotency, learnback) đã lo phần
"khi hỏng thì làm gì". Thứ còn thiếu so với các bên lớn là <b>chặn sai trước khi nó thành kết quả</b>: không tin lời
agent, kiểm tra bằng máy trước, người duyệt khác người yêu cầu, reviewer không chung ngữ cảnh với người build, và mọi
lỗi mang mã chuẩn để học được. Report gắn 12 guard (G1–G12) vào đúng bước của 3 workflow; 17 bước mới, phần lớn
tách bước build thành chuỗi có kiểm soát.</p>
<div class="cards">
<div class="card"><b>Chặn trước</b>G2 verifier + stop hook, G3 scope guard, G4 assured filters, G5 không tin lời agent.</div>
<div class="card p"><b>Quyền và ranh giới</b>G6 tác giả không tự duyệt + sandbox, G10 mức tự chủ theo bước, G12 tách prod, backup đã thử restore.</div>
<div class="card l"><b>Xung đột và học</b>G7 reviewer sạch + sổ quyết định, G8 harness + checkpoint, G9 vòng sửa có giới hạn, G1 mã lỗi, G11 đo độ ồn review.</div>
</div></section>

<section id="s2"><h2>2. Vấn đề họ gặp → cách họ giải</h2>
<p class="lead">Mỗi dòng là một vấn đề đã xảy ra ở nơi khác, cách họ giải, con số họ công bố, và mã guard dùng trong
các diagram bên dưới.</p>
<table><thead><tr><th>Mã</th><th>Guard / vấn đề</th><th>Họ giải thế nào</th><th>Con số</th><th>Nguồn</th></tr></thead>
<tbody>{guard_rows}</tbody></table></section>

{sections}

<section id="s7"><h2>7. Thứ tự làm (đề xuất)</h2>
<table><thead><tr><th>#</th><th>Việc</th><th>Guard</th><th>Vì sao trước</th></tr></thead><tbody>
<tr><td>1</td><td>Mã lỗi chuẩn trong kho event</td><td>G1</td><td>Không có mã thì không đo được các guard còn lại</td></tr>
<tr><td>2</td><td>Verifier do server chạy + stop hook + scope guard ở n21 / f11 / b9</td><td>G2 G3 G5</td><td>Chặn nhiều lỗi nhất, rẻ, không cần model</td></tr>
<tr><td>3</td><td>Requester ≠ approver, branch prefix agent, egress allowlist</td><td>G6 G12</td><td>Ranh giới cứng, sự cố kiểu Replit không xảy ra được</td></tr>
<tr><td>4</td><td>Harness: progress.md + feature list + checkpoint + version pin</td><td>G8</td><td>Run dài chạy tiếp được, không "done" sớm</td></tr>
<tr><td>5</td><td>Reviewer sạch + sổ quyết định; Integrate với merge agent</td><td>G7</td><td>Cần khi nhiều người/agent cùng sửa một chỗ (case 12.1)</td></tr>
<tr><td>6</td><td>Assured filters cho test; mức tự chủ S1–S4 theo bước; đo độ ồn review</td><td>G4 G10 G11</td><td>Tăng tự chủ dựa trên số liệu</td></tr>
</tbody></table>
<p class="dim">Đo sau khi bật: tỉ lệ mỗi mã lỗi trên 100 bước theo tuần; % run bị verifier chặn và % tự sửa được
(Spotify: 25% / 50%); % góp ý review hữu ích (Uber: 75%).</p></section>

<section id="s8"><h2>Nguồn</h2><ul>{sources}</ul>
<p class="dim">Generated by docs/design/source/make_guards_report.py from sdlc_guard_data.py.</p></section>
</main></body></html>"""


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                                                               "AI-SDLC-Guards-Report.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(page())
    print("wrote", os.path.abspath(out))
