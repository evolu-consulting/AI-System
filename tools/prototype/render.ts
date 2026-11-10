// renderPrototype(json) → MỘT file HTML tự chứa (CSS/JS nội tuyến, không gọi mạng). Mọi chữ của người dùng đều được escape.
import { type Prototype, prototypeSchema } from "./schema";

export const esc = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

type Leaf = Extract<Prototype["screens"][number]["blocks"][number], { type: string }>;

const STATUS: Record<string, string> = { done: "Xong", open: "Cần làm", waiting: "Đang chờ" };

function leaf(b: Leaf): string {
  switch (b.type) {
    case "heading":
      return `<h3>${esc(b.text)}</h3>`;
    case "text":
      return `<p>${esc(b.text)}</p>`;
    case "field": {
      const req = b.required ? ' <span class="req">*</span>' : "";
      let ctl: string;
      if (b.kind === "select")
        ctl = `<select>${b.options.map((o) => `<option${o === b.value ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
      else if (b.kind === "checkbox")
        ctl = `<input type="checkbox"${b.value === "true" ? " checked" : ""}>`;
      else ctl = `<input type="${b.kind}" value="${esc(b.value)}">`;
      return `<label class="field"><span>${esc(b.label)}${req}</span>${ctl}</label>`;
    }
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
    case "button": {
      const g = b.goto ? ` data-goto="${esc(b.goto)}"` : "";
      const r = b.role ? ` data-role="${esc(b.role)}"` : "";
      return `<button type="button" class="btn ${b.variant}"${g}${r}>${esc(b.label)}</button>`;
    }
    default:
      return `<div class="banner ${b.kind}">${esc(b.text)}</div>`;
  }
}

function block(b: Prototype["screens"][number]["blocks"][number]): string {
  if (b.type !== "states") return leaf(b);
  const tabs = b.variants
    .map(
      (v, i) =>
        `<button type="button" class="chip${i ? "" : " on"}" data-state="${esc(v.key)}">${esc(v.label)}</button>`,
    )
    .join("");
  const bodies = b.variants
    .map(
      (v, i) =>
        `<div class="variant" data-variant="${esc(v.key)}"${i ? " hidden" : ""}>${v.blocks.map(leaf).join("")}</div>`,
    )
    .join("");
  return `<div class="states"><div class="chips">Trạng thái: ${tabs}</div>${bodies}</div>`;
}

const CSS = `
:root{--background:#f4f4f9;--foreground:#0a0a0a;--card:#fff;--muted:#f5f5f5;--muted-foreground:#6b6b6b;--primary:#4f46e5;--primary-foreground:#fff;--accent:#eef2ff;--border:#e5e5e5;--destructive:#b42318;--success:#05603f;--warning:#7f3c04;--radius:8px;--font:"Be Vietnam Pro","Segoe UI",system-ui,sans-serif}
@media(prefers-color-scheme:dark){:root{--background:#0e0f1c;--foreground:#ececf4;--card:#17182a;--muted:#1d1f33;--muted-foreground:#a1a3b8;--primary:#818cf8;--primary-foreground:#0e0f1c;--accent:#24264a;--border:#2a2c44;--success:#6ee7a8;--warning:#fbbf24}}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 var(--font);background:var(--background);color:var(--foreground)}
.ribbon{background:var(--warning);color:var(--card);text-align:center;padding:4px 8px;font-weight:600}
header{display:flex;gap:16px;align-items:center;flex-wrap:wrap;padding:10px 16px;background:var(--card);border-bottom:1px solid var(--border)}
header h1{font-size:16px;margin:0;flex:1}select,input{font:inherit;color:inherit;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:6px 8px}
.tabs button{font:inherit;background:none;border:0;padding:6px 10px;cursor:pointer;color:var(--muted-foreground);border-bottom:2px solid transparent}.tabs button.on{color:var(--primary);border-color:var(--primary)}
.layout{display:flex;min-height:calc(100vh - 100px)}nav{width:220px;padding:12px;border-right:1px solid var(--border);background:var(--card)}
nav button{display:block;width:100%;text-align:left;font:inherit;color:inherit;background:none;border:0;border-radius:var(--radius);padding:8px 10px;cursor:pointer}nav button.on{background:var(--accent);color:var(--primary);font-weight:600}
main{flex:1;padding:20px;max-width:860px}.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:20px}
h2{margin:0 0 12px}h3{margin:16px 0 6px}.field{display:block;margin:10px 0}.field>span{display:block;color:var(--muted-foreground);margin-bottom:2px}.field input[type=text],.field input:not([type]),.field select{width:100%;max-width:420px}.req{color:var(--destructive)}
table{border-collapse:collapse;width:100%;margin:8px 0}th,td{border-bottom:1px solid var(--border);padding:6px 8px;text-align:left}th{color:var(--muted-foreground);font-weight:600}
.btn{font:inherit;border-radius:var(--radius);padding:8px 14px;cursor:pointer;margin:8px 8px 0 0;border:1px solid var(--border);background:var(--card);color:var(--foreground)}.btn.primary{background:var(--primary);color:var(--primary-foreground);border-color:var(--primary)}.btn.danger{color:var(--destructive);border-color:var(--destructive)}
.banner{border-radius:var(--radius);padding:10px 12px;margin:10px 0;border:1px solid var(--border);background:var(--accent)}.banner.warn{border-color:var(--warning)}.banner.error{border-color:var(--destructive);color:var(--destructive)}
.steps{padding-left:20px}.steps li{margin:6px 0}.tag{font-size:12px;border-radius:99px;padding:1px 8px;background:var(--muted);color:var(--muted-foreground)}.st-done .tag{color:var(--success)}.st-open .tag{color:var(--primary)}.st-waiting .tag{color:var(--warning)}
.chips{margin:8px 0}.chip{font:inherit;border:1px solid var(--border);background:var(--card);color:inherit;border-radius:99px;padding:2px 10px;margin-left:6px;cursor:pointer}.chip.on{background:var(--primary);color:var(--primary-foreground)}
.flow li{margin:8px 0}.notes{color:var(--muted-foreground)}[hidden]{display:none!important}
@media(max-width:640px){.layout{flex-direction:column}nav{width:auto;border-right:0;border-bottom:1px solid var(--border)}}`;

const JS = `(function(){
var d=document,$=function(s,r){return Array.prototype.slice.call((r||d).querySelectorAll(s))};
var role="",cur=$("[data-screen]")[0]&&$("[data-screen]")[0].getAttribute("data-screen");
function ok(el){var r=el.getAttribute("data-role");return !r||!role||r===role}
function paint(){
 $("[data-nav]").forEach(function(n){n.hidden=!ok(n)});
 var vis=$("[data-nav]").filter(function(n){return !n.hidden}).map(function(n){return n.getAttribute("data-nav")});
 if(vis.indexOf(cur)<0)cur=vis[0];
 $("[data-screen]").forEach(function(s){s.hidden=s.getAttribute("data-screen")!==cur});
 $("[data-nav]").forEach(function(n){n.classList.toggle("on",n.getAttribute("data-nav")===cur)});
 $("main .btn[data-role]").forEach(function(b){b.hidden=!ok(b)});
 $(".flow li").forEach(function(l){l.hidden=!ok(l)});
}
d.addEventListener("click",function(e){var t=e.target;if(!t.closest)return;
 var n=t.closest("[data-nav]");if(n){cur=n.getAttribute("data-nav");paint();return}
 var g=t.closest("[data-goto]");if(g){cur=g.getAttribute("data-goto");showTab("screens");paint();return}
 var st=t.closest("[data-state]");if(st){var box=st.closest(".states");$("[data-state]",box).forEach(function(c){c.classList.toggle("on",c===st)});$("[data-variant]",box).forEach(function(v){v.hidden=v.getAttribute("data-variant")!==st.getAttribute("data-state")});return}
 var tb=t.closest("[data-tab]");if(tb)showTab(tb.getAttribute("data-tab"))});
d.getElementById("role").addEventListener("change",function(e){role=e.target.value;paint()});
function showTab(k){$("[data-tab]").forEach(function(b){b.classList.toggle("on",b.getAttribute("data-tab")===k)});$("[data-pane]").forEach(function(p){p.hidden=p.getAttribute("data-pane")!==k})}
paint()})();`;

export function renderPrototype(input: unknown): string {
  const p = prototypeSchema.parse(input);
  const label = new Map(p.roles.map((r) => [r.key, r.label]));
  const roleAttr = (r?: string) => (r ? ` data-role="${esc(r)}"` : "");
  const nav = p.screens
    .map(
      (s) =>
        `<button type="button" data-nav="${esc(s.id)}"${roleAttr(s.role)}>${esc(s.title)}</button>`,
    )
    .join("");
  const screens = p.screens
    .map(
      (s) =>
        `<section class="card" data-screen="${esc(s.id)}"${roleAttr(s.role)} hidden><h2>${esc(s.title)}</h2>${s.blocks.map(block).join("")}</section>`,
    )
    .join("");
  const title = (id: string) => p.screens.find((s) => s.id === id)?.title ?? id;
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
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(p.title)} — Bản mẫu</title><style>${CSS}</style></head><body>
<div class="ribbon">Bản mẫu — dữ liệu giả</div>
<header><h1>${esc(p.title)}</h1>
<label>Xem với vai: <select id="role"><option value="">Tất cả</option>${opts}</select></label>
<div class="tabs"><button type="button" class="on" data-tab="screens">Màn hình</button><button type="button" data-tab="flow">Luồng</button></div></header>
<div data-pane="screens" class="layout"><nav>${nav}</nav><main>${screens}</main></div>
<div data-pane="flow" hidden class="layout"><main><div class="card"><h2>Luồng: ai làm gì</h2><ol class="flow">${flow}</ol>${notes}</div></main></div>
<script>${JS}</script></body></html>
`;
}
