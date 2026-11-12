// SEC 2026-11-12 · CR-127 E4 · int (DB thật, role `hub_api`, migration 0140): `hub.record_evidence` chỉ nhận tệp / chữ ký do CHÍNH
// người ghi tải lên — A gắn attachment của B (cùng công ty, UUID lộ) ⇒ 42501, không ghi; tệp của A ⇒ ghi được.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withHubScope } from "@ai/db/hub-scope";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { sql } from "drizzle-orm";
import { connectDb, type Db } from "../../../lib/db";
import { type ClaimWorld, claimWorld, groupTask } from "../testing/claim-seed";

let o: Sql;
let db: Db;
let w: ClaimWorld;

async function attachment(owner: string, mime = "application/pdf"): Promise<string> {
  const id = crypto.randomUUID();
  await o.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`insert into hub.attachments (id, tenant_id, user_id, origin, filename, safe_name, mime, size, sha256, storage_key)
      values (${id}, ${w.T}, ${owner}, 'upload', 'f', 'f', ${mime}, 1000, ${"a".repeat(64)}, ${`${w.T}/${id}`})`;
  });
  return id;
}
const record = (userId: string, taskId: string, sig: string | null, files: string[]) =>
  withHubScope(db, { kind: "user", userId, tenantId: w.T }, async (tx) => {
    const [r] = await tx.execute<{
      id: string;
    }>(sql`select hub.record_evidence('task_decision', ${taskId}::uuid,
      'ý kiến', ${sig}::uuid, ${`{${files.join(",")}}`}::uuid[], null::uuid)::text as id`);
    return r?.id;
  });
const pgCode = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    const x = e as { code?: string; cause?: { code?: string } };
    return x.cause?.code ?? x.code;
  }
};

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  w = await claimWorld(o, 1278);
  db = connectDb(urls().hubApi, 4);
}, 300_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("SEC · bằng chứng chỉ gắn tệp của chính người ghi", () => {
  it("A gắn tệp / chữ ký của B ⇒ 42501, không ghi; tệp của A ⇒ ghi được", async () => {
    const { taskId } = await groupTask(o, w, w.G);
    const bFile = await attachment(w.B);
    const bSig = await attachment(w.B, "image/png");
    expect(await pgCode(record(w.A, taskId, null, [bFile]))).toBe("42501");
    expect(await pgCode(record(w.A, taskId, bSig, []))).toBe("42501");
    const [n] = await o<
      { n: number }[]
    >`select count(*)::int as n from hub.evidence where subject_id = ${taskId}`;
    expect(n?.n).toBe(0);
    const aFile = await attachment(w.A);
    expect(await record(w.A, taskId, null, [aFile])).toBeTruthy();
  });
});
