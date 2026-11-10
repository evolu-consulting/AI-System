// renderPrototype(json) → MỘT file HTML tự chứa (CSS/JS nội tuyến, không gọi mạng). Mọi chữ của người dùng đều được escape.
import { PURE_JS, UI_JS } from "./client";
import { protoId, protoVersion } from "./feedback.rules";
import { flowSvg } from "./flow";
import { esc } from "./html";
import { type Leaf, type Prototype, prototypeSchema } from "./schema";
import { CSS } from "./style";

export { esc };

type Block = Prototype["screens"][number]["blocks"][number];
type Ctx = { modals: number };

const STATUS: Record<string, string> = { done: "Xong", open: "Cần làm", waiting: "Đang chờ" };
const attr = (name: string, v?: string) => (v ? ` ${name}="${esc(v)}"` : "");

function field(b: Extract<Leaf, { type: "field" }>): string {
  const req = b.required ? ' <span class="req">*</span>' : "";
  let ctl: string;
  if (b.kind === "select")
    ctl = `<select>${b.options.map((o) => `<option${o === b.value ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
  else if (b.kind === "checkbox")
    ctl = `<input type="checkbox"${b.value === "true" ? " checked" : ""}>`;
  else ctl = `<input type="${b.kind}" value="${esc(b.value)}">`;
  return `<label class="field"><span>${esc(b.label)}${req}</span>${ctl}</label>`;
}

function modal(b: Extract<Leaf, { type: "modal" }>, ctx: Ctx): string {
  const n = ctx.modals++;
  return `<button type="button" class="btn ${b.danger ? "danger" : "secondary"}" data-modal="${n}">${esc(b.trigger)}</button><div class="modal" data-modal-box="${n}" hidden><div class="dlg" role="dialog" aria-modal="true"><h3>${esc(b.title)}</h3><p>${esc(b.text)}</p><button type="button" class="btn secondary" data-close>${esc(b.cancel)}</button><button type="button" class="btn ${b.danger ? "danger" : "primary"}" data-close${attr("data-goto", b.goto)}>${esc(b.confirm)}</button></div></div>`;
}

function leaf(b: Leaf, ctx: Ctx): string {
  switch (b.type) {
    case "heading":
      return `<h3>${esc(b.text)}</h3>`;
    case "text":
      return `<p>${esc(b.text)}</p>`;
    case "field":
      return field(b);
    case "table":
      return `<table><thead><tr>${b.cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${b.rows
        .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table>`;
    case "steps":
      return `<ol class="steps">${b.items
        .map(
          (i) =>
            `<li class="st-${i.status}"><b>${esc(i.label)}</b> <span class="tag">${STATUS[i.status]}</span>${i.who ? ` <em>${esc(i.who)}</em>` : ""}</li>`,
        )
        .join("")}</ol>`;
    case "button":
      return `<button type="button" class="btn ${b.variant}"${attr("data-goto", b.goto)}${attr("data-role", b.role)}>${esc(b.label)}</button>`;
    case "banner":
      return `<div class="banner ${b.kind}">${esc(b.text)}</div>`;
    case "badge":
      return `<span class="badge ${b.tone}">${esc(b.text)}</span>`;
    case "stats":
      return `<div class="stats">${b.items.map((i) => `<div class="stat"><b>${esc(i.value)}</b><span>${esc(i.label)}</span></div>`).join("")}</div>`;
    case "cards":
      return `<div class="cards">${b.items
        .map(
          (i) =>
            `<div class="icard"${attr("data-goto", i.goto)}><b>${esc(i.title)}</b>${i.badge ? ` <span class="badge ${i.tone}">${esc(i.badge)}</span>` : ""}${i.text ? `<p>${esc(i.text)}</p>` : ""}</div>`,
        )
        .join("")}</div>`;
    case "empty":
      return `<div class="empty"><b>${esc(b.title)}</b>${esc(b.text)}${b.action ? `<div><button type="button" class="btn primary"${attr("data-goto", b.goto)}>${esc(b.action)}</button></div>` : ""}</div>`;
    case "modal":
      return modal(b, ctx);
    default:
      return `<button type="button" class="btn secondary" data-toast="${b.kind}" data-text="${esc(b.text)}">${esc(b.trigger)}</button>`;
  }
}

function switcher(
  cls: "states" | "itabs",
  items: { key: string; label: string; blocks: Leaf[] }[],
  ctx: Ctx,
): string {
  const [btn, pane, lead] =
    cls === "states"
      ? ["data-state", "data-variant", "Trạng thái: "]
      : ["data-itab", "data-ipane", ""];
  const chips = items
    .map(
      (v, i) =>
        `<button type="button" class="chip${i ? "" : " on"}" ${btn}="${esc(v.key)}">${esc(v.label)}</button>`,
    )
    .join("");
  const bodies = items
    .map(
      (v, i) =>
        `<div ${pane}="${esc(v.key)}"${i ? " hidden" : ""}>${v.blocks.map((l) => leaf(l, ctx)).join("")}</div>`,
    )
    .join("");
  return `<div class="${cls}"><div class="chips">${lead}${chips}</div>${bodies}</div>`;
}

function block(b: Block, ctx: Ctx): string {
  if (b.type === "states") return switcher("states", b.variants, ctx);
  if (b.type === "tabs") return switcher("itabs", b.tabs, ctx);
  return leaf(b, ctx);
}

function questionCard(q: Prototype["questions"][number], cls = ""): string {
  const opts = q.options
    .map(
      (o) =>
        `<button type="button" class="chip" data-qa="${esc(q.id)}" data-val="${esc(o)}">${esc(o)}${o === q.default ? " (gợi ý)" : ""}</button>`,
    )
    .join("");
  return `<div class="q${cls}" data-q="${esc(q.id)}"><p>${esc(q.text)}</p>${opts}</div>`;
}

function review(s: Prototype["screens"][number], qs: Prototype["questions"]): string {
  const id = esc(s.id);
  return `<div class="review"><b>Góp ý màn này:</b> <button type="button" class="chip" data-verdict="ok" data-sid="${id}">Đúng ý</button><button type="button" class="chip" data-verdict="fix" data-sid="${id}">Cần sửa</button><textarea data-note="${id}" placeholder="Ghi chú cho màn này (nếu có)"></textarea>${qs.map((q) => questionCard(q, " q-screen")).join("")}</div>`;
}

/** JSON nhúng trong thẻ script: chặn "<" để không đóng thẻ sớm. */
const jsonIn = (v: unknown): string => JSON.stringify(v).replace(/</g, "\\u003c");

function dataBlob(p: Prototype): string {
  return jsonIn({
    id: protoId(p),
    title: p.title,
    version: protoVersion(p),
    roles: p.roles,
    screens: p.screens.map((s) => ({ id: s.id, title: s.title, role: s.role ?? "" })),
    flow: p.flow,
    questions: p.questions.map((q) => ({
      id: q.id,
      text: q.text,
      screen: q.screen ?? "",
      default: q.default,
    })),
  });
}

export function renderPrototype(input: unknown): string {
  const p = prototypeSchema.parse(input);
  const ctx: Ctx = { modals: 0 };
  const label = new Map(p.roles.map((r) => [r.key, r.label]));
  const title = (id: string) => p.screens.find((s) => s.id === id)?.title ?? id;
  const nav = p.screens
    .map(
      (s) =>
        `<button type="button" data-nav="${esc(s.id)}"${attr("data-role", s.role)}>${esc(s.title)}</button>`,
    )
    .join("");
  const screens = p.screens
    .map((s) => {
      const qs = p.questions.filter((q) => q.screen === s.id);
      return `<section class="card" data-screen="${esc(s.id)}"${attr("data-role", s.role)} hidden><h2>${esc(s.title)}</h2>${s.blocks.map((b) => block(b, ctx)).join("")}${review(s, qs)}</section>`;
    })
    .join("");
  const flow = p.flow
    .map(
      (f) =>
        `<li data-role="${esc(f.by)}"><b>${esc(label.get(f.by) ?? f.by)}</b> — ${esc(f.action)}: «${esc(title(f.from))}» → «${esc(title(f.to))}»</li>`,
    )
    .join("");
  const notes = p.notes.length
    ? `<h3>Câu hỏi còn mở</h3><ul class="notes">${p.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`
    : "";
  const opts = p.roles
    .map((r) => `<option value="${esc(r.key)}">${esc(r.label)}</option>`)
    .join("");
  const qTab = p.questions.length
    ? '<button type="button" data-tab="questions">Câu hỏi</button>'
    : "";
  const qPane = p.questions.length
    ? `<div data-pane="questions" hidden class="layout"><main><div class="card"><h2>Câu cần anh/chị chốt</h2>${p.questions.map((q) => questionCard(q)).join("")}</div></main></div>`
    : "";
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(p.title)} — Bản mẫu</title><style>${CSS}</style></head><body>
<div class="ribbon">Bản mẫu — dữ liệu giả</div>
<header><h1>${esc(p.title)}</h1>
<label>Xem với vai: <select id="role"><option value="">Tất cả</option>${opts}</select></label>
<div class="seg"><button type="button" class="on" data-device="desktop">Máy tính</button><button type="button" data-device="phone">Điện thoại</button></div>
<label><input type="checkbox" id="review" checked> Góp ý</label>
<button type="button" class="btn secondary" id="walk-start" style="margin:0">Đi thử từng bước</button>
<span id="pending" class="pending"></span><button type="button" class="btn primary" id="export" style="margin:0">Xuất góp ý</button>
<div class="tabs"><button type="button" class="on" data-tab="screens">Màn hình</button><button type="button" data-tab="flow">Luồng</button>${qTab}</div></header>
<div id="walkbar" hidden><b id="walk-who"></b><span id="walk-what"></span><button type="button" class="btn" data-walk="back">Quay lại</button><button type="button" class="btn" data-walk="next">Tiếp</button><button type="button" class="btn" data-walk="stop">Thoát</button></div>
<div class="frame">
<div data-pane="screens" class="layout"><nav>${nav}</nav><main>${screens}</main></div>
<div data-pane="flow" hidden class="layout"><main><div class="card"><h2>Luồng: ai làm gì</h2>${flowSvg(p)}<ol class="flow">${flow}</ol>${notes}</div></main></div>
${qPane}</div>
<div class="modal" id="exp" hidden><div class="dlg" style="max-width:640px"><h3>Góp ý của anh/chị</h3><p>Bấm «Tải tệp» để gửi lại tệp, hoặc «Sao chép chữ» rồi dán vào khung chat.</p><textarea id="exp-text" readonly></textarea><button type="button" class="btn primary" data-exp="json">Tải tệp</button><button type="button" class="btn secondary" data-exp="copy">Sao chép chữ</button><button type="button" class="btn secondary" data-close>Đóng</button></div></div>
<div id="toast" class="toast" role="status" hidden></div>
<script type="application/json" id="proto-data">${dataBlob(p)}</script>
<script>(function(){${PURE_JS}${UI_JS}})();</script></body></html>
`;
}
