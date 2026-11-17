// CR-181 · s10 · hồ sơ duyệt có hình chữ ký (DB thật, RLS gói): X2 người xem HĐ ngoài quy trình thấy hình chữ ký nhưng KHÔNG thấy ý kiến; sha256 bản cuối;
// duyệt thay; HĐ ký đủ ⇒ lưu PDF (một bản, chạy lại không nhân đôi) và route tải trả bản lưu cho người trong quy trình.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow } from "../../kit/adapters/pack-uow";
import {
  approvalRecord,
  approvalRecordArchive,
  approvalRecordPdf,
} from "../application/approval-record.usecase";
import { saveApprovalRecord } from "../approval-record-save.mount";
import { approvalEngineRepo } from "./approval-engine.repo";

let o: Sql;
let db: Db;
let T = "";
let U1 = "";
let U2 = "";
let C = "";
const SHA = `abcdef12${"0".repeat(56)}`;
const STAMP = crypto.randomUUID();
const stored = new Map<string, Uint8Array>();

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [T] = (await tenants(o, 1, 1810)) as [string];
  [U1, U2] = (await users(o, T, 2, { from: 1810 })) as [string, string];
  [C] = (await contracts(o, T, 1, { from: 1810, createdBy: U1, status: "done" })) as [string];
  const F = crypto.randomUUID();
  const OUT = crypto.randomUUID();
  for (const [id, name] of [
    [F, "hd.pdf"],
    [OUT, "hd-ky.pdf"],
  ] as const)
    await o`insert into contracts.files (id, tenant_id, org, file_id, version_id, name, mime, size_bytes, created_by)
      values (${id}, ${T}, ${`t_${T}`}, ${`f-${id}`}, ${`v-${id}`}, ${name}, 'application/pdf', 16, ${U1})`;
  await o`insert into contracts.sign_docs (tenant_id, contract_id, file_id, needs_sign, set_by) values (${T}, ${C}, ${F}, true, ${U1})`;
  const [v] =
    await o`insert into contracts.sign_versions (tenant_id, contract_id, file_id, seq, out_file_id, sha256, signed_by, signature_kind)
    values (${T}, ${C}, ${F}, 1, ${OUT}, ${SHA}, ${U1}, 'internal') returning id`;
  await o`insert into contracts.sign_marks (tenant_id, version_id, signer_id, placement, parts, user_signature_id)
    values (${T}, ${v?.id}, ${U1}, 'free', '[{"page":1,"x":0.1,"y":0.1,"w":0.2,"h":0.1}]'::jsonb, ${STAMP})`;
  await o`insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data) values
    (${T}, ${C}, 'stage_decided', ${U1}, ${JSON.stringify({ task_id: "t1", stage: "Ký", action: "approve", feedback: "Ý kiến kín" })}::jsonb),
    (${T}, ${C}, 'approval_override', ${U1}, ${JSON.stringify({ task_id: "t1" })}::jsonb)`;
  db = createDb(urls().hubApi, { max: 4 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

const uow = () =>
  createPackUow(db, "contracts", (tx, tid) => ({
    approval: {
      state: async () => ({ owner: U1, approval: { startedBy: U1, engineRunId: null }, id: C }),
    },
    approvalEngine: approvalEngineRepo(tx, tid),
  }));
const deps = (admin: boolean) =>
  ({
    uow: uow(),
    port: () => undefined,
    isAdmin: async () => admin,
    stampPng: async (_t: string, ids: readonly string[]) =>
      new Map(
        ids.map((i) => [
          i,
          Uint8Array.from(
            atob(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
            ),
            (c) => c.charCodeAt(0),
          ),
        ]),
      ),
    savedBytes: async (_org: string, id: string) => stored.get(id) ?? null,
  }) as never;

describe("hồ sơ duyệt · hình chữ ký (s10)", () => {
  it("người xem HĐ ngoài quy trình thấy hình chữ ký nhưng KHÔNG thấy ý kiến (BR-X2)", async () => {
    const r = await approvalRecord(deps(false))({ tenantId: T, userId: U2 }, C);
    expect(r?.can_read_evidence).toBe(false);
    expect(r?.items[0]?.sign?.stamp_id).toBe(STAMP);
    expect(r?.items[0]?.feedback).toBeNull();
  });
  it("hồ sơ có sha256 của bản cuối + mã kiểm tra", async () => {
    const r = await approvalRecord(deps(true))({ tenantId: T, userId: U1 }, C);
    const f = r?.files?.find((x) => x.kind === "signed");
    expect([f?.sha256, f?.check_code]).toEqual([SHA, "ABCDEF12"]);
  });
  it("HĐ ký đủ thì có PDF đã lưu một bản, người trong quy trình nhận bản lưu và người chỉ xem nhận bản lập ngay", async () => {
    const files = () => ({
      postFile: async (_n: string, b: Uint8Array) => {
        const id = crypto.randomUUID();
        stored.set(id, b);
        return { fileId: id, versionId: "v" };
      },
      deleteFile: async (id: string) => void stored.delete(id),
      getContent: async (id: string) => stored.get(id) ?? null,
      getLink: async () => null,
    });
    const save = saveApprovalRecord(db, files, approvalRecordArchive(deps(true)));
    expect(await save(T, C, U1)).toBe(true);
    expect(await save(T, C, U1)).toBe(false);
    const [n] =
      await o`select count(*)::int as n from contracts.contract_events where tenant_id = ${T} and contract_id = ${C} and type = 'approval_record_saved'`;
    expect(n?.n).toBe(1);
    expect(stored.size).toBe(1);
    const mine = await approvalRecordPdf(deps(true))({ tenantId: T, userId: U1 }, C);
    expect([...stored.values()].some((b) => b === mine?.bytes)).toBe(true);
    const other = await approvalRecordPdf(deps(false))({ tenantId: T, userId: U2 }, C);
    expect([...stored.values()].some((b) => b === other?.bytes)).toBe(false);
  });
});
