// HUB-FR-75 · WRK-BR-06 · H2c-R17 · HUB-H2c-AC-07 (vế 401) · test-plan-int §2.9 A80–A89: `GET /internal/jobs/:job/attachments/:att`
// — token job (chỉ hash, job `agent.cli` `running`), `:job` = job của token, `att ∈ payload.attachments`, cùng tenant; mọi sai → 401
// `UNAUTHORIZED` một thân + `WWW-Authenticate: Bearer`; nội dung đã xoá/mất → 404; 200 byte + `X-Content-SHA256` + `no-store`.
// Job dựng SQL (`fileJob`: `insertSqlJob` H2a + `payload.attachments`), nội dung ghi thẳng `HUB_ATTACH_DIR` (không qua upload).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { unlink } from "node:fs/promises";
import { CONTENT_SHA256_HEADER } from "@ai/contracts/hub-internal";
import { type Keys, makeKeys, type Sql, sign, T, USERS } from "../H1/_fixtures";
import { AG } from "../H1/_hub";
import { type Dify, startDify, WF } from "../H2a/_h2a";
import { jobInRun } from "../H2a/_h2a2";
import { insertSqlJob } from "../H2a/_runtime2";
import { captureLogs } from "../H2b/_h2b";
import { type HubC, pathOf, sample, setupH2c, startHubH2c } from "./_h2c";
import {
  type BinRes,
  type FileJob,
  fileJob,
  internalGet,
  reclaim,
  storedFile,
  UNAUTHORIZED,
} from "./_h2c2";

let sql: Sql;
let k: Keys;
let hub: HubC;
let dify: Dify;

beforeAll(async () => {
  dify = startDify();
  sql = await setupH2c({ catalogBaseUrl: dify.baseUrl });
  k = await makeKeys();
  hub = await startHubH2c(k);
}, 60_000);
afterAll(async () => {
  await hub?.stop();
  await dify?.close();
  await sql?.end();
});

const job = (o: Parameters<typeof fileJob>[2] = {}): Promise<FileJob> =>
  fileJob(sql, hub, {
    files: [
      { name: "hoadon.pdf", content: sample.pdf(3000) },
      { name: "ghi-chu.md", content: sample.md(200), mime: "text/markdown" },
    ],
    ...o,
  });
const fileOf = (j: FileJob, i = 0) => j.files[i] as FileJob["files"][number];
/** 401 nội bộ đúng một thân (`plan-errors` §1). */
function expect401(r: BinRes, label: string): void {
  expect({ label, status: r.status, json: r.json }).toEqual({
    label,
    status: 401,
    json: UNAUTHORIZED,
  });
  expect(r.headers.get("www-authenticate") ?? "").toMatch(/^Bearer/);
}

describe("A80, A86 · tải file bằng token job [H2c-R17 · HUB-H2c-AC-07]", () => {
  it("HUB-FR-75 · A80 · job agent running + token → 200 octet-stream, Content-Length, X-Content-SHA256 = cột, Cache-Control no-store, byte đúng; log attachment-served{attachment_id, job_id} không token [H2c-R17 · WRK-BR-06]", async () => {
    const j = await job();
    const f = fileOf(j);
    const logs = captureLogs();
    let r: BinRes;
    try {
      r = await internalGet(hub, j.jobId, f.id, j.token);
    } finally {
      logs.restore();
    }
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type") ?? "").toContain("application/octet-stream");
    expect(r.headers.get("content-length")).toBe(String(f.size));
    expect(r.headers.get(CONTENT_SHA256_HEADER)).toBe(f.sha256);
    expect(r.headers.get("cache-control") ?? "").toContain("no-store");
    expect(Buffer.from(r.bytes).equals(Buffer.from(f.content))).toBe(true);
    const served = logs.lines.filter((l) => l.rec.msg === "attachment-served");
    expect(served.map((l) => [l.level, l.rec.attachment_id, l.rec.job_id])).toEqual([
      ["info", f.id, j.jobId],
    ]);
    expect(JSON.stringify(logs.lines)).not.toContain(j.token);
  });

  it("HUB-FR-75 · A86 · hai lần GET cùng file → cùng byte (đọc lại được, không tiêu thụ); file thứ hai của job cũng tải được [H2c-R17]", async () => {
    const j = await job();
    const a = await internalGet(hub, j.jobId, fileOf(j).id, j.token);
    const b = await internalGet(hub, j.jobId, fileOf(j).id, j.token);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
    const md = await internalGet(hub, j.jobId, fileOf(j, 1).id, j.token);
    expect(md.status).toBe(200);
    expect(md.headers.get(CONTENT_SHA256_HEADER)).toBe(fileOf(j, 1).sha256);
  });
});

describe("A81–A84, A89 · 401 một thân [H2c-R17 · HUB-H2c-AC-07 · T18]", () => {
  it("HUB-FR-75 · A81 · không header · token sai · token job khác (cùng run) · :job khác job của token · id ngoài payload.attachments (file cùng user tin khác) → 401 UNAUTHORIZED thân giống hệt + WWW-Authenticate: Bearer [H2c-R17 · HUB-H2c-AC-07]", async () => {
    const j = await job();
    const f = fileOf(j);
    // đối chứng: chính job/token/file → 200
    expect((await internalGet(hub, j.jobId, f.id, j.token)).status).toBe(200);
    const other = await job();
    const sibling = await jobInRun(sql, () => crypto.randomUUID(), j.runId, {
      agentId: AG.hoadon,
      agentKey: "hoadon",
      tools: [],
      mcpUrl: `${hub.base}/mcp`,
    });
    const outside = await storedFile(sql, hub, "khac.pdf", sample.pdf(500));
    const cases: [string, BinRes][] = [
      ["không header", await internalGet(hub, j.jobId, f.id, null)],
      ["token sai", await internalGet(hub, j.jobId, f.id, "khong-phai-token")],
      ["token job khác cùng run", await internalGet(hub, j.jobId, f.id, sibling.token)],
      ["token job khác", await internalGet(hub, j.jobId, f.id, other.token)],
      [":job khác job của token", await internalGet(hub, other.jobId, f.id, j.token)],
      ["id ngoài payload", await internalGet(hub, j.jobId, outside.id, j.token)],
    ];
    for (const [label, r] of cases) expect401(r, label);
    expect(new Set(cases.map(([, r]) => r.text)).size).toBe(1);
  });

  it("HUB-FR-75 · A82 · job succeeded / queued / cancelled → 401; job workflow.async có token → 401 [H2c-R17]", async () => {
    for (const status of ["succeeded", "queued", "cancelled"] as const) {
      const j = await job({ status });
      expect401(await internalGet(hub, j.jobId, fileOf(j).id, j.token), status);
    }
    const f = await storedFile(sql, hub, "async.pdf", sample.pdf(300));
    const w = await insertSqlJob(sql, () => crypto.randomUUID(), {
      type: "workflow.async",
      workflowId: WF.dich,
      workflowKey: "dich",
    });
    expect401(await internalGet(hub, w.jobId, f.id, w.token), "workflow.async");
    // đối chứng: job agent running → 200
    const live = await job();
    expect((await internalGet(hub, live.jobId, fileOf(live).id, live.token)).status).toBe(200);
  });

  it("HUB-FR-75 · A83 · lệch tenant: attachments.tenant_id ≠ jobs.tenant_id (id vẫn trong payload) → 401 [H2c-R17 · HUB-FR-75]", async () => {
    const j = await job();
    expect((await internalGet(hub, j.jobId, fileOf(j, 1).id, j.token)).status).toBe(200);
    await sql`update hub.attachments set tenant_id = ${T.beta} where id = ${fileOf(j).id}`;
    expect401(await internalGet(hub, j.jobId, fileOf(j).id, j.token), "lệch tenant");
  });

  it("HUB-FR-75 · A84 · không JWT/CORS: Origin lạ → không Access-Control-Allow-Origin; JWT user thay token → 401 [H2c-R17 · P16]", async () => {
    const j = await job();
    const f = fileOf(j);
    const cors = await internalGet(hub, j.jobId, f.id, j.token, { origin: "http://evil.example" });
    expect(cors.status).toBe(200);
    expect(cors.headers.get("access-control-allow-origin")).toBeNull();
    const jwt = await sign(k, USERS.lan);
    expect401(await internalGet(hub, j.jobId, f.id, jwt), "JWT user");
  });

  it("HUB-FR-75 · A89 · :att không phải uuid / uuid hoa → 401 (không lộ dạng) [H2c-R17]", async () => {
    const j = await job();
    expect((await internalGet(hub, j.jobId, fileOf(j).id, j.token)).status).toBe(200);
    for (const att of ["khong-phai-uuid", "1", fileOf(j).id.toUpperCase()])
      expect401(await internalGet(hub, j.jobId, att, j.token), att);
  });
});

describe("A85, A87, A88 · nội dung mất, requeue, log [H2c-R17 · PL10]", () => {
  it("HUB-FR-75 · A85 · purged_at → 404 NOT_FOUND; file mất trên đĩa → 404 + log error attachment-content-missing{attachment_id}, không lộ đường dẫn [H2c-R17 · R13]", async () => {
    const j = await job();
    const [a, b] = [fileOf(j), fileOf(j, 1)];
    expect((await internalGet(hub, j.jobId, a.id, j.token)).status).toBe(200);
    await sql`update hub.attachments set purged_at = now() where id = ${a.id}`;
    const purged = await internalGet(hub, j.jobId, a.id, j.token);
    expect({ status: purged.status, code: purged.json?.error?.code }).toEqual({
      status: 404,
      code: "NOT_FOUND",
    });
    await unlink(pathOf(hub.dir, `${USERS.lan.tid}/${b.id}`));
    const logs = captureLogs();
    let gone: BinRes;
    try {
      gone = await internalGet(hub, j.jobId, b.id, j.token);
    } finally {
      logs.restore();
    }
    expect({ status: gone.status, code: gone.json?.error?.code }).toEqual({
      status: 404,
      code: "NOT_FOUND",
    });
    expect(gone.text).not.toContain(hub.dir);
    const miss = logs.lines.filter((l) => l.rec.msg === "attachment-content-missing");
    expect(miss.map((l) => [l.level, l.rec.attachment_id])).toEqual([["error", b.id]]);
  });

  it("HUB-FR-75 · A87 · requeue (claim lại → token mới): token cũ → 401, token mới → 200 [H2c-R17 · F2]", async () => {
    const j = await job();
    expect((await internalGet(hub, j.jobId, fileOf(j).id, j.token)).status).toBe(200);
    const fresh = await reclaim(sql, j.jobId);
    expect401(await internalGet(hub, j.jobId, fileOf(j).id, j.token), "token cũ");
    expect((await internalGet(hub, j.jobId, fileOf(j).id, fresh)).status).toBe(200);
  });

  it("HUB-FR-75 · A88 · log của các ca 401/404 (A81–A85) không chứa token, không chứa Authorization [HUB-NFR-04 · H2c-R17]", async () => {
    const j = await job();
    const other = await job();
    const logs = captureLogs();
    const got: number[] = [];
    try {
      got.push((await internalGet(hub, j.jobId, fileOf(j).id, other.token)).status);
      got.push((await internalGet(hub, other.jobId, fileOf(j).id, j.token)).status);
      got.push((await internalGet(hub, j.jobId, "x", j.token)).status);
      await sql`update hub.attachments set purged_at = now() where id = ${fileOf(j, 1).id}`;
      got.push((await internalGet(hub, j.jobId, fileOf(j, 1).id, j.token)).status);
    } finally {
      logs.restore();
    }
    expect(got).toEqual([401, 401, 401, 404]);
    const dump = JSON.stringify(logs.lines);
    for (const t of [j.token, other.token]) expect(dump).not.toContain(t);
    expect(dump.toLowerCase()).not.toContain("authorization");
  });
});
