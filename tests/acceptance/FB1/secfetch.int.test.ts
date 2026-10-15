// HUB-FR-139 · FB1-AC-13 (ĐỀ XUẤT R-FE1, spec §5.3 — CHỈ có hiệu lực nếu Gate chấp nhận; bị loại khỏi LOCK nếu Gate bác): FE tải bằng
// `fetch` + Bearer nên `/content` phân nhánh theo `Sec-Fetch-Mode`: `navigate` (mở thẳng URL) ⇒ 302 tới link FileBox; `cors` / `same-origin`
// / header vắng (client không phải trình duyệt) ⇒ Hub đọc bytes `GET /files/{id}/content` và phát inline 200 (không 302, không gọi /link).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { type Keys, makeKeys, type Sql, sign, USERS } from "../H1/_fixtures";
import { sample, setupH2c } from "../H2c/_h2c";
import { type FbFake, type HubFb, insertFbRow, needFb, startFbFake, startHubFb } from "./_fb1";

let sql: Sql;
let k: Keys;
let fake: FbFake;
let hub: HubFb;
let lan = "";

beforeAll(async () => {
  sql = await setupH2c();
  k = await makeKeys();
  fake = startFbFake();
  hub = await startHubFb(k, { fake });
  lan = await sign(k, USERS.lan);
}, 60_000);
beforeEach(async () => {
  fake.reset();
  await sql`delete from hub.attachments`;
});
afterAll(async () => {
  await hub?.stop();
  await fake?.close();
  await sql?.end();
});

const BODY = () => sample.pdf(4096);
async function get(id: string, mode: string | null) {
  const h: Record<string, string> = { authorization: `Bearer ${lan}` };
  if (mode) h["sec-fetch-mode"] = mode;
  const res = await fetch(`${hub.base}/attachments/${id}/content`, {
    headers: h,
    redirect: "manual",
    keepalive: false,
  });
  return {
    status: res.status,
    location: res.headers.get("location"),
    bytes: new Uint8Array(await res.arrayBuffer()),
  };
}

describe("FB1-AC-13 · /content phân nhánh theo Sec-Fetch-Mode [HUB-FR-139 · R-FE1]", () => {
  it("HUB-FR-139 · FB1-AC-13 · n1 · Sec-Fetch-Mode: navigate → 302 tới FILEBOX_URL + /d/…; chỉ gọi /link", async () => {
    await needFb(sql, hub);
    const a = await insertFbRow(sql, fake, BODY());
    const r = await get(a.id, "navigate");
    expect(r.status).toBe(302);
    expect(r.location?.startsWith(`${fake.origin}/d/`)).toBe(true);
    expect(fake.callsTo("link").length).toBe(1);
    expect(fake.callsTo("content").length).toBe(0);
  });

  it("HUB-FR-139 · FB1-AC-13 · n2 · Sec-Fetch-Mode: cors và same-origin (fetch từ FE) → 200 bytes inline đúng; Hub đọc /files/{id}/content; không 302, không /link", async () => {
    await needFb(sql, hub);
    const a = await insertFbRow(sql, fake, BODY());
    for (const mode of ["cors", "same-origin"]) {
      fake.reset();
      const r = await get(a.id, mode);
      expect({ mode, status: r.status, location: r.location }).toEqual({
        mode,
        status: 200,
        location: null,
      });
      expect(Buffer.from(r.bytes).equals(Buffer.from(BODY()))).toBe(true);
      expect(fake.callsTo("content").length).toBe(1);
      expect(fake.callsTo("link").length).toBe(0);
    }
  });

  it("HUB-FR-139 · FB1-AC-13 · n3 · header vắng (client không phải trình duyệt) → 200 bytes inline", async () => {
    await needFb(sql, hub);
    const a = await insertFbRow(sql, fake, BODY());
    const r = await get(a.id, null);
    expect(r.status).toBe(200);
    expect(r.location).toBeNull();
    expect(Buffer.from(r.bytes).equals(Buffer.from(BODY()))).toBe(true);
    expect(fake.callsTo("link").length).toBe(0);
  });

  it("HUB-BR-29 · FB1-AC-13 · n4 · nhánh inline vẫn sau RLS: lan đọc file của an (tenant khác) với cors → 404, FileBox không bị gọi", async () => {
    await needFb(sql, hub);
    const a = await insertFbRow(sql, fake, BODY(), { who: "an" });
    const r = await get(a.id, "cors");
    expect(r.status).toBe(404);
    expect(fake.calls).toEqual([]);
  });
});
