// CR-157 · Nhập tay = dự phòng khi AI đọc lỗi: chuyển sang nhập tay (chỉ DRAFT + failed), xác nhận "đã đối chiếu với tệp gốc",
// Gửi chặn `RECONCILE_REQUIRED` tới khi đối chiếu. DB thật, role gói thật, RLS theo tenant.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../../lib/db";
import { registerFlowEngine } from "../../kit/public";
import { reconcileEntry, startManualEntry } from "../application/manual-entry.usecase";
import { submitContract } from "../application/submit.usecase";
import { packUow } from "../extraction.uow";

let o: Sql;
let db: Db;
let T = "";
let T2 = "";
let creator = "";
let assignee = "";
let other = "";
let foreign = "";

const gate = { prepare: async () => ({ on: true, departments: [] as string[] }) };
const engine = () => ({
  availability: { hasFlowFor: async () => true },
  runControl: { inspect: async () => null, cancel: async () => true },
});
const uow = () => packUow(db);
const who = (u: string, t = T) => ({ tenantId: t, userId: u });

async function contract(extra: Record<string, unknown> = {}): Promise<string> {
  const id = crypto.randomUUID();
  await o`insert into contracts.contracts ${o({ id, tenant_id: T, title: "HĐ CR-157", created_by: creator, owner_user_id: assignee, status: "draft", extract_state: "failed", source_text: "Điều 1", ...extra } as never)}`;
  return id;
}
const row = async (id: string) =>
  (
    await o<
      {
        entry_source: string;
        extract_state: string;
        reconciled_by: string | null;
        reconciled_at: Date | null;
        status: string;
      }[]
    >`select entry_source, extract_state, reconciled_by, reconciled_at, status from contracts.contracts where id = ${id}`
  )[0];

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  [T, T2] = (await tenants(o, 2, 9457)) as [string, string];
  [creator, assignee, other] = (await users(o, T, 3, { from: 9457 })) as [string, string, string];
  [foreign] = (await users(o, T2, 1, { from: 9470 })) as [string];
  registerFlowEngine(engine() as never);
}, 120_000);

afterAll(async () => {
  registerFlowEngine(null);
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-157 chuyển sang nhập tay", () => {
  it("DRAFT + failed, người được giao (không phải người tạo) ⇒ manual + ready, version tăng, chưa đối chiếu", async () => {
    const id = await contract();
    const out = await startManualEntry({ uow: uow() })(who(assignee), id);
    expect("version" in out && out.version).toBeGreaterThan(1);
    expect(await row(id)).toMatchObject({
      entry_source: "manual",
      extract_state: "ready",
      reconciled_by: null,
      reconciled_at: null,
      status: "draft",
    });
  });

  it("AI đang đọc ⇒ busy, không đổi gì", async () => {
    const id = await contract({ extract_state: "reading" });
    expect(await startManualEntry({ uow: uow() })(who(creator), id)).toEqual({ error: "busy" });
    expect(await row(id)).toMatchObject({ entry_source: "ai", extract_state: "reading" });
  });

  it("AI đọc xong (ready) hoặc HĐ không còn DRAFT ⇒ MANUAL_NOT_ALLOWED", async () => {
    const ready = await contract({ extract_state: "ready" });
    expect(await startManualEntry({ uow: uow() })(who(creator), ready)).toEqual({
      error: "MANUAL_NOT_ALLOWED",
    });
    const done = await contract({ status: "done" });
    expect(await startManualEntry({ uow: uow() })(who(creator), done)).toEqual({
      error: "MANUAL_NOT_ALLOWED",
    });
  });

  it("người ngoài ⇒ forbidden, tenant khác không thấy ⇒ not_found", async () => {
    const id = await contract();
    expect(await startManualEntry({ uow: uow() })(who(other), id)).toEqual({ error: "forbidden" });
    expect(await startManualEntry({ uow: uow() })(who(foreign, T2), id)).toEqual({
      error: "not_found",
    });
    expect((await row(id))?.entry_source).toBe("ai");
  });
});

describe("CR-157 đối chiếu + Gửi", () => {
  const sub = () => submitContract({ uow: uow(), gate, engine });

  it("chưa đối chiếu ⇒ Gửi bị chặn RECONCILE_REQUIRED, HĐ giữ DRAFT", async () => {
    const id = await contract();
    await startManualEntry({ uow: uow() })(who(assignee), id);
    expect(await sub()(who(assignee), id, {})).toEqual({ error: "RECONCILE_REQUIRED" });
    expect((await row(id))?.status).toBe("draft");
  });

  it("đã đối chiếu ⇒ lưu reconciled_by = người gọi (người được giao) và Gửi được, bỏ tích ⇒ lại bị chặn", async () => {
    const id = await contract();
    await startManualEntry({ uow: uow() })(who(creator), id);
    const ok = await reconcileEntry({ uow: uow() })(who(assignee), id, true);
    expect(ok).toMatchObject({ by: assignee });
    expect(await row(id)).toMatchObject({ reconciled_by: assignee });
    expect((await row(id))?.reconciled_at).not.toBeNull();
    await reconcileEntry({ uow: uow() })(who(creator), id, false);
    expect(await row(id)).toMatchObject({ reconciled_by: null, reconciled_at: null });
    expect(await sub()(who(creator), id, {})).toEqual({ error: "RECONCILE_REQUIRED" });
    await reconcileEntry({ uow: uow() })(who(creator), id, true);
    expect(await sub()(who(creator), id, {})).toMatchObject({ status: "processing", round: 1 });
  });

  it("reconcile: HĐ do AI đọc ⇒ NOT_MANUAL, người ngoài ⇒ forbidden, tenant khác ⇒ not_found", async () => {
    const ai = await contract({ extract_state: "ready" });
    expect(await reconcileEntry({ uow: uow() })(who(creator), ai, true)).toEqual({
      error: "NOT_MANUAL",
    });
    const id = await contract();
    await startManualEntry({ uow: uow() })(who(creator), id);
    expect(await reconcileEntry({ uow: uow() })(who(other), id, true)).toEqual({
      error: "forbidden",
    });
    expect(await reconcileEntry({ uow: uow() })(who(foreign, T2), id, true)).toEqual({
      error: "not_found",
    });
    expect((await row(id))?.reconciled_by).toBeNull();
  });
});
