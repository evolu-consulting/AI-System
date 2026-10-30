"""Neon-blueprint SVG renderers shared by the SDLC reports.

render_swimlane(steps, title_id, lanes, new_label)  steps run left to right, one column each; rework = pink F4 arrow
render_dag(layers_spec, title_id)                    a small dependency graph, layered left to right
render_blocks(spec, title_id)                        nested boxes (tiers, pools)
"""
import html
import json
from collections import OrderedDict

BG = "#0a0f1a"
TEAL_LINE = "#2dd4bf"
PINK = "#f9a8c4"
LAV = "#c4b5fd"
YELLOW = "#fde68a"
PHASE_COLORS = ["#a3acba", "#5eead4", "#fdba74", "#c4b5fd", "#67e8f9", "#fde68a", "#f9a8c4"]
FONT = "JetBrains Mono, Cascadia Mono, Consolas, ui-monospace, monospace"

NODE_W, NODE_H, COL_W = 206, 116, 236
LANE_H, LANE_GAP = 160, 14
X0, TOP, EX_H = 250, 116, 168


def esc(s):
    return html.escape(str(s), quote=True)


def wrap(text, width, lines):
    words, out, cur = str(text).split(), [], ""
    for w in words:
        if len(cur) + len(w) + (1 if cur else 0) <= width:
            cur = (cur + " " + w).strip()
        else:
            if cur:
                out.append(cur)
            cur = w
    if cur:
        out.append(cur)
    if len(out) > lines:
        out = out[:lines]
        out[-1] = out[-1][: width - 1].rstrip() + "…"
    return out


def text(x, y, s, size=12, color="#f3f6fb", weight=400, anchor="middle", family=FONT):
    return (f'<text x="{x:.1f}" y="{y:.1f}" font-family="{family}" font-size="{size}" fill="{color}" '
            f'font-weight="{weight}" text-anchor="{anchor}">{esc(s)}</text>')


def label_on_line(x, y, s, color):
    w = len(s) * 6.4 + 10
    return (f'<rect x="{x - w / 2:.1f}" y="{y - 9:.1f}" width="{w:.1f}" height="16" rx="3" fill="{BG}"/>'
            + text(x, y + 3.5, s, 10.5, color, 700))


def _defs(tid):
    out = ['<defs>', '<pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">'
           '<path d="M40 0H0V40" fill="none" stroke="rgba(148,170,210,0.035)" stroke-width="1"/></pattern>']
    for name, col in (("teal", TEAL_LINE), ("pink", PINK), ("lav", LAV), ("grey", "#7f93b0"), ("yel", YELLOW)):
        out.append(f'<marker id="ar-{name}-{tid}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" '
                   f'markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="{col}"/></marker>')
    out.append('<filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2" '
               'result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>')
    out.append('</defs>')
    return out


def node(x, y, w, h, nid, title, sub, tag, acc, fill, mark=None, tlen=24, slen=31):
    out = []
    if mark:
        out.append(f'<rect x="{x - 6}" y="{y - 6}" width="{w + 12}" height="{h + 12}" rx="11" fill="none" '
                   f'stroke="{YELLOW}" stroke-width="1.6" stroke-dasharray="5 4"/>')
    out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{fill}" stroke="{acc}" '
               f'stroke-width="2.5" filter="url(#glow)"/>')
    if nid:
        out.append(text(x + 10, y + 16, nid, 10.5, acc, 800, "start"))
    if mark:
        out.append(text(x + w - 10, y + 16, mark, 10.5, YELLOW, 800, "end"))
    cx = x + w / 2
    t_lines = wrap(title, tlen, 2)
    ty0 = y + 38 if len(t_lines) == 2 else y + 44
    for j, line in enumerate(t_lines):
        out.append(text(cx, ty0 + j * 16, line, 13, "#f3f6fb", 800))
    for j, line in enumerate(wrap(sub, slen, 2) if sub else []):
        out.append(text(cx, y + 76 + j * 13, line, 10.5, "#a7b0bf"))
    if tag:
        out.append(text(cx, y + h - 8, tag, 10.5, acc, 800))
    return out


def with_tip(body, tip_id, title, acc, detail):
    """Wrap a node's SVG in a hover/focus target; the page's script reads data-tip (JSON) and builds the box."""
    if not detail:
        return body
    tip = esc(json.dumps({"id": tip_id, "title": title, "accent": acc, **detail}, ensure_ascii=False))
    return [f'<g class="tipnode" data-tip="{tip}" tabindex="0" style="cursor:help">'] + body + ["</g>"]


EN = dict(ex_title="EX / Loops + fallback", ex_lines=["repair <= N with evidence", "re-plan / swap agent",
          "rollback unit (worktree)", "escalate (F3/F5) with pack"], legend="Legend", main="main flow",
          loop="loop / fallback", bus="event bus", bus_label="every step emits events (failure code, tokens, agent version)")
VI = dict(ex_title="EX / Vòng lặp + fallback", ex_lines=["sửa lại <= N lần, kèm bằng chứng", "lập lại kế hoạch / đổi agent",
          "hoàn tác unit (bỏ worktree)", "escalate (F3/F5) kèm gói bằng chứng"], legend="Chú thích", main="luồng chính",
          loop="vòng lặp / fallback", bus="dòng event",
          bus_label="mỗi bước phát event (mã lỗi, token, phiên bản agent)")


def render_swimlane(steps, tid, lane_defs, new_label="highlighted step", bus_label=None, lang=None):
    L = lang or EN
    used = {s["lane"] for s in steps} | {"learn"}
    lanes = OrderedDict((k, (lbl, acc, fill)) for k, lbl, acc, fill in lane_defs if k in used)
    keys = list(lanes)
    lane_top = {k: TOP + i * (LANE_H + LANE_GAP) for i, k in enumerate(keys)}
    ex_top = TOP + len(keys) * (LANE_H + LANE_GAP)
    n = len(steps)
    W = X0 + n * COL_W + 40
    H = ex_top + EX_H + 110
    pos = {s["id"]: (X0 + i * COL_W, lane_top[s["lane"]] + (LANE_H - NODE_H) / 2 + 8) for i, s in enumerate(steps)}
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" '
           f'aria-labelledby="{tid}"><title id="{tid}">Swimlane diagram</title>'] + _defs(tid)
    out.append(f'<rect width="{W}" height="{H}" fill="{BG}"/><rect width="{W}" height="{H}" fill="url(#grid)"/>')
    phases = OrderedDict()
    for i, s in enumerate(steps):
        phases.setdefault(s["phase"], []).append(i)
    for pi, (ph, idx) in enumerate(phases.items()):
        x1, x2 = X0 + idx[0] * COL_W - 6, X0 + idx[-1] * COL_W + NODE_W + 6
        col = PHASE_COLORS[pi % len(PHASE_COLORS)]
        out.append(f'<rect x="{x1}" y="40" width="{x2 - x1}" height="34" rx="17" fill="#101928" stroke="{col}" '
                   f'stroke-width="1.5"/><rect x="{x1 + 24}" y="77" width="{max(0, x2 - x1 - 48)}" height="3" '
                   f'rx="1.5" fill="{col}" opacity="0.55"/>')
        out.append(text((x1 + x2) / 2, 62, ph, 14, col, 800))
    for k in keys:
        lbl, acc, fill = lanes[k]
        y = lane_top[k]
        out.append(f'<rect x="20" y="{y}" width="{W - 40}" height="{LANE_H}" rx="14" fill="{fill}" '
                   f'fill-opacity="0.25" stroke="#263650" stroke-width="2" stroke-dasharray="9 7"/>')
        for j, part in enumerate(wrap(lbl, 26, 3)):
            out.append(text(36, y + 26 + j * 17, part, 12.5, acc if j == 0 else "#6b7a93",
                            800 if j == 0 else 500, "start"))
    out.append(f'<rect x="20" y="{ex_top}" width="{W - 40}" height="{EX_H}" rx="14" fill="#2a1421" '
               f'fill-opacity="0.25" stroke="{PINK}" stroke-width="2" stroke-dasharray="9 7"/>'
               f'<rect x="28" y="{ex_top + 8}" width="{W - 56}" height="{EX_H - 16}" rx="10" fill="none" '
               f'stroke="{PINK}" stroke-opacity="0.35" stroke-width="1" stroke-dasharray="4 6"/>')
    out.append(text(36, ex_top + 28, L["ex_title"], 12.5, PINK, 800, "start"))
    for j, part in enumerate(L["ex_lines"]):
        out.append(text(36, ex_top + 50 + j * 17, part, 11, "#c98aa3", 500, "start"))
    ly = lane_top["learn"] + 22
    out.append(f'<path d="M{X0 - 10} {ly}H{W - 40}" stroke="{LAV}" stroke-width="1.6" stroke-dasharray="6 6" '
               f'fill="none" opacity="0.8"/>')
    labels = [label_on_line(X0 + COL_W * 1.5 + NODE_W / 2, ly,
                            bus_label or L["bus_label"], LAV)]
    for i in range(n - 1):
        a, b = steps[i], steps[i + 1]
        (ax, ay), (bx, by) = pos[a["id"]], pos[b["id"]]
        y1, y2, x1, x2 = ay + NODE_H / 2, by + NODE_H / 2, ax + NODE_W, bx
        if abs(y1 - y2) < 1:
            d = f"M{x1} {y1}H{x2 - 2}"
        else:
            mid = x1 + (COL_W - NODE_W) / 2
            d = f"M{x1} {y1}H{mid}V{y2}H{x2 - 2}"
        out.append(f'<path d="{d}" stroke="{TEAL_LINE}" stroke-width="3" fill="none" filter="url(#glow)" '
                   f'marker-end="url(#ar-teal-{tid})"/>')
    track = 0
    for s in steps:
        if not s.get("rework") or s["rework"][0] not in pos:
            continue
        tgt, lbl = s["rework"]
        (sx, sy), (tx, ty) = pos[s["id"]], pos[tgt]
        ty_track = ex_top + 40 + (track % 6) * 20
        track += 1
        x_src, x_tgt = sx + NODE_W / 2 + 18, tx + NODE_W / 2 - 18
        out.append(f'<path d="M{x_src} {sy + NODE_H}V{ty_track}H{x_tgt}V{ty + NODE_H + 2}" stroke="{PINK}" '
                   f'stroke-width="2" stroke-dasharray="9 6" fill="none" marker-end="url(#ar-pink-{tid})"/>')
        labels.append(label_on_line((x_src + x_tgt) / 2, ty_track, lbl, PINK))
    out.extend(labels)
    for s in steps:
        x, y = pos[s["id"]]
        _, acc, fill = lanes[s["lane"]]
        body = node(x, y, NODE_W, NODE_H, s["id"], s["title"], s.get("sub", ""), s.get("tag", ""), acc, fill,
                    s.get("mark"))
        out += with_tip(body, s["id"], s["title"], acc, s.get("detail"))
    ly = ex_top + EX_H + 40
    out.append(text(36, ly, L["legend"], 14, "#f3f6fb", 800, "start", "Inter, Segoe UI, sans-serif"))
    lx = 130
    items = [(acc, lbl.split(" / ")[1].split(" (")[0], "box") for k, lbl, acc, _ in lane_defs if k in lanes]
    items += [(TEAL_LINE, L["main"], "line"), (PINK, L["loop"], "dash"), (LAV, L["bus"], "dash"),
              (YELLOW, new_label, "new")]
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
            out.append(f'<path d="M{lx} {ly - 5}H{lx + 26}" stroke="{col}" stroke-width="2" stroke-dasharray="6 4"/>')
        out.append(text(lx + 34, ly, lbl, 11.5, "#a7b0bf", 500, "start"))
        lx += 52 + len(lbl) * 7.2
    out.append("</svg>")
    return "\n".join(out)


def render_dag(nodes, edges, tid, title="", tips=None):
    """nodes: list of (id, title, sub, tag, accent, fill); edges: list of (src, dst, label)."""
    ids = [n[0] for n in nodes]
    preds = {i: [s for s, d, _ in edges if d == i] for i in ids}
    layer = {}

    def depth(i):
        if i not in layer:
            layer[i] = 0 if not preds[i] else 1 + max(depth(p) for p in preds[i])
        return layer[i]
    for i in ids:
        depth(i)
    cols = OrderedDict()
    for i in ids:
        cols.setdefault(layer[i], []).append(i)
    w, h, cw, rh = 230, 116, 300, 150
    rows = max(len(v) for v in cols.values())
    W = 80 + len(cols) * cw
    H = 120 + rows * rh + 80
    bottom = 90 + rows * rh + 10          # track under every node, for edges that skip a wave
    pos = {}
    for c, members in cols.items():
        off = (rows - len(members)) * rh / 2
        for r, i in enumerate(members):
            pos[i] = (50 + c * cw, 90 + off + r * rh)
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" '
           f'aria-labelledby="{tid}"><title id="{tid}">Dependency graph</title>'] + _defs(tid)
    out.append(f'<rect width="{W}" height="{H}" fill="{BG}"/><rect width="{W}" height="{H}" fill="url(#grid)"/>')
    for c in cols:
        x = 50 + c * cw
        out.append(text(x + w / 2, 52, f"wave {c}", 13, PHASE_COLORS[c % len(PHASE_COLORS)], 800))
    labels = []
    for s, d, lbl in edges:
        (sx, sy), (dx, dy) = pos[s], pos[d]
        y1, y2, x1, x2 = sy + h / 2, dy + h / 2, sx + w, dx
        mid = x1 + (x2 - x1) / 2
        between = [pos[o] for o in ids if layer[s] < layer[o] < layer[d]]
        blocked = any(oy - 6 <= y2 <= oy + h + 6 for _, oy in between)
        if layer[d] - layer[s] > 1 and blocked:   # go round underneath, each such edge on its own track
            under = bottom + 22 * len([1 for t in labels if t.startswith("<!--under-->")])
            labels.append("<!--under-->")
            b_ = x2 - 30
            path = f"M{sx + w / 2} {sy + h}V{under}H{b_}V{y2}H{x2 - 2}"
            mid = (sx + w / 2 + b_) / 2
            y1 = y2 = under
        else:
            path = f"M{x1} {y1}H{mid}V{y2}H{x2 - 2}"
        out.append(f'<path d="{path}" stroke="{TEAL_LINE}" stroke-width="2.5" fill="none" '
                   f'marker-end="url(#ar-teal-{tid})"/>')
        if lbl:
            labels.append(label_on_line(mid, (y1 + y2) / 2 if abs(y1 - y2) > 30 else y1 - 12, lbl, "#7f93b0"))
    out.extend(labels)
    for nid, t, sub, tag, acc, fill in nodes:
        x, y = pos[nid]
        out += with_tip(node(x, y, w, h, nid, t, sub, tag, acc, fill, tlen=27, slen=34), nid, t, acc,
                        (tips or {}).get(nid))
    out.append("</svg>")
    return "\n".join(out)


def render_blocks(spec, tid, tips=None):
    """spec: dict(width, height, boxes=[(x,y,w,h,label,accent,dashed)], nodes=[(x,y,w,h,id,title,sub,tag,acc,fill)],
    arrows=[(points, color_key, label)])."""
    W, H = spec["width"], spec["height"]
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" '
           f'aria-labelledby="{tid}"><title id="{tid}">Block diagram</title>'] + _defs(tid)
    out.append(f'<rect width="{W}" height="{H}" fill="{BG}"/><rect width="{W}" height="{H}" fill="url(#grid)"/>')
    for x, y, w, h, lbl, acc, dashed in spec["boxes"]:
        dash = ' stroke-dasharray="9 7"' if dashed else ""
        out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="{acc}" fill-opacity="0.04" '
                   f'stroke="{acc}" stroke-width="2"{dash}/>')
        out.append(f'<rect x="{x + 12}" y="{y - 10}" width="{len(lbl) * 7.6 + 14}" height="20" fill="{BG}"/>')
        out.append(text(x + 19, y + 5, lbl, 13, acc, 800, "start"))
    colors = {"teal": TEAL_LINE, "pink": PINK, "lav": LAV, "grey": "#7f93b0", "yel": YELLOW}
    labels = []
    for pts, ck, lbl in spec.get("arrows", []):
        d = "M" + " L".join(f"{px} {py}" for px, py in pts)
        dash = ' stroke-dasharray="7 5"' if ck in ("lav", "pink") else ""
        out.append(f'<path d="{d}" stroke="{colors[ck]}" stroke-width="2.5" fill="none"{dash} '
                   f'marker-end="url(#ar-{ck}-{tid})"/>')
        if lbl:
            (ax, ay), (bx, by) = pts[-2], pts[-1]
            labels.append(label_on_line((ax + bx) / 2, (ay + by) / 2, lbl, colors[ck]))
    out.extend(labels)
    for x, y, w, h, nid, t, sub, tag, acc, fill in spec["nodes"]:
        body = node(x, y, w, h, nid, t, sub, tag, acc, fill, tlen=max(16, int(w / 8.6)), slen=max(18, int(w / 6.7)))
        key = nid or t
        tip = (tips or {}).get(key)
        out += with_tip(body, tip.get("_id", key) if tip else key, t, acc,
                        {k: v for k, v in tip.items() if k != "_id"} if tip else None)
    out.append("</svg>")
    return "\n".join(out)
