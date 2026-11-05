// CR-121 Q-4 · MỘT định nghĩa "tên HĐ" (`contractNameSql`) trên DB thật (pool hub_api, role `contracts_rw` + RLS): cột `title` là TÊN FILE
// lúc tải lên, tên HĐ thật ở `fields.title`. Mọi đường người dùng thấy tên HĐ phải ra tên thật, không ra tên file:
// danh sách + chi tiết HĐ (và sắp xếp theo tên), "Chờ tôi duyệt"/Việc của tôi (hạn xử lý), nhật ký hoạt động, nhãn lượt duyệt.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../../lib/db";
import { createPackUow } from "../../kit/adapters/pack-uow";
import { myWorkWindow } from "../application/mywork.usecase";
import type { ContractListFilter } from "../application/ports";
import { activityRepo } from "./activity.repo";
import { approvalEngineRepo } from "./approval-engine.repo";
import { contextLabelRepo } from "./context-label.repo";
import { contractsRepo } from "./contracts.repo";
import { myWorkRepo } from "./mywork.repo";

let o: Sql;
let db: Db;
let T = "";
let U = "";
let ids: string[] = [];
const FILE_A = "scan-0001.pdf";
const NAME_A = "Hợp đồng mua gỗ sồi";
const FILE_B = "aaa-scan.pdf";
const NAME_B = "Zeta thuê kho";
const today = new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const uow = () =>
  createPackUow(db, "contracts", (tx, tid) => ({
    list: contractsRepo(tx, tid),
    activity: activityRepo(tx, tid),
    engine: approvalEngineRepo(tx, tid),
    ctx: contextLabelRepo(tx, tid),
    mywork: myWorkRepo(tx, tid),
  }));
const who = () => ({ tenantId: T, userId: U });

const filter = (order: ContractListFilter["order"]): ContractListFilter => ({
  status: null,
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
  order,
  limit: 20,
  offset: 0,
});

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  [T] = (await tenants(o, 1, 1301)) as [string];
  [U] = (await users(o, T, 1, { from: 1301 })) as [string];
  ids = await contracts(o, T, 2, { from: 1301, createdBy: U, owner: U });
  // title = tên file; fields.title = tên HĐ thật; hạn xử lý trong 3 ngày (cửa sổ Việc của tôi 7 ngày) (trigger tính `action_deadline` từ `end_date`).
  for (const [i, file, name] of [
    [0, FILE_A, NAME_A],
    [1, FILE_B, NAME_B],
  ] as const) {
    await o`update contracts.contracts set title = ${file}, fields = ${o.json({
      title: { value: name },
      end_date: { value: inDays(3) },
      notice_days: { value: "0" },
    } as never)} where id = ${ids[i] as string}`;
  }
  await o`insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id)
    values (${T}, ${ids[0] as string}, 'edited', ${U})`;
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-121 Q-4 · tên HĐ một nguồn (title = tên file, fields.title = tên thật)", () => {
  it("danh sách + chi tiết HĐ trả tên thật, sắp xếp theo tên thật (không theo tên file)", async () => {
    const asc = await uow().tenant(who(), (r) => r.list.list(filter("title:asc"), today));
    expect(asc.items.map((x) => x.title)).toEqual([NAME_A, NAME_B]); // theo tên file sẽ ra B trước A
    const d = await uow().tenant(who(), (r) => r.list.detail(ids[0] as string, today));
    expect(d?.title).toBe(NAME_A);
  });

  it("Việc của tôi (hạn xử lý HĐ) + nhãn lượt duyệt + nhãn ngữ cảnh trợ lý ra tên thật", async () => {
    const w = await uow().tenant(who(), (r) => r.mywork.list(myWorkWindow(new Date(), "UTC")));
    expect(w.deadlines.map((x) => x.title).sort()).toEqual([NAME_A, NAME_B].sort());
    const labels = await uow().tenant(who(), (r) => r.engine.labels([ids[0] as string]));
    expect(labels.map((x) => x.title)).toEqual([NAME_A]);
    const c = await uow().tenant(who(), (r) => r.ctx.contract(ids[1] as string));
    expect(c?.title).toBe(NAME_B);
  });

  it("nhật ký hoạt động của một HĐ ra tên thật", async () => {
    const h = await uow().tenant(who(), (r) =>
      r.activity.activity.record({ id: ids[0] as string, number: null }, 10),
    );
    expect(h[0]?.title).toBe(NAME_A);
    expect(h[0]?.events.length).toBeGreaterThan(0);
    expect(h[0]?.events.every((e) => e.name === NAME_A)).toBe(true);
  });
});
