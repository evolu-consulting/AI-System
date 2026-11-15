// CR-127 §148 · N2 · "Lưu" gửi duyệt qua POST /review (không `draft:true`) = Gửi ⇒ chỉ người tạo HĐ ∪ người phụ trách (như POST /submit).
// Người có vai `write` nhưng KHÔNG phải người tạo/phụ trách ⇒ forbidden, HĐ giữ Nháp, trường KHÔNG đổi (rollback cả lệnh). Lưu nháp (`draft:true`) giữ theo `write`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../../lib/db";
import { registerFlowEngine } from "../../kit/public";
import { reviewSave } from "../application/review.usecase";
import { packUow } from "../extraction.uow";

let o: Sql;
let db: Db;
let T = "";
let CREATOR = "";
let OWNER = "";
let OTHER = "";

const gate = { prepare: async () => ({ on: true, departments: [] as string[] }) };
const engine = () => ({
  availability: { hasFlowFor: async () => true },
  runControl: { inspect: async () => null, cancel: async () => true },
});
const who = (userId: string) => ({ tenantId: T, userId });
const save = () =>
  reviewSave({
    uow: packUow(db),
    today: async () => "2026-11-10",
    submit: { uow: packUow(db), gate, engine } as never,
  });

async function draft(): Promise<string> {
  const id = crypto.randomUUID();
  await o`insert into contracts.contracts ${o({ id, tenant_id: T, title: "HĐ quyền gửi", created_by: CREATOR, owner_user_id: OWNER, status: "draft", extract_state: "ready", source_text: "Điều 1" } as never)}`;
  return id;
}
const row = async (id: string) =>
  (
    await o<{ status: string; version: number }[]>`
      select status, version from contracts.contracts where id = ${id}`
  )[0];

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  [T] = (await tenants(o, 1, 9441)) as [string];
  [CREATOR, OWNER, OTHER] = (await users(o, T, 3, { from: 9441 })) as [string, string, string];
  registerFlowEngine(engine() as never);
}, 120_000);

afterAll(async () => {
  registerFlowEngine(null);
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-127 §148 · POST /review không draft = Gửi duyệt (vai người tạo/phụ trách)", () => {
  it("người KHÔNG phải người tạo/phụ trách ⇒ forbidden, HĐ giữ Nháp, version không đổi", async () => {
    const id = await draft();
    const out = await save()(who(OTHER), id, { version: 1, deal: "buy" });
    expect(out).toMatchObject({ kind: "submit", code: "forbidden" });
    expect(await row(id)).toMatchObject({ status: "draft", version: 1 });
  });

  it("người tạo ⇒ gửi được (PROCESSING)", async () => {
    const id = await draft();
    const out = await save()(who(CREATOR), id, { version: 1, deal: "buy" });
    expect(out).toMatchObject({ kind: "ok", out: { status: "processing" } });
  });

  it("người phụ trách (không phải người tạo) ⇒ gửi được", async () => {
    const id = await draft();
    const out = await save()(who(OWNER), id, { version: 1, deal: "buy" });
    expect(out).toMatchObject({ kind: "ok", out: { status: "processing" } });
  });

  it("Lưu nháp (draft:true) của người khác có vai write ⇒ vẫn lưu được, không gửi", async () => {
    const id = await draft();
    const out = await save()(who(OTHER), id, { version: 1, deal: "buy", draft: true });
    expect(out).toMatchObject({ kind: "ok", out: { status: "draft" } });
  });
});
