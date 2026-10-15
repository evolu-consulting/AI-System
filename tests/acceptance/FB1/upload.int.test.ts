// HUB-FR-138 · HUB-FR-140 · HUB-FR-142 · FB1-AC-01 · AC-02 · AC-08 · AC-11 (vế POST) · spec §3.1, §4.2, §4.5, §4.6: `POST /attachments` khi
// kho = driver FileBox (giả): upload 1 request `POST /files?org=ai-system&name=<id>`, hàng DB có `filebox_file_id/version_id`,
// `storage_key` vẫn `tenant/id`, response không lộ file_id/version; INSERT lỗi (hạn mức) ⇒ DELETE hoàn tác (không mồ côi);
// token vắng ⇒ 500 + `filebox-token-missing` + KHÔNG gọi FileBox; POST 5xx ⇒ không retry; 401 ⇒ làm mới token một lần; 413 ⇒ map.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { AttachmentSchema } from "@ai/contracts/chat";
import { type Keys, makeKeys, type Sql, sign, USERS } from "../H1/_fixtures";
import { captureLogs, type LogLine } from "../H2b/_h2b";
import {
  codeOf,
  diskFiles,
  insertAttachmentRow,
  KEY_RE,
  KiB,
  sample,
  setupH2c,
  sha256,
  upload,
} from "../H2c/_h2c";
import {
  type FbFake,
  fakeTokens,
  fbRow,
  type HubFb,
  needFb,
  startFbFake,
  startHubFb,
} from "./_fb1";

let sql: Sql;
let k: Keys;
let fake: FbFake;
let hub: HubFb;
let quota: HubFb;
let lan = "";
let log: { lines: LogLine[]; restore: () => void };

beforeAll(async () => {
  sql = await setupH2c();
  k = await makeKeys();
  fake = startFbFake();
  hub = await startHubFb(k, { fake });
  quota = await startHubFb(k, {
    fake,
    tenantMaxBytes: 1024 * KiB,
    extra: { instanceId: "qc-hub-fb1-quota" },
  });
  lan = await sign(k, USERS.lan);
}, 60_000);
beforeEach(async () => {
  fake.reset();
  for (const id of fake.ids()) fake.vanish(id);
  await sql`delete from hub.attachments`;
  log = captureLogs();
});
afterEach(() => log.restore());
afterAll(async () => {
  await hub?.stop();
  await quota?.stop();
  await fake?.close();
  await sql?.end();
});

describe("FB1-AC-01 · upload → FileBox [HUB-FR-138]", () => {
  it("HUB-FR-138 · FB1-AC-01 · a1 · driver filebox: POST /attachments PDF 4 KiB → 201; đúng 1 POST /files?org=ai-system&name=<id> có Bearer + byte; hàng có filebox_file_id/version_id khớp FileBox; storage_key = tenant/id", async () => {
    await needFb(sql, hub);
    const body = sample.pdf(4 * KiB);
    const r = await upload(hub, lan, body, "hoadon.pdf");
    expect(r.status).toBe(201);
    const posts = fake.callsTo("post");
    expect(posts.length).toBe(1);
    expect(posts[0]).toMatchObject({
      org: "ai-system",
      name: r.json.id,
      auth: "ok",
      bytes: body.length,
      status: 201,
    });
    const row = await fbRow(sql, r.json.id);
    expect(fake.ids().length).toBe(1);
    expect(row?.filebox_file_id).toBe(fake.ids()[0]);
    expect(typeof row?.filebox_version_id).toBe("string");
    expect(row?.storage_key).toMatch(KEY_RE);
    expect(row?.sha256).toBe(sha256(body));
    expect(Buffer.from(fake.bytesOf(row?.filebox_file_id) ?? []).equals(Buffer.from(body))).toBe(
      true,
    );
  });

  it("HUB-FR-138 · FB1-AC-01 · a2 · response là Attachment hợp contract (strict) và KHÔNG chứa file_id / version / filebox (D9)", async () => {
    await needFb(sql, hub);
    const r = await upload(hub, lan, sample.pdf(2 * KiB), "khong-lo.pdf");
    expect(r.status).toBe(201);
    expect(AttachmentSchema.safeParse(r.json).success).toBe(true);
    const row = await fbRow(sql, r.json.id);
    expect(r.text).not.toContain(String(row?.filebox_file_id));
    expect(r.text).not.toContain(String(row?.filebox_version_id));
    expect(r.text.toLowerCase()).not.toContain("filebox");
  });

  it("HUB-FR-138 · FB1-AC-01 · a3 · upload chunked (không Content-Length) vẫn 1 POST, byte đủ; thư mục kho local không có file nội dung", async () => {
    await needFb(sql, hub);
    const body = sample.pdf(300 * KiB);
    const r = await upload(hub, lan, body, "chunked.pdf", { chunked: true });
    expect(r.status).toBe(201);
    expect(fake.callsTo("post").length).toBe(1);
    const row = await fbRow(sql, r.json.id);
    expect(fake.bytesOf(row?.filebox_file_id)?.length).toBe(body.length);
    expect(await diskFiles(hub.dir)).toEqual([]);
  });

  it("HUB-FR-138 · FB1-AC-01 · a4 · nội dung bị từ chối bởi FileInspector (415) ⇒ KHÔNG gọi FileBox, 0 hàng", async () => {
    await needFb(sql, hub);
    const r = await upload(
      hub,
      lan,
      new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 1, 2, 3]),
      "virus.pdf",
    );
    expect(codeOf(r).status).toBe(415);
    expect(fake.calls.filter((c) => c.route === "post").length).toBe(0);
    const [n] = await sql<{ n: number }[]>`select count(*)::int as n from hub.attachments`;
    expect(n?.n).toBe(0);
  });
});

describe("FB1-AC-02 · INSERT lỗi sau upload ⇒ DELETE hoàn tác [HUB-FR-138 · §4.2]", () => {
  it("HUB-FR-138 · FB1-AC-02 · b1 · đã dùng 900 KiB, upload chunked 200 KiB (vượt hạn mức dưới khoá) → 409 ATTACHMENT_QUOTA_EXCEEDED; có POST rồi DELETE đúng file_id đó; FileBox rỗng; không có hàng mới", async () => {
    await needFb(sql, quota);
    await insertAttachmentRow(sql, { who: "lan", size: 900 * KiB });
    const r = await upload(quota, lan, sample.pdf(200 * KiB), "chot.pdf", { chunked: true });
    expect(codeOf(r)).toEqual({ status: 409, code: "ATTACHMENT_QUOTA_EXCEEDED" });
    const posts = fake.callsTo("post");
    const dels = fake.callsTo("delete");
    expect(posts.length).toBe(1);
    expect(dels.length).toBe(1);
    expect(dels[0]).toMatchObject({ status: 204, auth: "ok" });
    expect(fake.ids()).toEqual([]);
    const [n] = await sql<{ n: number }[]>`select count(*)::int as n from hub.attachments`;
    expect(n?.n).toBe(1);
  });

  it("HUB-FR-138 · FB1-AC-02 · b2 · DELETE hoàn tác gặp 404 (đã mất) vẫn trả 409 đúng mã, không 500 (discard idempotent)", async () => {
    await needFb(sql, quota);
    await insertAttachmentRow(sql, { who: "lan", size: 900 * KiB });
    fake.failNext("delete", [404]);
    const r = await upload(quota, lan, sample.pdf(200 * KiB), "chot2.pdf", { chunked: true });
    expect(codeOf(r)).toEqual({ status: 409, code: "ATTACHMENT_QUOTA_EXCEEDED" });
    expect(fake.callsTo("delete").length).toBeGreaterThanOrEqual(1);
  });
});

describe("FB1-AC-08 · token vắng ⇒ fail-closed [HUB-FR-140 · §4.5]", () => {
  it("HUB-FR-140 · FB1-AC-08 · c1 · nguồn token trả null → upload 500 INTERNAL_ERROR + log filebox-token-missing; FileBox KHÔNG nhận lời gọi nào; 0 hàng", async () => {
    await needFb(sql);
    const t = fakeTokens(null);
    const h = await startHubFb(k, { fake, tokens: t, extra: { instanceId: "qc-hub-fb1-notoken" } });
    try {
      await needFb(sql, h);
      const r = await upload(h, lan, sample.pdf(KiB), "khong-token.pdf");
      expect(codeOf(r)).toEqual({ status: 500, code: "INTERNAL_ERROR" });
      expect(log.lines.some((l) => l.rec.msg === "filebox-token-missing")).toBe(true);
      expect(fake.calls).toEqual([]);
      const [n] = await sql<{ n: number }[]>`select count(*)::int as n from hub.attachments`;
      expect(n?.n).toBe(0);
    } finally {
      await h.stop();
    }
  });

  it("HUB-FR-140 · FB1-AC-08 · c2 · thông điệp lỗi/log không chứa giá trị token", async () => {
    await needFb(sql, hub);
    fake.failAlways("post", 401);
    const r = await upload(hub, lan, sample.pdf(KiB), "401.pdf");
    fake.failAlways("post", null);
    expect(r.text).not.toContain(fake.token);
    expect(JSON.stringify(log.lines)).not.toContain(fake.token);
  });
});

describe("FB1-AC-11 · POST không retry; 401 làm mới một lần [HUB-FR-138 · §4.6]", () => {
  it("HUB-FR-138 · FB1-AC-11 · d1 · POST /files trả 500 → upload 500 INTERNAL_ERROR; đúng MỘT call POST (không auto-retry); 0 hàng; FileBox rỗng", async () => {
    await needFb(sql, hub);
    fake.failNext("post", [500]);
    const r = await upload(hub, lan, sample.pdf(KiB), "post500.pdf");
    expect(codeOf(r)).toEqual({ status: 500, code: "INTERNAL_ERROR" });
    expect(fake.callsTo("post").length).toBe(1);
    expect(fake.ids()).toEqual([]);
    const [n] = await sql<{ n: number }[]>`select count(*)::int as n from hub.attachments`;
    expect(n?.n).toBe(0);
  });

  it("HUB-FR-140 · FB1-AC-11 · d2 · FileBox 401 (token xoay) → làm mới token ĐÚNG 1 lần rồi thử lại → 201; 2 call POST (call đầu 401)", async () => {
    await needFb(sql, hub);
    const rotated = "fb-rotated-token-Qw8Er5Ty";
    const t = fakeTokens("fb-stale-token", rotated);
    const h = await startHubFb(k, { fake, tokens: t, extra: { instanceId: "qc-hub-fb1-rot" } });
    try {
      fake.setToken(rotated);
      const r = await upload(h, lan, sample.pdf(KiB), "xoay.pdf");
      expect(r.status).toBe(201);
      expect(fake.callsTo("post").map((c) => c.status)).toEqual([401, 201]);
      expect(t.refreshes).toBe(1);
    } finally {
      fake.setToken("fb-test-token-Zx9Pq7Lm");
      await h.stop();
    }
  });

  it("HUB-FR-140 · FB1-AC-11 · d3 · làm mới xong vẫn 401 → fail-closed 500; chỉ 1 lần làm mới (không lặp vô hạn); 0 hàng", async () => {
    await needFb(sql, hub);
    const t = fakeTokens("fb-bad-1", "fb-bad-2");
    const h = await startHubFb(k, { fake, tokens: t, extra: { instanceId: "qc-hub-fb1-bad" } });
    try {
      const r = await upload(h, lan, sample.pdf(KiB), "401x2.pdf");
      expect(codeOf(r)).toEqual({ status: 500, code: "INTERNAL_ERROR" });
      expect(t.refreshes).toBe(1);
      expect(fake.callsTo("post").length).toBe(2);
      expect(fake.ids()).toEqual([]);
    } finally {
      await h.stop();
    }
  });

  it("HUB-FR-138 · FB1-AC-11 · d4 · FileBox 413 khi POST → ATTACHMENT_TOO_LARGE (413); không để file mồ côi", async () => {
    await needFb(sql, hub);
    fake.setMaxBytes(1 * KiB);
    try {
      const r = await upload(hub, lan, sample.pdf(8 * KiB), "to.pdf");
      expect(codeOf(r)).toEqual({ status: 413, code: "ATTACHMENT_TOO_LARGE" });
      expect(fake.ids()).toEqual([]);
    } finally {
      fake.setMaxBytes(64 * 1024 * 1024);
    }
  });
});
