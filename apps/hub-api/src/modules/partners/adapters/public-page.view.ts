// CR-124 · q5 · FLOW4-FR-12/13 · spec §8 · trang công khai (không đăng nhập) cho người liên hệ của công ty chưa dùng nền tảng. HTML tĩnh dựng ở máy chủ,
// KHÔNG script (CSP `script-src` không có): ba nút gửi form, kiểm ở máy chủ. Mọi chuỗi biến đi qua `escapeHtml`. Chỉ hiện đúng MỘT hợp đồng
// (bản chia sẻ A chọn) — không id nội bộ, không dữ liệu công ty khác.
import {
  escapeHtml as e,
  OUTCOME_TEXT,
  type Outcome,
  PARTNER_PUBLIC_PATH,
  sharedRows,
  vnDate,
} from "../domain/email-link.rules";
import type { EmailView } from "../domain/email-view.types";

const CSS = `
:root{--bg:#f4f6f8;--card:#fff;--ink:#1b2430;--mute:#5b6675;--line:#dde3ea;--pri:#1f5fbf;--pri-ink:#fff;--bad:#b42318;--warn-bg:#fff4e5;--warn:#8a4b00;--ok:#067647;--ok-bg:#e8f6ee}
@media (prefers-color-scheme:dark){:root{--bg:#10151c;--card:#18202a;--ink:#e7ecf2;--mute:#9aa7b6;--line:#2b3644;--pri:#5b9bff;--pri-ink:#0b1220;--bad:#ff8a80;--warn-bg:#33270f;--warn:#ffc27a;--ok:#5ad19a;--ok-bg:#12301f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 "Segoe UI",system-ui,Arial,sans-serif}
main{max-width:760px;margin:0 auto;padding:20px 16px 48px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin-top:16px}
.who{display:flex;gap:12px;align-items:center;flex-wrap:wrap;color:var(--mute);font-size:14px}.who b{color:var(--ink);font-size:16px}
.badge{font-size:12px;padding:2px 8px;border-radius:999px;border:1px solid var(--line)}.badge.v{color:var(--ok);background:var(--ok-bg);border-color:transparent}
h1{font-size:22px;line-height:1.3;margin:6px 0 4px}h2{font-size:16px;margin:0 0 10px}
.chip{display:inline-block;font-size:12px;background:var(--warn-bg);color:var(--warn);border-radius:6px;padding:1px 8px;margin-left:8px;vertical-align:middle}
.note{border-left:3px solid var(--line);padding:4px 12px;color:var(--mute);margin:12px 0}
.prev{background:var(--warn-bg);color:var(--warn);border-radius:8px;padding:10px 12px;margin:12px 0;font-size:14px}
dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 18px;margin:12px 0 0}dt{color:var(--mute)}dd{margin:0}
iframe{width:100%;height:60vh;min-height:360px;border:1px solid var(--line);border-radius:8px;background:#fff}
.pdflink{display:inline-block;margin-top:8px;font-size:14px;color:var(--pri)}
label{display:block;font-size:14px;color:var(--mute);margin:12px 0 4px}
input,textarea{width:100%;font:inherit;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:9px 10px}
textarea{min-height:92px;resize:vertical}
.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media (max-width:560px){.row{grid-template-columns:1fr}}
.acts{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}
button{font:inherit;font-weight:600;border-radius:8px;padding:10px 18px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
button.pri{background:var(--pri);color:var(--pri-ink);border-color:var(--pri)}button.bad{color:var(--bad);border-color:var(--bad)}
.err{color:var(--bad);background:var(--warn-bg);border-radius:8px;padding:8px 12px;margin-top:12px;font-size:14px}
.small{font-size:13px;color:var(--mute);margin-top:14px}
.big{text-align:center;padding:36px 20px}.big h1{font-size:20px}
`;

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer"><title>${e(title)}</title><style>${CSS}</style></head>
<body><main>${body}</main></body></html>`;
}

/** Trang thông báo ngắn (link sai/hết hạn/quá tải…). */
export function messagePage(title: string, text: string): string {
  return shell(title, `<div class="card big"><h1>${e(title)}</h1><p>${e(text)}</p></div>`);
}

export const invalidPage = (): string =>
  messagePage(
    "Link không hợp lệ hoặc đã hết hạn",
    "Vui lòng mở lại link trong email mới nhất hoặc liên hệ công ty đã gửi hợp đồng cho bạn.",
  );

export const limitedPage = (retryAfterS: number): string =>
  messagePage(
    "Quá nhiều lượt truy cập",
    `Vui lòng thử lại sau ${retryAfterS} giây. Nếu bạn cần trả lời gấp, hãy liên hệ công ty đã gửi hợp đồng.`,
  );

function senderBlock(v: EmailView): string {
  const tax = v.sender_tax_code ? ` · MST ${e(v.sender_tax_code)}` : "";
  const badge = v.sender_verified
    ? `<span class="badge v">Đã xác minh</span>`
    : `<span class="badge">Chưa xác minh</span>`;
  return `<div class="who"><span>Gửi từ</span> <b>${e(v.sender_name ?? "Công ty đối tác")}</b>${tax} ${badge}</div>`;
}

/** Link hết hạn / đã đóng: chỉ tên công ty gửi, không nội dung (FR-13). */
export function endedPage(v: EmailView): string {
  const name = v.sender_name ?? "công ty đã gửi";
  return v.state === "closed"
    ? messagePage(
        "Hợp đồng này đã được ghi nhận",
        `${name} đã ghi nhận kết quả bằng cách khác, không cần trả lời thêm.`,
      )
    : messagePage("Link đã hết hạn", `Vui lòng liên hệ ${name} để được gửi lại hợp đồng.`);
}

function contractBlock(v: EmailView, pdfUrl: string): string {
  const p = v.payload ?? {};
  const title = typeof p.title === "string" && p.title ? p.title : "Hợp đồng";
  const rows = sharedRows(p.fields);
  const msg = typeof p.message === "string" ? p.message : "";
  const dl = [
    ...rows.map((r) => `<dt>${e(r.label)}</dt><dd>${e(r.value)}</dd>`),
    `<dt>Hạn trả lời</dt><dd>${e(vnDate(new Date(v.expires_at)))}</dd>`,
  ].join("");
  return `<div class="card">${senderBlock(v)}
<h1>${e(title)}${v.round > 1 ? `<span class="chip">Bản sửa lần ${v.round}</span>` : ""}</h1>
${v.prev_reason ? `<div class="prev">Lần trước hợp đồng được trả lại vì: ${e(v.prev_reason)}</div>` : ""}
${msg ? `<div class="note">${e(msg)}</div>` : ""}<dl>${dl}</dl></div>
<div class="card"><h2>Nội dung hợp đồng</h2>
<iframe src="${e(pdfUrl)}" title="Hợp đồng (PDF)"></iframe>
<a class="pdflink" href="${e(pdfUrl)}" target="_blank" rel="noopener noreferrer">Mở bản PDF trong tab mới</a></div>`;
}

export type FormValues = { name?: string; title?: string; reason?: string };

/** Trang xem + form trả lời (state `open`). `csrf` = giá trị cookie đôi (double-submit). */
export function openPage(
  v: EmailView,
  o: { token: string; csrf: string; error?: string; values?: FormValues },
): string {
  const base = `${PARTNER_PUBLIC_PATH}/${o.token}`;
  const val = o.values ?? {};
  return shell(
    "Xác nhận hợp đồng",
    `${contractBlock(v, `${base}/pdf`)}
<form class="card" method="post" action="${e(base)}" autocomplete="off">
<h2>Ý kiến của Quý công ty</h2>
<input type="hidden" name="csrf" value="${e(o.csrf)}">
<div class="row"><div><label for="name">Họ tên người trả lời</label><input id="name" name="name" required minlength="2" maxlength="120" value="${e(val.name ?? "")}"></div>
<div><label for="title">Chức vụ</label><input id="title" name="title" required minlength="2" maxlength="120" value="${e(val.title ?? "")}"></div></div>
<label for="reason">Lý do (bắt buộc khi Trả lại sửa hoặc Từ chối)</label>
<textarea id="reason" name="reason" maxlength="2000">${e(val.reason ?? "")}</textarea>
${o.error ? `<div class="err" role="alert">${e(o.error)}</div>` : ""}
<div class="acts"><button class="pri" type="submit" name="action" value="confirm">Xác nhận</button>
<button type="submit" name="action" value="return">Trả lại sửa</button>
<button class="bad" type="submit" name="action" value="decline">Từ chối</button></div>
<p class="small">Xác nhận qua email chỉ ghi nhận ý kiến của Quý công ty, không phải chữ ký số. Hệ thống lưu thời điểm, họ tên, chức vụ và địa chỉ mạng rút gọn của người trả lời.</p>
</form>
<p class="small">Dùng nền tảng để nhận hợp đồng theo quy trình duyệt của chính công ty bạn — liên hệ ${e(v.sender_name ?? "công ty gửi")} để được mời.</p>`,
  );
}

/** Đã trả lời (state `replied`): chỉ xem 7 ngày. */
export function repliedPage(v: EmailView, token: string): string {
  const out = (v.outcome ?? "confirmed") as Outcome;
  return shell(
    "Đã ghi nhận ý kiến",
    `<div class="card big"><h1>Cảm ơn Quý công ty, ý kiến đã được ghi nhận</h1>
<p><b>${e(OUTCOME_TEXT[out])}</b>${v.reason ? ` — ${e(v.reason)}` : ""}</p>
<p class="small">${e(v.sender_name ?? "Công ty gửi")} sẽ nhận được kết quả. Link này chỉ trả lời được một lần.</p></div>
${contractBlock(v, `${PARTNER_PUBLIC_PATH}/${token}/pdf`)}`,
  );
}
