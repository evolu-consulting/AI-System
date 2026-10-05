// HUB-H2c-AC-17 · HUB-FR-44 · WRK-FR-11 · WRK-FR-18 · test-plan-py H2c §4 SM1–SM3: smoke Hub thật + Runtime + `claude-sub`
// thật với file đính kèm (`HUB_LIVE=1 bun run test:smoke:live`; vắng cờ → mọi ca skip). Không chặn `done:h2c`, không khoá.
// File mẫu sinh trong test (PDF 2 trang chữ Helvetica, PNG xám chữ bitmap 5×7 phóng to) — không có file nhị phân trong repo.
// Phần Dify thật của SM2/M01 KHÔNG chạy ở đây (bỏ qua theo yêu cầu người dùng 2026-10-05 — xem `H2c-attachments/smoke.md`).
// Env như `h2b-live.test.ts`: `HUB_URL`, `AUTH_URL`, `SMOKE_USER`, `SMOKE_TOKEN`; thêm `SMOKE_WRITE_AGENT` (agent có
// `allowed_tools` ∋ `Write`, mặc định `writer`). Mỗi ca in số đo + câu trả lời đã cắt (nội dung mẫu, không bí mật).
import { describe, expect, it } from "bun:test";
import { makePdf, makePng, PDF_PAGES, PNG_TEXT } from "./_h2c-samples";

const env = (k: string) => process.env[k]?.trim() || undefined;
const LIVE = (env("HUB_LIVE") ?? "0") !== "0";
const HUB = (env("HUB_URL") ?? "http://localhost:3200").replace(/\/+$/, "");
const AUTH = (env("AUTH_URL") ?? env("ADMIN_API_URL") ?? HUB).replace(/\/+$/, "");
const USER = env("SMOKE_USER")
  ? JSON.parse(env("SMOKE_USER") as string)
  : { tenant_key: "acme", username: "lan", password: "dev-password-1" };
const WRITE_AGENT = env("SMOKE_WRITE_AGENT") ?? "writer";

// ---------- Hub ----------
type Ev = { event: string; data: Record<string, unknown> | null; t: number };

async function login(): Promise<string> {
  const pre = env("SMOKE_TOKEN");
  if (pre) return pre;
  const res = await fetch(`${AUTH}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(USER),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { access_token: string }).access_token;
}

const json = (token: string, method: string, path: string, body?: unknown) =>
  fetch(`${HUB}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function upload(token: string, name: string, bytes: Uint8Array): Promise<string> {
  const res = await fetch(`${HUB}/attachments`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "x-filename": encodeURIComponent(name) },
    body: bytes as BodyInit,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

function parseFrame(raw: string): Ev | null {
  let event = "message";
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    const v = line.slice(line.indexOf(":") + 1).replace(/^ /, "");
    if (line.startsWith("event:")) event = v;
    else if (line.startsWith("data:")) data.push(v);
  }
  return data.length ? { event, data: JSON.parse(data.join("\n")), t: 0 } : null;
}

type Asked = { events: Ev[]; conv: string; flowId: string; answer: string };

/** Hội thoại mới + E12 (`attachment_ids`) → đọc SSE tới kết thúc → nội dung tin assistant từ lịch sử (E11). */
async function ask(token: string, content: string, ids: string[] = []): Promise<Asked> {
  const conv = await json(token, "POST", "/conversations", { title: `smoke h2c ${Date.now()}` });
  const convId = ((await conv.json()) as { id: string }).id;
  const t0 = performance.now();
  const body = ids.length ? { content, attachment_ids: ids } : { content };
  const res = await json(token, "POST", `/conversations/${convId}/messages`, body);
  expect(res.status).toBe(200);
  const flowId = res.headers.get("x-flow-id") ?? "";
  const events: Ev[] = [];
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (!events.some((e) => e.event === "run.finished" || e.event === "run.failed")) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    const frames = buf.split("\n\n");
    buf = frames.pop() ?? "";
    for (const f of frames) {
      const e = parseFrame(f);
      if (e) events.push({ ...e, t: Math.round(performance.now() - t0) });
    }
  }
  await reader.cancel().catch(() => undefined);
  const answer = String((await lastAssistant(token, convId, flowId))?.content ?? "");
  const end = events.at(-1);
  console.log(
    `[smoke] run=${res.headers.get("x-run-id")} end=${end?.event}@${end?.t}ms ` +
      `code=${String(end?.data?.code ?? "")} delta=${events.filter((e) => e.event === "delta").length} ` +
      `answer=${JSON.stringify(answer.slice(0, 300))}`,
  );
  return { events, conv: convId, flowId, answer };
}

type Msg = { role: string; content?: string; attachments?: { id: string; filename: string }[] };
async function lastAssistant(
  token: string,
  conv: string,
  flowId: string,
): Promise<Msg | undefined> {
  const res = await json(token, "GET", `/conversations/${conv}/messages?flow_id=${flowId}`);
  expect(res.status).toBe(200);
  const items = ((await res.json()) as { items: Msg[] }).items;
  return items.filter((m) => m.role === "assistant").at(-1);
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");

describe.if(LIVE)("SM1–SM3 · smoke H2c file đính kèm claude-sub thật [HUB-H2c-AC-17]", () => {
  it("WRK-FR-11 · SM1 · '@assistant' + PDF 2 trang → trả đúng câu trang 2 [HUB-H2c-AC-17]", async () => {
    const token = await login();
    const id = await upload(token, "hai-trang.pdf", makePdf(PDF_PAGES));
    const r = await ask(
      token,
      "@assistant Đọc file PDF đính kèm. Chép nguyên văn (giữ tiếng Anh) câu ở trang 2, không thêm gì khác.",
      [id],
    );
    expect(r.events.at(-1)?.event).toBe("run.finished");
    expect(norm(r.answer)).toContain("seven green lanterns");
    expect(norm(r.answer)).not.toContain("blue heron");
  });

  it("WRK-FR-11 · SM2 · '@assistant' + PNG chữ lớn → trả đúng chữ (phần Dify thật: bỏ qua) [HUB-H2c-AC-17]", async () => {
    const token = await login();
    const id = await upload(token, "chu-lon.png", makePng(PNG_TEXT));
    const r = await ask(
      token,
      "@assistant Xem ảnh PNG đính kèm. Trả lời đúng dòng chữ in trong ảnh, viết hoa, không thêm gì khác.",
      [id],
    );
    expect(r.events.at(-1)?.event).toBe("run.finished");
    expect(r.answer.toUpperCase()).toContain("ZEBRA");
    expect(r.answer).toContain("47");
  });

  it("WRK-FR-18 · SM3 · agent bật Write ghi out/report.md → tin assistant có attachments [report.md], /content khác rỗng [HUB-H2c-AC-17 · PL9]", async () => {
    const token = await login();
    const r = await ask(
      token,
      `@${WRITE_AGENT} Dùng công cụ Write ghi một bản tóm tắt markdown 3 gạch đầu dòng về lợi ích của việc đi bộ ` +
        "vào file out/report.md (đường dẫn tương đối trong thư mục làm việc), rồi trả lời một câu ngắn là đã ghi.",
    );
    expect(r.events.at(-1)?.event).toBe("run.finished");
    const msg = await lastAssistant(token, r.conv, r.flowId);
    expect(msg?.attachments?.map((a) => a.filename)).toEqual(["report.md"]);
    const id = msg?.attachments?.[0]?.id ?? "";
    const res = await fetch(`${HUB}/attachments/${id}/content`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    console.log(`[smoke] SM3 report.md status=${res.status} chars=${text.length}`);
    expect(res.status).toBe(200);
    expect(text.trim().length).toBeGreaterThan(0);
  });
});
