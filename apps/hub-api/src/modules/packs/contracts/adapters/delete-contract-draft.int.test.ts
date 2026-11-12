// CR-127 · Z8 · xoá HĐ nháp (DB thật, role gói `contracts_rw` + RLS): người tạo xoá nháp được; người khác (không phụ trách) ⇒ forbidden;
// người tạo xoá HĐ processing ⇒ forbidden; quản trị xoá được; chéo công ty ⇒ not_found; nháp đã gửi duyệt ⇒ xem trước nêu `submitted_before`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../../lib/db";
import { createPackUow } from "../../kit/adapters/pack-uow";
import { deleteContractUsecases } from "../application/delete-contract.usecase";
import { deleteContractRepo } from "./delete-contract.repo";

let o: Sql;
let db: Db;
let T = "";
let T2 = "";
let U1 = ""; // người tạo
let U2 = ""; // người khác cùng công ty
let U3 = ""; // công ty khác

const uc = () =>
  deleteContractUsecases({
    uow: createPackUow(db, "contracts", (tx, t) => ({
      deleteContract: deleteContractRepo(tx, t),
    })) as never,
    timeZoneOf: async () => "Asia/Ho_Chi_Minh",
    now: () => new Date("2026-11-11T03:00:00Z"),
  });
const editor = { admin: false, write: true };
const admin = { admin: true, write: true };
const w = (userId: string, tenantId = T) => ({ tenantId, userId });

async function mk(status: string, extra: Record<string, unknown> = {}): Promise<string> {
  const [r] = await o<{ id: string }[]>`insert into contracts.contracts ${o({
    tenant_id: T,
    title: "HĐ Z8",
    created_by: U1,
    status,
    ...extra,
  } as never)} returning id`;
  return (r as { id: string }).id;
}
const exists = async (id: string) =>
  (await o`select 1 from contracts.contracts where id = ${id}`).length === 1;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  [T, T2] = (await tenants(o, 2, 9301)) as [string, string];
  [U1, U2] = (await users(o, T, 2, { from: 9301 })) as [string, string];
  [U3] = (await users(o, T2, 1, { from: 9303 })) as [string];
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("Z8 · xoá HĐ nháp", () => {
  it("người tạo xoá nháp được (kể cả đã từng gửi duyệt: xem trước nêu rõ)", async () => {
    const id = await mk("draft", { submit_round: 1 });
    await o`insert into contracts.contract_submissions (tenant_id, contract_id, round, submitted_by) values (${T}, ${id}, 1, ${U1})`;
    await o`insert into contracts.approvals (tenant_id, contract_id, status, started_by) values (${T}, ${id}, 'cancelled', ${U1})`;
    const prev = await uc().preview(w(U1), id, editor);
    expect(prev.submitted_before).toBe(true);
    const out = await uc().remove(w(U1), id, [], editor);
    expect(out.deleted).toBe(true);
    expect(await exists(id)).toBe(false);
    const left = async (t: string) =>
      (await o.unsafe(`select 1 from contracts.${t} where contract_id = $1`, [id])).length;
    expect(await left("contract_submissions")).toBe(0);
    expect(await left("approvals")).toBe(0);
  });
  it("nháp chưa gửi duyệt: không có cờ submitted_before", async () => {
    const id = await mk("draft");
    expect((await uc().preview(w(U1), id, editor)).submitted_before).toBeUndefined();
  });
  it("người khác (không tạo / không phụ trách) ⇒ forbidden, HĐ còn nguyên; người phụ trách ⇒ xoá được", async () => {
    const id = await mk("draft", { owner_user_id: U1 });
    const e = await uc()
      .remove(w(U2), id, [], editor)
      .catch((x: Error) => x);
    expect((e as { kind?: string }).kind).toBe("forbidden");
    expect(await exists(id)).toBe(true);
    const own = await mk("draft", { owner_user_id: U2 });
    expect((await uc().remove(w(U2), own, [], editor)).deleted).toBe(true);
  });
  it("quản trị gói xoá nháp của người khác; người tạo xoá HĐ processing ⇒ forbidden, quản trị ⇒ được", async () => {
    const d = await mk("draft");
    expect((await uc().remove(w(U2), d, [], admin)).deleted).toBe(true);
    const p = await mk("processing");
    const e = await uc()
      .remove(w(U1), p, [], editor)
      .catch((x: Error) => x);
    expect((e as { kind?: string }).kind).toBe("forbidden");
    expect(await exists(p)).toBe(true);
    expect((await uc().remove(w(U2), p, [], admin)).deleted).toBe(true);
  });
  it("chéo công ty ⇒ not_found (kể cả quản trị)", async () => {
    const id = await mk("draft");
    const e = await uc()
      .remove(w(U3, T2), id, [], admin)
      .catch((x: Error) => x);
    expect((e as { kind?: string }).kind).toBe("not_found");
    const e2 = await uc()
      .preview(w(U3, T2), id, admin)
      .catch((x: Error) => x);
    expect((e2 as { kind?: string }).kind).toBe("not_found");
    expect(await exists(id)).toBe(true);
  });
});
