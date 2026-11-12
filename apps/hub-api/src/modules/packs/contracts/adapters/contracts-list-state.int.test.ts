// CR-127 K2a-1 · BR-05/09/44 · spec §4.1: danh sách + chi tiết HĐ trên DB thật (pool hub_api, role `contracts_rw` + RLS):
// lọc 4 trạng thái + Hiệu lực, bản đã bị thay không vào danh sách, `extract_state`/`effect`/`superseded` đúng, chi tiết có `can` theo người gọi,
// tập "đã xác nhận" của sổ/nguồn giá = `done` (không lọt draft/processing/reject).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../../lib/db";
import { createPackUow } from "../../kit/adapters/pack-uow";
import type { ContractListFilter } from "../application/ports";
import { contractsRepo } from "./contracts.repo";

let o: Sql;
let db: Db;
let T = "";
let U = "";
let OTHER = "";
const id: Record<string, string> = {};

const uow = () => createPackUow(db, "contracts", (tx, tid) => ({ list: contractsRepo(tx, tid) }));
const who = () => ({ tenantId: T, userId: U });

const base: ContractListFilter = {
  status: null,
  effect: null,
  owner: null,
  category: null,
  seller: null,
  buyer: null,
  signerKeys: null,
  direction: null,
  kind: null,
  valueMin: null,
  valueMax: null,
  dateField: "end_date",
  dateFrom: null,
  dateTo: null,
  like: null,
  order: "title:asc",
  limit: 50,
  offset: 0,
};
const list = (f: Partial<ContractListFilter>) =>
  uow().tenant(who(), (r) => r.list.list({ ...base, ...f }));
const titles = async (f: Partial<ContractListFilter>) =>
  (await list(f)).items.map((i) => (i as { title: string }).title).sort();

async function mk(key: string, status: string, extra: Record<string, unknown> = {}): Promise<void> {
  const [r] = await o<{ id: string }[]>`insert into contracts.contracts ${o({
    tenant_id: T,
    title: key,
    created_by: U,
    owner_user_id: U,
    status,
    ...extra,
  } as never)} returning id`;
  id[key] = (r as { id: string }).id;
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  [T] = (await tenants(o, 1, 9128)) as [string];
  [U, OTHER] = (await users(o, T, 2, { from: 9128 })) as [string, string];
  await mk("A-draft-ready", "draft");
  await mk("B-draft-reading", "draft", { extract_state: "reading" });
  await mk("C-processing", "processing", { submit_round: 1, submitted_by: U });
  await mk("D-reject", "reject");
  await mk("E-done-active", "done", { effect: "active" });
  await mk("F-done-expiring", "done", { effect: "expiring" });
  await mk("G-done-expired", "done", { effect: "expired" });
  await mk("H-done-superseded", "done", { effect: null });
  await mk("I-done-v2", "done", {
    effect: "active",
    version_no: 2,
    supersedes_id: id["H-done-superseded"],
    root_id: id["H-done-superseded"],
  });
  await o`update contracts.contracts set superseded_at = now(), superseded_by = ${id["I-done-v2"] as string}::uuid
    where id = ${id["H-done-superseded"] as string}::uuid`;
}, 120_000);

afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-127 K2a-1 · danh sách theo 4 trạng thái + Hiệu lực", () => {
  it("không lọc ⇒ bản đã bị thay không vào danh sách", async () => {
    const all = await titles({});
    expect(all).toHaveLength(8);
    expect(all).not.toContain("H-done-superseded");
  });
  it("lọc status: mỗi trạng thái ra đúng hàng", async () => {
    expect(await titles({ status: ["draft"] })).toEqual(["A-draft-ready", "B-draft-reading"]);
    expect(await titles({ status: ["processing"] })).toEqual(["C-processing"]);
    expect(await titles({ status: ["reject"] })).toEqual(["D-reject"]);
    expect(await titles({ status: ["done"] })).toEqual([
      "E-done-active",
      "F-done-expiring",
      "G-done-expired",
      "I-done-v2",
    ]);
    expect(await titles({ status: ["draft", "reject"] })).toHaveLength(3);
  });
  it("lọc effect: chỉ HĐ DONE có hiệu lực khớp; HĐ chưa DONE không khớp bộ lọc hiệu lực", async () => {
    expect(await titles({ effect: ["active", "expiring"] })).toEqual([
      "E-done-active",
      "F-done-expiring",
      "I-done-v2",
    ]);
    expect(await titles({ effect: ["expired"] })).toEqual(["G-done-expired"]);
    expect(await titles({ effect: ["terminated"] })).toEqual([]);
    expect(await titles({ status: ["done"], effect: ["active"] })).toEqual([
      "E-done-active",
      "I-done-v2",
    ]);
  });
  it("hàng trả đủ extract_state / effect / superseded / hold", async () => {
    const rows = (await list({})).items as {
      title: string;
      status: string;
      extract_state: string;
      effect: string | null;
      superseded: boolean;
      hold: unknown;
    }[];
    const by = (t: string) => rows.find((r) => r.title === t);
    expect(by("B-draft-reading")).toMatchObject({
      status: "draft",
      extract_state: "reading",
      effect: null,
      superseded: false,
      hold: null,
    });
    expect(by("F-done-expiring")).toMatchObject({ status: "done", effect: "expiring" });
  });
});

describe("CR-127 K2a-1 · chi tiết: effect, vòng gửi, can theo người gọi", () => {
  const detail = (key: string, actor: string) =>
    uow().tenant(who(), (r) => r.list.detail(id[key] as string, "2026-11-10", actor));

  it("DRAFT đã đọc xong: phụ trách gửi được; người khác không", async () => {
    const mine = await detail("A-draft-ready", U);
    expect(mine?.can).toMatchObject({ submit: true, withdraw: false });
    expect(mine).toMatchObject({ status: "draft", extract_state: "ready", submit_round: 0 });
    expect((await detail("A-draft-ready", OTHER))?.can.submit).toBe(false);
  });
  it("AI đang đọc ⇒ chưa gửi được", async () => {
    expect((await detail("B-draft-reading", U))?.can.submit).toBe(false);
  });
  it("PROCESSING: người gửi gần nhất rút được, vòng gửi + người gửi hiện ra", async () => {
    const d = await detail("C-processing", U);
    expect(d).toMatchObject({ submit_round: 1, submitted_by: U });
    expect(d?.can).toMatchObject({ withdraw: true, submit: false });
    expect((await detail("C-processing", OTHER))?.can.withdraw).toBe(false);
  });
  it("REJECT: tạo lại được; DONE hiệu lực: bản mới + tạm khoá", async () => {
    expect((await detail("D-reject", U))?.can.recreate).toBe(true);
    expect((await detail("E-done-active", U))?.can).toMatchObject({
      new_version: true,
      hold: true,
    });
  });
  it("bản đã bị thay: superseded + không nút nào", async () => {
    const d = await detail("H-done-superseded", U);
    expect(d?.superseded).toBe(true);
    expect(d?.can).toEqual({
      submit: false,
      withdraw: false,
      recreate: false,
      new_version: false,
      hold: false,
      release: false,
    });
  });
});
