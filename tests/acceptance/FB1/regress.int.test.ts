// HUB-FR-44 · HUB-FR-138 · FB1-AC-03 · spec §1, §3.2, §3.4: hồi quy driver `local` sau FB1 — upload ghi đĩa `<dir>/<tenant>/<id>`, hàng có
// `filebox_file_id/version_id` = NULL (cột mới tồn tại nhưng không dùng), `/content` vẫn 200 (và 206 với Range) thay vì 302, metadata không đổi;
// không có lời gọi nào ra FileBox. Toàn bộ bộ H2c / X2b2 cũ phải xanh nguyên văn (kiểm ở chế độ VERIFY: `bun test tests/acceptance/H2c tests/acceptance/X2b2`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { AttachmentDetailSchema, AttachmentSchema } from "@ai/contracts/chat";
import { type Keys, makeKeys, type Sql, sign, USERS } from "../H1/_fixtures";
import {
  diskFiles,
  type HubC,
  KEY_RE,
  KiB,
  sample,
  setupH2c,
  sha256,
  startHubH2c,
  upload,
} from "../H2c/_h2c";
import { type FbFake, fbRow, hasFbSchema, startFbFake } from "./_fb1";

let sql: Sql;
let k: Keys;
let hub: HubC;
let fake: FbFake;
let lan = "";

beforeAll(async () => {
  sql = await setupH2c();
  k = await makeKeys();
  hub = await startHubH2c(k);
  fake = startFbFake();
  lan = await sign(k, USERS.lan);
}, 60_000);
afterAll(async () => {
  await hub?.stop();
  await fake?.close();
  await sql?.end();
});

describe("FB1-AC-03 · driver local không đổi [HUB-FR-44]", () => {
  it("HUB-FR-44 · FB1-AC-03 · l1 · driver local: upload 201 → file trên đĩa tenant/id, cột filebox_file_id/version_id = NULL (key tồn tại), storage_key khớp tenant/id, Attachment hợp contract", async () => {
    expect(await hasFbSchema(sql)).toBe(true);
    expect(hub.storage?.driver).toBe("local");
    const body = sample.pdf(3 * KiB);
    const r = await upload(hub, lan, body, "local.pdf");
    expect(r.status).toBe(201);
    expect(AttachmentSchema.safeParse(r.json).success).toBe(true);
    const row = await fbRow(sql, r.json.id);
    expect(row?.filebox_file_id).toBeNull();
    expect(row?.filebox_version_id).toBeNull();
    expect(row?.storage_key).toMatch(KEY_RE);
    expect(row?.sha256).toBe(sha256(body));
    expect(await diskFiles(hub.dir)).toEqual([row?.storage_key]);
  });

  it("HUB-FR-44 · FB1-AC-03 · l2 · driver local: GET /content → 200 byte đúng (không 302), Range bị bỏ qua (200); GET /attachments/:id vẫn AttachmentDetail", async () => {
    const body = sample.pdf(2 * KiB);
    const r = await upload(hub, lan, body, "local2.pdf");
    expect(r.status).toBe(201);
    const h = { authorization: `Bearer ${lan}` };
    const c = await fetch(`${hub.base}/attachments/${r.json.id}/content`, {
      headers: h,
      redirect: "manual",
    });
    expect(c.status).toBe(200);
    expect(c.headers.get("location")).toBeNull();
    expect(Buffer.from(await c.arrayBuffer()).equals(Buffer.from(body))).toBe(true);
    // H2c: Range bị bỏ qua ở driver local (200 đủ byte) — hành vi không đổi
    const p = await fetch(`${hub.base}/attachments/${r.json.id}/content`, {
      headers: { ...h, range: "bytes=0-9" },
      redirect: "manual",
    });
    expect(p.status).toBe(200);
    expect((await p.arrayBuffer()).byteLength).toBe(body.length);
    const d = await fetch(`${hub.base}/attachments/${r.json.id}`, { headers: h });
    expect(AttachmentDetailSchema.safeParse(await d.json()).success).toBe(true);
  });

  it("HUB-FR-44 · FB1-AC-03 · l3 · driver local không bao giờ gọi FileBox (mock giả không nhận lời gọi nào)", () => {
    expect(fake.calls).toEqual([]);
  });
});
