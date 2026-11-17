// CR-181 · s10 · hồ sơ duyệt có hình chữ ký (DB thật, RLS gói): X2 người xem HĐ ngoài quy trình thấy hình chữ ký nhưng KHÔNG thấy ý kiến; sha256 bản cuối;
// duyệt thay; HĐ ký đủ ⇒ lập khi cần + lưu PDF (lưu lỗi lần đầu ⇒ lần sau tự lưu; huỷ → ký lại ⇒ bản lưu mới theo tập bản cuối).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow } from "../../kit/adapters/pack-uow";
import { stampPngOf } from "../../packs.tenant-config";
import { approvalRecord, approvalRecordPdf } from "../application/approval-record.usecase";
import { saveApprovalRecord } from "../approval-record-save.mount";
import { approvalEngineRepo } from "./approval-engine.repo";

let o: Sql;
let db: Db;
let T = "";
let U1 = "";
let U2 = "";
let C = "";
let F = "";
const SHA = `abcdef12${"0".repeat(56)}`;
const SHA2 = `99887766${"1".repeat(56)}`;
const STAMP = crypto.randomUUID();
const RUN = crypto.randomUUID();
const stored = new Map<string, Uint8Array>();
let failNext = false;
let stampLoaded = 0;
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

const addFile = async (name: string) => {
  const id = crypto.randomUUID();
  await o`insert into contracts.files (id, tenant_id, org, file_id, version_id, name, mime, size_bytes, created_by)
    values (${id}, ${T}, ${`t_${T}`}, ${`f-${id}`}, ${`v-${id}`}, ${name}, 'application/pdf', 16, ${U1})`;
  return id;
};
const addVersion = async (seq: number, sha: string, out: string) => {
  const [v] =
    await o`insert into contracts.sign_versions (tenant_id, contract_id, file_id, seq, out_file_id, sha256, signed_by, signature_kind)
    values (${T}, ${C}, ${F}, ${seq}, ${out}, ${sha}, ${U1}, 'internal') returning id`;
  await o`insert into contracts.sign_marks (tenant_id, version_id, signer_id, placement, parts, user_signature_id)
    values (${T}, ${v?.id}, ${U1}, 'free', '[{"page":1,"x":0.1,"y":0.1,"w":0.2,"h":0.1}]'::jsonb, ${STAMP})`;
};

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [T] = (await tenants(o, 1, 1810)) as [string];
  [U1, U2] = (await users(o, T, 2, { from: 1810 })) as [string, string];
  [C] = (await contracts(o, T, 1, { from: 1810, createdBy: U1, status: "done" })) as [string];
  F = await addFile("hd.pdf");
  await o`insert into contracts.sign_docs (tenant_id, contract_id, file_id, needs_sign, set_by) values (${T}, ${C}, ${F}, true, ${U1})`;
  await addVersion(1, SHA, await addFile("hd-ky.pdf"));
  db = createDb(urls().hubApi, { max: 6 });
  // Bản ký THẬT trong hub.user_signatures: `stampPngOf` thật phải đọc được bằng role `hub_api` (qua hàm DEFINER 0157), không dùng hàm giả.
  await o`insert into hub.user_signatures (id, tenant_id, user_id, kind, method, png) values (${STAMP}, ${T}, ${U1}, 'main', 'draw', ${Buffer.from(PNG)})`;
  const evId = crypto.randomUUID();
  await o.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`insert into hub.evidence (id, tenant_id, subject_kind, subject_id, note, by_user)
      values (${evId}, ${T}, 'task_decision', ${crypto.randomUUID()}, ${"Ghi chú kín"}, ${U1})`;
  });
  // Duyệt thay: seed bằng chính repo của engine (như đường thật), không INSERT tay.
  const seed = createPackUow(db, "contracts", (tx, tid) => ({ eng: approvalEngineRepo(tx, tid) }));
  await seed.tenant({ tenantId: T, userId: U1 }, async (r) => {
    const ev = { taskId: "t1", stageKey: "Ký", action: "approve" as const, actor: U1 };
    await r.eng.recordOverride?.(C, RUN, { ...ev, runId: RUN });
    await r.eng.recordDecision?.(C, RUN, { ...ev, feedback: "Ý kiến kín", evidenceId: evId });
  });
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
const files = () => ({
  postFile: async (_n: string, b: Uint8Array) => {
    if (failNext) {
      failNext = false;
      throw new Error("filebox down");
    }
    const id = crypto.randomUUID();
    stored.set(id, b);
    return { fileId: id, versionId: "v" };
  },
  deleteFile: async (id: string) => void stored.delete(id),
  getContent: async (id: string) => stored.get(id) ?? null,
  getLink: async () => null,
});
const deps = (admin: boolean, save = false) =>
  ({
    uow: uow(),
    port: () => undefined,
    isAdmin: async () => admin,
    stampPng: async (t: string, ids: readonly string[]) => {
      const got = await stampPngOf(db)(t, ids);
      stampLoaded += got.size;
      return got;
    },
    savedBytes: async (_org: string, id: string) => stored.get(id) ?? null,
    ...(save ? { savePdf: saveApprovalRecord(db, files) } : {}),
  }) as never;
const saved = async () =>
  (
    await o`select data ->> 'versions' as k from contracts.contract_events
    where tenant_id = ${T} and contract_id = ${C} and type = 'approval_record_saved' order by id`
  ).map((r) => r.k as string);

describe("hồ sơ duyệt · hình chữ ký (s10)", () => {
  it("stampPngOf THẬT (role hub_api): đọc đúng ảnh của tenant, tenant khác không thấy, PDF Hồ sơ duyệt lập được với bản ký thật", async () => {
    const own = await stampPngOf(db)(T, [STAMP]);
    expect([...(own.get(STAMP) ?? [])]).toEqual([...PNG]);
    expect((await stampPngOf(db)(crypto.randomUUID(), [STAMP])).size).toBe(0);
    expect((await stampPngOf(db)(T, [])).size).toBe(0);
    stampLoaded = 0;
    const pdf = await approvalRecordPdf(deps(true))({ tenantId: T, userId: U1 }, C);
    expect(pdf?.bytes.byteLength).toBeGreaterThan(0);
    expect(stampLoaded).toBeGreaterThan(0);
  });
  it("người xem HĐ ngoài quy trình thấy hình chữ ký nhưng KHÔNG thấy ý kiến (BR-X2)", async () => {
    const r = await approvalRecord(deps(false))({ tenantId: T, userId: U2 }, C);
    expect(r?.can_read_evidence).toBe(false);
    expect(r?.items[0]?.sign?.stamp_id).toBe(STAMP);
    expect(r?.items[0]?.feedback).toBeNull();
    expect(r?.items[0]?.evidence).toMatchObject({ readable: false, note: null });
  });
  it("hồ sơ có sha256 của bản cuối + mã kiểm tra, và bước duyệt thay ghi override", async () => {
    const r = await approvalRecord(deps(true))({ tenantId: T, userId: U1 }, C);
    const f = r?.files?.find((x) => x.kind === "signed");
    expect([f?.sha256, f?.check_code]).toEqual([SHA, "ABCDEF12"]);
    expect(r?.items[0]?.override).toBe(true);
  });
  it("HĐ ký đủ: lưu lỗi lần đầu thì lần tải sau tự lưu được, người chỉ xem luôn nhận bản lập ngay", async () => {
    failNext = true;
    const first = await approvalRecordPdf(deps(true, true))({ tenantId: T, userId: U1 }, C);
    expect(first?.bytes.byteLength).toBeGreaterThan(0);
    expect(await saved()).toEqual([]);
    expect(stored.size).toBe(0);
    const second = await approvalRecordPdf(deps(true, true))({ tenantId: T, userId: U1 }, C);
    expect(await saved()).toHaveLength(1);
    expect([...stored.values()].some((b) => b === second?.bytes)).toBe(true);
    await approvalRecordPdf(deps(true, true))({ tenantId: T, userId: U1 }, C); // đã có bản hợp lệ ⇒ không lưu thêm
    expect(await saved()).toHaveLength(1);
    const other = await approvalRecordPdf(deps(false, true))({ tenantId: T, userId: U2 }, C);
    expect([...stored.values()].some((b) => b === other?.bytes)).toBe(false);
  });
  it("huỷ bản ký rồi ký lại: lập bản lưu mới với sha256 mới (khoá theo tập bản cuối)", async () => {
    await o`update contracts.sign_versions set voided_at = now() where tenant_id = ${T} and contract_id = ${C} and seq = 1`;
    await addVersion(2, SHA2, await addFile("hd-ky2.pdf"));
    const rec = await approvalRecord(deps(true, true))({ tenantId: T, userId: U1 }, C);
    expect(rec?.files?.find((x) => x.kind === "signed")?.sha256).toBe(SHA2);
    const keys = await saved();
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });
});
