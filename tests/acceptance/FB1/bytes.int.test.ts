// HUB-FR-139 · HUB-FR-75 · HUB-FR-12 · HUB-BR-29 · FB1-AC-06 · spec §3.5, §4.3, §4.6: chỗ backend cần BYTES (không phải trình duyệt) đọc
// `GET /files/{id}/content` INLINE, không redirect, không gọi `/link`: (A) `storage.blob` / `uploadToDify` (lệnh `/hoadon` + file → MK
// `POST /v1/files/upload` nhận size/sha256 đúng); (B) `GET /internal/jobs/:job/attachments/:att` (CLI job) 200 byte + X-Content-SHA256;
// file mất phía FileBox ⇒ 404 (CLI) / `INTERNAL_ERROR`-không lộ (Dify); 5xx ⇒ retry GET; cách ly: job tenant khác ⇒ 401, không gọi FileBox.
// Hàng "filebox" dựng bằng: tạo như local (`fileJob`/`storedFile`) rồi chuyển nội dung sang FileBox giả + ghi cột `filebox_*`.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { CONTENT_SHA256_HEADER } from "@ai/contracts/hub-internal";
import { type Keys, makeKeys, type Sql, sign, USERS } from "../H1/_fixtures";
import { insertConv, runIdOf } from "../H1/_hub";
import { type Dify, startDify } from "../H2a/_h2a";
import { captureLogs, type LogLine, settleRuns } from "../H2b/_h2b";
import { KEY_RE, pathOf, sample, sendWith, setupH2c, sha256 } from "../H2c/_h2c";
import {
  difyUser,
  type FileJob,
  fileJob,
  internalGet,
  PDF,
  postOutput,
  storedFile,
  uploadsOf,
} from "../H2c/_h2c2";
import { type FbFake, fbRow, type HubFb, needFb, startFbFake, startHubFb } from "./_fb1";

let sql: Sql;
let k: Keys;
let fake: FbFake;
let hub: HubFb;
let dify: Dify;
let log: { lines: LogLine[]; restore: () => void };

beforeAll(async () => {
  dify = startDify();
  sql = await setupH2c({ catalogBaseUrl: dify.baseUrl });
  k = await makeKeys();
  fake = startFbFake();
  hub = await startHubFb(k, { fake });
}, 60_000);
beforeEach(() => {
  fake.reset();
  log = captureLogs();
});
afterEach(async () => {
  log.restore();
  await settleRuns(hub, sql, k);
});
afterAll(async () => {
  await hub?.stop();
  await fake?.close();
  await dify?.close();
  await sql?.end();
});

/** Chuyển nội dung các file của `j` từ đĩa local sang FileBox giả (+ cột filebox_*); trả file_id theo thứ tự. */
async function toFilebox(j: FileJob): Promise<string[]> {
  const ids: string[] = [];
  for (const f of j.files) {
    const p = fake.put(f.content, f.id);
    await sql`update hub.attachments set filebox_file_id = ${p.file_id}, filebox_version_id = ${p.version_id}
      where id = ${f.id}`;
    ids.push(p.file_id);
  }
  return ids;
}
/** File CHƯA GẮN (như sau POST /attachments 201) nhưng nội dung nằm ở FileBox giả. */
async function freeFb(name: string, content: Uint8Array) {
  const f = await storedFile(sql, hub, name, content);
  const p = fake.put(content, f.id);
  await sql`update hub.attachments set filebox_file_id = ${p.file_id}, filebox_version_id = ${p.version_id}
    where id = ${f.id}`;
  return { f, fileId: p.file_id };
}
const job = async (o: Parameters<typeof fileJob>[2] = {}) => {
  const j = await fileJob(sql, hub, {
    files: [{ name: "hoadon.pdf", content: sample.pdf(3000) }],
    ...o,
  });
  return { j, fileIds: await toFilebox(j) };
};

describe("FB1-AC-06 · (B) CLI job tải file qua endpoint nội bộ [HUB-FR-75]", () => {
  it("HUB-FR-139 · HUB-FR-75 · FB1-AC-06 · h1 · token job → 200 octet-stream, byte đúng, X-Content-SHA256 = cột, no-store; FileBox: có GET /content (Bearer), KHÔNG gọi /link (không redirect)", async () => {
    await needFb(sql, hub);
    const { j, fileIds } = await job();
    const f = j.files[0] as FileJob["files"][number];
    const r = await internalGet(hub, j.jobId, f.id, j.token);
    expect(r.status).toBe(200);
    expect(r.headers.get(CONTENT_SHA256_HEADER)).toBe(f.sha256);
    expect(r.headers.get("cache-control") ?? "").toContain("no-store");
    expect(r.headers.get("location")).toBeNull();
    expect(Buffer.from(r.bytes).equals(Buffer.from(f.content))).toBe(true);
    const c = fake.callsTo("content");
    expect(c.length).toBe(1);
    expect(c[0]).toMatchObject({ fileId: fileIds[0], auth: "ok", status: 200 });
    expect(fake.callsTo("link").length).toBe(0);
  });

  it("HUB-FR-75 · FB1-AC-06 · h2 · file đã mất phía FileBox (hàng còn) → 404 + log attachment-content-missing; không lộ file_id", async () => {
    await needFb(sql, hub);
    const { j, fileIds } = await job();
    fake.vanish(fileIds[0] ?? "");
    const f = j.files[0] as FileJob["files"][number];
    const r = await internalGet(hub, j.jobId, f.id, j.token);
    expect(r.status).toBe(404);
    expect(r.text).not.toContain(fileIds[0]);
    expect(log.lines.some((l) => l.rec.msg === "attachment-content-missing")).toBe(true);
  });

  it("HUB-FR-75 · FB1-AC-06 · h3 · hàng purged_at → 404 không gọi FileBox", async () => {
    await needFb(sql, hub);
    const { j } = await job();
    const f = j.files[0] as FileJob["files"][number];
    await sql`update hub.attachments set purged_at = now() where id = ${f.id}`;
    const r = await internalGet(hub, j.jobId, f.id, j.token);
    expect(r.status).toBe(404);
    expect(fake.calls).toEqual([]);
  });

  it("HUB-FR-139 · FB1-AC-06 · h4 · GET /content 5xx hai lần rồi OK → vẫn 200 (retry GET idempotent): 3 call", async () => {
    await needFb(sql, hub);
    const { j } = await job();
    const f = j.files[0] as FileJob["files"][number];
    fake.failNext("content", [502, 503]);
    const r = await internalGet(hub, j.jobId, f.id, j.token);
    expect(r.status).toBe(200);
    expect(fake.callsTo("content").map((c) => c.status)).toEqual([502, 503, 200]);
  });

  it("HUB-BR-29 · FB1-AC-05 · h5 · job tải file KHÔNG thuộc payload (tenant khác / ngoài payload) → 401, FileBox không bị gọi", async () => {
    await needFb(sql, hub);
    const { j } = await job();
    const { j: other } = await job({ who: "an" });
    const foreign = other.files[0] as FileJob["files"][number];
    const r = await internalGet(hub, j.jobId, foreign.id, j.token);
    expect(r.status).toBe(401);
    expect(fake.calls).toEqual([]);
  });
});

describe("FB1-AC-06 · (A) uploadToDify + storage.blob đọc inline [HUB-FR-12]", () => {
  it("HUB-FR-139 · HUB-FR-12 · FB1-AC-06 · i1 · /hoadon + file filebox → MK POST /v1/files/upload nhận size/sha256 của byte lấy từ FileBox; FileBox: GET /content, không /link; run finished", async () => {
    await needFb(sql, hub);
    dify.mock.reset();
    const body = sample.pdf(2048);
    const { f } = await freeFb("hoadon-fb.pdf", body);
    const conv = await insertConv(sql, "lan", crypto.randomUUID());
    const s = await sendWith(hub, await sign(k, USERS.lan), conv, "/hoadon ghi chú", [f.id]);
    try {
      await s.terminal(10_000);
    } finally {
      s.close();
    }
    expect(s.status).toBe(200);
    expect(
      s.events.find((e) => e.event === "run.finished" || e.event === "run.failed")?.event,
    ).toBe("run.finished");
    expect(runIdOf(s)).toBeTruthy();
    const ups = uploadsOf(dify, "hoadon-fb.pdf");
    expect(ups.length).toBe(1);
    expect(ups[0]?.body).toEqual({
      user: difyUser("lan"),
      file: { name: "hoadon-fb.pdf", type: PDF, size: body.length, sha256: sha256(body) },
    });
    expect(fake.callsTo("content").length).toBeGreaterThanOrEqual(1);
    expect(fake.callsTo("link").length).toBe(0);
  });

  it("HUB-FR-139 · FB1-AC-06 · i3 · /hoadon + file filebox đã MẤT phía FileBox → run.failed code INTERNAL_ERROR (đồng nhất RV-8/local); Dify không nhận upload; không lộ file_id", async () => {
    await needFb(sql, hub);
    dify.mock.reset();
    const { f, fileId } = await freeFb("mat-fb.pdf", sample.pdf(1024));
    fake.vanish(fileId);
    const conv = await insertConv(sql, "lan", crypto.randomUUID());
    const s = await sendWith(hub, await sign(k, USERS.lan), conv, "/hoadon ghi chú", [f.id]);
    try {
      await s.terminal(10_000);
    } finally {
      s.close();
    }
    const end = s.events.find((e) => e.event === "run.finished" || e.event === "run.failed");
    expect({ ev: end?.event, code: end?.data?.code }).toEqual({
      ev: "run.failed",
      code: "INTERNAL_ERROR",
    });
    expect(JSON.stringify(end?.data)).not.toContain(fileId);
    expect(uploadsOf(dify, "mat-fb.pdf").length).toBe(0);
  });

  it("HUB-FR-139 · FB1-AC-06 · i2 · storage.blob(fb/<file_id>, type) → Blob byte đúng + type; file lạ → null (content-missing); storage.open → stream cùng byte", async () => {
    await needFb(sql, hub);
    const body = sample.pdf(1500);
    const p = fake.put(body);
    const st = hub.storage;
    expect(String(st?.driver)).toBe("filebox");
    const b = await st?.blob(`fb/${p.file_id}`, PDF);
    expect(b?.type).toBe(PDF);
    expect(Buffer.from(await (b as Blob).arrayBuffer()).equals(Buffer.from(body))).toBe(true);
    const o = await st?.open(`fb/${p.file_id}`);
    expect(o?.size).toBe(body.length);
    expect(await st?.blob("fb/khong-ton-tai", PDF)).toBeNull();
    expect(fake.callsTo("link").length).toBe(0);
  });
});

describe("FB1-AC-01 · (C) output do job ghi → stage lên FileBox [HUB-FR-138 · §3.5]", () => {
  it("HUB-FR-138 · FB1-AC-01 · o1 · POST /internal/jobs/:job/outputs report.md → 201; đúng 1 POST /files; hàng origin='output' có filebox_file_id khớp FileBox, storage_key tenant/id; đĩa local không có file", async () => {
    await needFb(sql, hub);
    const j = await fileJob(sql, hub, { files: [] });
    const body = new TextEncoder().encode("# Báo cáo\n\nNội dung kết quả job.\n");
    const before = new Set(fake.ids());
    const r = await postOutput(hub, j.jobId, j.token, "report.md", body);
    expect(r.status).toBe(201);
    const posts = fake.callsTo("post");
    expect(posts.length).toBe(1);
    expect(posts[0]).toMatchObject({ org: "ai-system", auth: "ok", bytes: body.length });
    const row = await fbRow(sql, r.json.id);
    expect(row?.origin).toBe("output");
    expect(before.has(String(row?.filebox_file_id))).toBe(false);
    expect(fake.has(String(row?.filebox_file_id))).toBe(true);
    expect(String(row?.storage_key)).toMatch(KEY_RE);
    // Không ghi nội dung ra kho local (độc lập với file do ca khác để lại ở hub.dir).
    expect(await Bun.file(pathOf(hub.dir, String(row?.storage_key))).exists()).toBe(false);
  });
});
