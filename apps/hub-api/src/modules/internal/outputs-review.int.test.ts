// WRK-FR-18 · H2c-R25 · P21 · spec-decisions "REVIEW 1 — Hub" RV-1, RV-2: `POST /internal/jobs/:job_id/outputs` — gửi lại
// cùng tên trong lần claim = thay (không chiếm suất); claim đổi (requeue) giữa lúc đọc thân ⇒ 401, 0 hàng, 0 `.part`.
// RV-3: sweeper — lỗi `list` kho không rollback phần đã xoá. Không dùng helper H2c (kiểu DOM ngoài tsconfig hub-api).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FILENAME_HEADER } from "@ai/contracts/chat";
import { type Keys, makeKeys, type Sql, USERS } from "../../../../../tests/acceptance/H1/_fixtures";
import type { HubX } from "../../../../../tests/acceptance/H1/_hub";
import { AG } from "../../../../../tests/acceptance/H1/_hub";
import {
  insertSqlJob,
  newJobToken,
  tokenHash,
} from "../../../../../tests/acceptance/H2a/_runtime2";
import { type H2bExtra, setupH2b, startHubH2b } from "../../../../../tests/acceptance/H2b/_h2b";
import type { logger } from "../../lib/logger";
import type { AttachmentStorage } from "../attachments/storage";
import { createLocalStorage } from "../attachments/storage.local";
import { sweepOnce } from "../attachments/sweeper";

let sql: Sql;
let k: Keys;
let hub: HubX;
let dir: string;
let storage: AttachmentStorage;

beforeAll(async () => {
  sql = await setupH2b();
  k = await makeKeys();
  dir = await mkdtemp(join(tmpdir(), "hub-rv1-"));
  storage = await createLocalStorage({ dir });
  // `attachments` ngoài `H2bExtra` (như `startHubH2c`): ép kiểu.
  const extra = {
    instanceId: "hub-rv1",
    attachments: { storage, tenantMaxBytes: 1_073_741_824, sweepS: 600, sweep: false },
  } as H2bExtra;
  hub = await startHubH2b(k, extra);
}, 60_000);
afterAll(async () => {
  await hub?.stop();
  await sql?.end();
  if (dir) await rm(dir, { recursive: true, force: true });
});

const md = (s: string) => new TextEncoder().encode(`# ${s}\n\nNội dung.\n`);

async function agentJob(): Promise<{ jobId: string; token: string }> {
  const j = await insertSqlJob(sql, () => crypto.randomUUID(), {
    type: "agent.cli",
    agentId: AG.hoadon,
    agentKey: "hoadon",
    mcpUrl: `${hub.base}/mcp`,
  });
  return { jobId: j.jobId, token: j.token };
}

const post = (jobId: string, token: string, name: string, body: Uint8Array | ReadableStream) =>
  fetch(`${hub.base}/internal/jobs/${jobId}/outputs`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/octet-stream",
      [FILENAME_HEADER]: encodeURIComponent(name),
    },
    body,
  });

type Row = { safe_name: string; live: boolean };
const rowsOf = async (jobId: string): Promise<Row[]> => [
  ...(await sql<Row[]>`select safe_name, purged_at is null as live from hub.attachments
    where job_id = ${jobId} order by created_at`),
];

async function partFiles(): Promise<string[]> {
  const out: string[] = [];
  for (const t of await readdir(dir))
    for (const f of await readdir(join(dir, t)).catch(() => [] as string[]))
      if (f.endsWith(".part")) out.push(f);
  return out;
}

describe("RV-2 · gửi lại cùng tên trong lần claim = thay", () => {
  it("5 tên → gửi lại o1.md ×2 (201, bản cũ purged) → tên thứ 6 vẫn 409; ≤ 1 hàng sống mỗi tên", async () => {
    const j = await agentJob();
    const got: number[] = [];
    const names = ["o1.md", "o2.md", "o3.md", "o4.md", "o5.md", "o1.md", "o1.md", "o6.md"];
    for (const n of names) {
      const r = await post(j.jobId, j.token, n, md(n));
      got.push(r.status);
      await r.text();
    }
    expect(got).toEqual([201, 201, 201, 201, 201, 201, 201, 409]);
    const rows = await rowsOf(j.jobId);
    expect(rows.filter((r) => r.live).map((r) => r.safe_name)).toEqual([
      "o2.md",
      "o3.md",
      "o4.md",
      "o5.md",
      "o1.md",
    ]);
    expect(rows.filter((r) => !r.live).map((r) => r.safe_name)).toEqual(["o1.md", "o1.md"]);
  });
});

describe("RV-1 · claim đổi giữa lúc đọc thân", () => {
  it("requeue (token mới) trước khi thân xong ⇒ 401 UNAUTHORIZED; 0 hàng, 0 .part", async () => {
    const j = await agentJob();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const body = new ReadableStream<Uint8Array>({
      async start(c) {
        c.enqueue(md("phần đầu"));
        await gate;
        c.enqueue(md("phần cuối"));
        c.close();
      },
    });
    const res = post(j.jobId, j.token, "late.md", body);
    await Bun.sleep(300);
    await sql`update hub.jobs set started_at = clock_timestamp(), attempts = attempts + 1,
      token_hash = ${tokenHash(newJobToken())} where id = ${j.jobId}`;
    release();
    const r = await res;
    expect(r.status).toBe(401);
    const err = (await r.json()) as { error: { code: string } };
    expect(err.error.code).toBe("UNAUTHORIZED");
    expect(await rowsOf(j.jobId)).toEqual([]);
    expect(await partFiles()).toEqual([]);
  });
});

describe("RV-3 · sweeper: list kho lỗi không rollback (a)/(b)", () => {
  it("list ném EACCES ⇒ warn attachment-sweep-orphans-failed, hàng hết hạn vẫn bị xoá (commit)", async () => {
    const u = USERS.lan;
    const id = crypto.randomUUID();
    await sql`insert into hub.attachments (id, tenant_id, user_id, origin, filename, safe_name, mime, size, sha256,
        storage_key, created_at)
      values (${id}, ${u.tid}, ${u.id}, 'upload', 'x.pdf', 'x.pdf', 'application/pdf', 10, ${"a".repeat(64)},
        ${`${u.tid}/${id}`}, now() - interval '25 hours')`;
    const failing: AttachmentStorage = {
      driver: storage.driver,
      stage: (key, b, o) => storage.stage(key, b, o),
      open: (key) => storage.open(key),
      blob: (key, type) => storage.blob(key, type),
      remove: (key) => storage.remove(key),
      promote: (key) => storage.promote(key),
      list: async () => {
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      },
    };
    const warns: string[] = [];
    const log = {
      info: () => {},
      error: () => {},
      warn: (msg: string, f?: object) => warns.push(`${msg} ${JSON.stringify(f)}`),
    } as unknown as typeof logger;
    const r = await sweepOnce({ db: hub.db, storage: failing, now: new Date(), log });
    expect(r.skipped).toBe(false);
    expect(r.expired).toBeGreaterThanOrEqual(1);
    expect((await sql`select id from hub.attachments where id = ${id}`).length).toBe(0);
    expect(warns).toContain('attachment-sweep-orphans-failed {"code":"EACCES"}');
  });
});
