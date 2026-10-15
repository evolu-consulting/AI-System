// HUB-FR-139 · HUB-BR-29 · FB1-AC-04 · AC-05 · spec §3.4, §4.1, §4.3: `GET /attachments/:id/content` khi kho = FileBox — chủ sở hữu ⇒
// 302 tới `FILEBOX_URL + /d/…` (lấy từ `/link`), không stream byte, không log URL đầy đủ, không lộ file_id; người không có quyền
// (khác user / khác tenant / không tồn tại / chưa đăng nhập) ⇒ 404/401 TRƯỚC khi phát link (FileBox không nhận lời gọi nào);
// `purged_at` ⇒ 404; FileBox 404 khi lấy link ⇒ 404 NOT_FOUND + log `attachment-content-missing`; metadata `GET /attachments/:id` giữ nguyên.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { AttachmentDetailSchema } from "@ai/contracts/chat";
import {
  type Json,
  type Keys,
  makeKeys,
  type Sql,
  sign,
  USERS,
  type UserKey,
  waitFor,
} from "../H1/_fixtures";
import { captureLogs, type LogLine } from "../H2b/_h2b";
import { codeOf, sample, setupH2c } from "../H2c/_h2c";
import { type FbFake, type HubFb, insertFbRow, needFb, startFbFake, startHubFb } from "./_fb1";

let sql: Sql;
let k: Keys;
let fake: FbFake;
let hub: HubFb;
const tok: Partial<Record<UserKey, string>> = {};
let log: { lines: LogLine[]; restore: () => void };

beforeAll(async () => {
  sql = await setupH2c();
  k = await makeKeys();
  fake = startFbFake();
  hub = await startHubFb(k, { fake });
  for (const u of ["lan", "hoa", "an"] as const) tok[u] = await sign(k, USERS[u]);
}, 60_000);
beforeEach(async () => {
  fake.reset();
  log = captureLogs();
  await sql`delete from hub.attachments`;
});
afterEach(() => log.restore());
afterAll(async () => {
  await hub?.stop();
  await fake?.close();
  await sql?.end();
});

/** GET không theo redirect (giữ nguyên 302). */
async function get(path: string, who: UserKey | null, headers: Record<string, string> = {}) {
  // Trình duyệt mở thẳng URL (navigate) — nhánh 302; không phụ thuộc nhánh Sec-Fetch-Mode=cors của R-FE1 (spec §5.3).
  const h = new Headers({ "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", ...headers });
  if (who) h.set("authorization", `Bearer ${tok[who]}`);
  const res = await fetch(`${hub.base}${path}`, {
    headers: h,
    redirect: "manual",
    keepalive: false,
  });
  const text = await res.text();
  let json: Json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, text, json };
}
const BODY = () => sample.pdf(4096);
const mine = async (o: Parameters<typeof insertFbRow>[3] = {}) => insertFbRow(sql, fake, BODY(), o);

describe("FB1-AC-04 · 302 redirect tới link FileBox [HUB-FR-139]", () => {
  it("HUB-FR-139 · FB1-AC-04 · e1 · chủ (lan) GET /content → 302, Location = FILEBOX_URL + /d/<opaque>; 1 call /link có Bearer; KHÔNG có call /content (không proxy byte)", async () => {
    await needFb(sql, hub);
    const a = await mine();
    const r = await get(`/attachments/${a.id}/content`, "lan");
    expect(r.status).toBe(302);
    const loc = r.headers.get("location") ?? "";
    expect(loc.startsWith(`${fake.origin}/d/`)).toBe(true);
    expect(fake.callsTo("link").length).toBe(1);
    expect(fake.callsTo("link")[0]).toMatchObject({ auth: "ok", fileId: a.fileId, status: 200 });
    expect(fake.callsTo("content").length).toBe(0);
  });

  it("HUB-FR-139 · FB1-AC-04 · e2 · Location không chứa file_id/version_id; thân 302 không chứa file_id; theo link tải được đúng byte", async () => {
    await needFb(sql, hub);
    const a = await mine();
    const r = await get(`/attachments/${a.id}/content`, "lan");
    const loc = r.headers.get("location") ?? "";
    expect(loc).not.toContain(a.fileId);
    expect(loc).not.toContain(a.versionId);
    expect(r.text).not.toContain(a.fileId);
    const dl = await fetch(loc);
    expect(dl.status).toBe(200);
    expect(Buffer.from(await dl.arrayBuffer()).equals(Buffer.from(BODY()))).toBe(true);
  });

  it("HUB-FR-139 · FB1-AC-04 · e3 · log không chứa URL /d/… đầy đủ (link = bí mật 10') và không chứa token", async () => {
    await needFb(sql, hub);
    const a = await mine();
    const r = await get(`/attachments/${a.id}/content`, "lan");
    const loc = r.headers.get("location") ?? "";
    const rand = loc.split("/d/")[1] ?? "unset-rand";
    const all = JSON.stringify(log.lines);
    expect(all).not.toContain(rand);
    expect(all).not.toContain(fake.token);
  });

  it("HUB-FR-139 · FB1-AC-04 · e4 · Range gửi tới Hub không làm Hub tự trả 206 (trình duyệt phát lại Range tới link): vẫn 302", async () => {
    await needFb(sql, hub);
    const a = await mine();
    const r = await get(`/attachments/${a.id}/content`, "lan", { range: "bytes=0-99" });
    expect(r.status).toBe(302);
    const part = await fetch(r.headers.get("location") ?? "", { headers: { range: "bytes=0-99" } });
    expect(part.status).toBe(206);
    expect((await part.arrayBuffer()).byteLength).toBe(100);
  });

  it("HUB-FR-139 · FB1-AC-04 · e5 · metadata GET /attachments/:id giữ nguyên (AttachmentDetail strict, không lộ file_id), không gọi FileBox", async () => {
    await needFb(sql, hub);
    const a = await mine();
    const r = await get(`/attachments/${a.id}`, "lan");
    expect(r.status).toBe(200);
    expect(AttachmentDetailSchema.safeParse(r.json).success).toBe(true);
    expect(r.text).not.toContain(a.fileId);
    expect(r.text.toLowerCase()).not.toContain("filebox");
    expect(fake.calls).toEqual([]);
  });
});

describe("FB1-AC-05 · RLS trước khi phát link [HUB-BR-29]", () => {
  it("HUB-FR-139 · HUB-BR-29 · FB1-AC-05 · f1 · khác user cùng tenant (hoa), khác tenant (an), uuid không tồn tại → 404 một thân giống hệt; FileBox KHÔNG nhận lời gọi nào", async () => {
    await needFb(sql, hub);
    const a = await mine();
    const none = "00000000-0000-4000-8000-0000000000aa";
    const rs = [
      await get(`/attachments/${a.id}/content`, "hoa"),
      await get(`/attachments/${a.id}/content`, "an"),
      await get(`/attachments/${none}/content`, "lan"),
    ];
    for (const r of rs) expect(codeOf(r)).toEqual({ status: 404, code: "NOT_FOUND" });
    expect(new Set(rs.map((r) => r.text)).size).toBe(1);
    expect(fake.calls).toEqual([]);
  });

  it("HUB-FR-139 · FB1-AC-05 · f2 · chưa đăng nhập → 401 trước 404; FileBox không bị gọi", async () => {
    await needFb(sql, hub);
    const a = await mine();
    const r = await get(`/attachments/${a.id}/content`, null);
    expect(r.status).toBe(401);
    expect(fake.calls).toEqual([]);
  });

  it("HUB-BR-29 · FB1-AC-05 · f3 · org FileBox dùng chung nhưng cách ly vẫn do Hub: file của tenant beta (an) — lan (acme) không tải được; an tải được → 302", async () => {
    await needFb(sql, hub);
    const b = await mine({ who: "an" });
    expect(codeOf(await get(`/attachments/${b.id}/content`, "lan"))).toEqual({
      status: 404,
      code: "NOT_FOUND",
    });
    expect(fake.callsTo("link").length).toBe(0);
    expect((await get(`/attachments/${b.id}/content`, "an")).status).toBe(302);
    expect(fake.callsTo("link").length).toBe(1);
  });

  it("HUB-FR-139 · FB1-AC-05 · f4 · purged_at → 404 không gọi FileBox", async () => {
    await needFb(sql, hub);
    const a = await mine({ purged: true });
    const r = await get(`/attachments/${a.id}/content`, "lan");
    expect(codeOf(r)).toEqual({ status: 404, code: "NOT_FOUND" });
    expect(fake.calls).toEqual([]);
  });
});

describe("FB1-AC-05/06 · lỗi phía FileBox [§4.6]", () => {
  it("HUB-FR-139 · FB1-AC-05 · g1 · hàng còn nhưng FileBox 404 khi lấy /link → 404 NOT_FOUND + log attachment-content-missing{attachment_id}; không lộ file_id", async () => {
    await needFb(sql, hub);
    const a = await mine();
    fake.vanish(a.fileId);
    const r = await get(`/attachments/${a.id}/content`, "lan");
    expect(codeOf(r)).toEqual({ status: 404, code: "NOT_FOUND" });
    expect(r.text).not.toContain(a.fileId);
    const miss = await waitFor(
      async () => log.lines.filter((l) => l.rec.msg === "attachment-content-missing"),
      (xs) => xs.length > 0,
      2_000,
    );
    expect(miss[0]?.rec).toMatchObject({ attachment_id: a.id });
  });

  it("HUB-FR-139 · FB1-AC-06 · g2 · /link 5xx → retry (GET idempotent) rồi thành công → vẫn 302", async () => {
    await needFb(sql, hub);
    const a = await mine();
    fake.failNext("link", [503, 503]);
    const r = await get(`/attachments/${a.id}/content`, "lan");
    expect(r.status).toBe(302);
    expect(fake.callsTo("link").map((c) => c.status)).toEqual([503, 503, 200]);
  });

  it("HUB-FR-139 · FB1-AC-06 · g3 · /link luôn 5xx → 500 INTERNAL_ERROR sau 4 call (1 + 3 retry); chat không bị chặn (route khác vẫn 200)", async () => {
    await needFb(sql, hub);
    const a = await mine();
    fake.failAlways("link", 503);
    try {
      const r = await get(`/attachments/${a.id}/content`, "lan");
      expect(codeOf(r)).toEqual({ status: 500, code: "INTERNAL_ERROR" });
      expect(fake.callsTo("link").length).toBe(4);
      expect((await get(`/attachments/${a.id}`, "lan")).status).toBe(200);
    } finally {
      fake.failAlways("link", null);
    }
  });
});
