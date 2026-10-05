// HUB-FR-75 · HUB-FR-44 · H2c-R13 · HUB-H2c-AC-01 · AC-05 · test-plan-int §2.4 A30–A37: `GET /attachments/:id` và
// `/content` — chủ xem được (header đủ: nosniff, CSP sandbox, `attachment`, `no-store`); khác tenant/khác user/không có/
// không phải uuid → 404 thân giống hệt; 401 trước 404; hội thoại xoá → 404 ngay (P22); `purged_at` → `available:false` +
// `/content` 404; file mất → 404/500 + log; `Range` bỏ qua; `.txt` chứa `<script>` vẫn tải về dạng `text/plain`.
// Hàng + nội dung chèn thẳng (SQL owner + `<dir>/<tenant>/<id>`) ở A31–A37 để ca chỉ phụ thuộc route đọc.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { rm } from "node:fs/promises";
import { AttachmentDetailSchema } from "@ai/contracts/chat";
import { contentDisposition } from "../../../apps/hub-api/src/modules/attachments/attachment.rules";
import {
  call,
  type Json,
  type Keys,
  makeKeys,
  type Sql,
  sign,
  USERS,
  type UserKey,
  waitFor,
} from "../H1/_fixtures";
import { insertConv, insertFlow } from "../H1/_hub";
import { captureLogs, type LogLine } from "../H2b/_h2b";
import {
  codeOf,
  type HubC,
  insertAttachmentRow,
  MiB,
  pathOf,
  sample,
  setupH2c,
  sha256,
  startHubH2c,
  upload,
  userMessages,
} from "./_h2c";

let sql: Sql;
let k: Keys;
let hub: HubC;
const tok: Partial<Record<UserKey, string>> = {};
let log: { lines: LogLine[]; restore: () => void };

beforeAll(async () => {
  sql = await setupH2c();
  k = await makeKeys();
  hub = await startHubH2c(k);
  for (const u of ["lan", "hoa", "an"] as const) tok[u] = await sign(k, USERS[u]);
}, 60_000);
beforeEach(() => {
  log = captureLogs();
});
afterEach(() => log.restore());
afterAll(async () => {
  await hub?.stop();
  await sql?.end();
});

/** GET thô (giữ byte thân). */
async function get(path: string, who: UserKey | null, headers: Record<string, string> = {}) {
  const h = new Headers(headers);
  if (who) h.set("authorization", `Bearer ${tok[who]}`);
  const res = await fetch(`${hub.base}${path}`, { headers: h });
  const buf = new Uint8Array(await res.arrayBuffer());
  let json: Json;
  try {
    json = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, buf, json };
}
/** Hàng + file của `lan` (mặc định PDF 4 KiB). */
const stored = (o: Parameters<typeof insertAttachmentRow>[1] = {}) =>
  insertAttachmentRow(sql, { content: sample.pdf(4096), dir: hub.dir, ...o });

describe("A30–A37 · xem lại file [H2c-R13 · HUB-FR-75 · AC-01 · AC-05]", () => {
  it("HUB-FR-44 · A30 · chủ: upload PDF 1 MiB → GET AttachmentDetail strict available:true; /content byte đúng (sha256) + đủ header R13 [AC-01 · H2c-R13]", async () => {
    const body = sample.pdf(MiB);
    const up = await upload(hub, tok.lan ?? "", body, "Hoá đơn tháng 9.pdf");
    expect(up.status).toBe(201);
    const id = up.json.id as string;
    const d = await get(`/attachments/${id}`, "lan");
    expect(d.status).toBe(200);
    expect(AttachmentDetailSchema.safeParse(d.json).success).toBe(true);
    expect(d.json).toMatchObject({ id, available: true, size: MiB, mime: "application/pdf" });
    const c = await get(`/attachments/${id}/content`, "lan");
    expect(c.status).toBe(200);
    expect(sha256(c.buf)).toBe(sha256(body));
    expect({
      type: c.headers.get("content-type"),
      len: c.headers.get("content-length"),
      disp: c.headers.get("content-disposition"),
      nosniff: c.headers.get("x-content-type-options"),
      csp: c.headers.get("content-security-policy"),
      cache: c.headers.get("cache-control"),
    }).toEqual({
      type: "application/pdf",
      len: String(MiB),
      disp: contentDisposition(up.json.filename),
      nosniff: "nosniff",
      csp: "default-src 'none'; sandbox",
      cache: "private, no-store",
    });
  });

  it("HUB-FR-75 · A31 · (đối chứng chủ 200) an (beta) / hoa (cùng tenant) GET + /content file của lan, uuid không tồn tại, :id không phải uuid → 404 NOT_FOUND, thân giống hệt [AC-05 · H2c-R13]", async () => {
    const a = await stored();
    expect((await get(`/attachments/${a.id}`, "lan")).status).toBe(200);
    expect((await get(`/attachments/${a.id}/content`, "lan")).status).toBe(200);
    const bodies: Json[] = [];
    for (const [path, who] of [
      [`/attachments/${a.id}`, "an"],
      [`/attachments/${a.id}/content`, "an"],
      [`/attachments/${a.id}`, "hoa"],
      [`/attachments/${a.id}/content`, "hoa"],
      [`/attachments/${crypto.randomUUID()}`, "lan"],
      [`/attachments/${crypto.randomUUID()}/content`, "lan"],
      ["/attachments/khong-phai-uuid", "lan"],
      ["/attachments/khong-phai-uuid/content", "lan"],
    ] as [string, UserKey][]) {
      const r = await get(path, who);
      expect({ path, who, ...codeOf(r) }).toEqual({ path, who, status: 404, code: "NOT_FOUND" });
      bodies.push(r.json?.error);
    }
    for (const b of bodies) expect(b).toEqual(bodies[0]);
  });

  it("HUB-FR-75 · A32 · không JWT → GET và /content 401 AUTH_EXPIRED (trước 404, PROTECTED_PREFIXES) [P17]", async () => {
    const a = await stored();
    for (const path of [`/attachments/${a.id}`, `/attachments/${a.id}/content`])
      expect({ path, ...codeOf(await get(path, null)) }).toEqual({
        path,
        status: 401,
        code: "AUTH_EXPIRED",
      });
  });

  it("HUB-FR-75 · A33 · file gắn vào hội thoại (đối chứng 200) → DELETE /conversations/:id → GET và /content 404 ngay (trước sweeper) [P22 · H2c-R13]", async () => {
    const conv = await insertConv(sql, "lan", crypto.randomUUID());
    const flow = await insertFlow(sql, "lan", conv, crypto.randomUUID(), {
      msgs: [{ role: "user", content: "có file" }],
    });
    const [m] = await userMessages(sql, flow);
    const a = await stored({
      bind: { messageId: m?.id ?? "", conversationId: conv, flowId: flow, position: 0 },
    });
    expect((await get(`/attachments/${a.id}`, "lan")).status).toBe(200);
    const del = await call(hub, "DELETE", `/conversations/${conv}`, { token: tok.lan });
    expect(del.status).toBeLessThan(300);
    for (const path of [`/attachments/${a.id}`, `/attachments/${a.id}/content`])
      expect({ path, ...codeOf(await get(path, "lan")) }).toEqual({
        path,
        status: 404,
        code: "NOT_FOUND",
      });
  });

  it("HUB-FR-44 · A34 · purged_at đặt (SQL) → GET available:false; /content 404 [H2c-R13 · L9]", async () => {
    const a = await stored({ purged: true });
    const d = await get(`/attachments/${a.id}`, "lan");
    expect({ status: d.status, available: d.json?.available }).toEqual({
      status: 200,
      available: false,
    });
    expect(AttachmentDetailSchema.safeParse(d.json).success).toBe(true);
    expect(codeOf(await get(`/attachments/${a.id}/content`, "lan"))).toEqual({
      status: 404,
      code: "NOT_FOUND",
    });
  });

  it("HUB-FR-44 · A35 · hàng còn, file trên đĩa bị xoá tay → /content 404 (hoặc 500) + log error attachment-content-missing{attachment_id}; không lộ đường dẫn [plan-errors §5]", async () => {
    const a = await stored();
    expect((await get(`/attachments/${a.id}/content`, "lan")).status).toBe(200);
    await rm(pathOf(hub.dir, a.key));
    const r = await get(`/attachments/${a.id}/content`, "lan");
    expect([404, 500]).toContain(r.status);
    const text = new TextDecoder().decode(r.buf);
    expect(text).not.toContain(hub.dir);
    expect(text).not.toContain(a.key);
    const miss = await waitFor(
      async () => log.lines.filter((l) => l.rec.msg === "attachment-content-missing"),
      (xs) => xs.length > 0,
      2_000,
    );
    expect(miss[0]?.level).toBe("error");
    expect(miss[0]?.rec).toMatchObject({ attachment_id: a.id });
    expect(JSON.stringify(miss[0]?.rec ?? {})).not.toContain(hub.dir);
  });

  it("HUB-FR-44 · A36 · Range: bytes=0-9 → 200 toàn bộ, không Content-Range [H2c-R13]", async () => {
    const body = sample.pdf(4096);
    const a = await stored({ content: body });
    const r = await get(`/attachments/${a.id}/content`, "lan", { Range: "bytes=0-9" });
    expect({ status: r.status, range: r.headers.get("content-range"), len: r.buf.length }).toEqual({
      status: 200,
      range: null,
      len: body.length,
    });
  });

  it("HUB-FR-44 · A37 · .html/.svg không tải lên được (415); .txt chứa <script> → /content text/plain + nosniff + attachment + CSP sandbox [H2c-R13 · R03]", async () => {
    const enc = new TextEncoder();
    for (const name of ["x.html", "x.svg"])
      expect({
        name,
        ...codeOf(await upload(hub, tok.lan ?? "", enc.encode("<b>x</b>"), name)),
      }).toEqual({ name, status: 415, code: "ATTACHMENT_TYPE_NOT_ALLOWED" });
    const a = await stored({
      content: enc.encode("<script>alert(1)</script>\n"),
      mime: "text/plain",
      filename: "script.txt",
    });
    const r = await get(`/attachments/${a.id}/content`, "lan");
    expect({
      status: r.status,
      type: r.headers.get("content-type"),
      nosniff: r.headers.get("x-content-type-options"),
      attachment: (r.headers.get("content-disposition") ?? "").startsWith("attachment;"),
      csp: r.headers.get("content-security-policy"),
    }).toEqual({
      status: 200,
      type: "text/plain",
      nosniff: "nosniff",
      attachment: true,
      csp: "default-src 'none'; sandbox",
    });
  });
});
