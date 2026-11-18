// CR-146b · bên NHẬN đọc cấu hình từ quy trình «Nhận HĐ từ đối tác» (`contract.received`): ngưỡng + người phụ trách ở `trigger.params`,
// người ký = «Người ký phía công ty» của bước Ký. DB thật. Ca N2: người ký ≠ người phụ trách/tạo HĐ; chéo tenant; thiếu bước Ký.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { contractAccess, registerContractAccess } from "../../kit/public";
import { mountContractAccess } from "../contract-access.mount";
import { receiveFlowOf, signerMembersOf } from "./receive-flow.repo";

let o: Sql;
let db: Db;
let A = "";
let B = "";
let UA: string[] = [];
let UB: string[] = [];
let C = "";
let UC: string[] = [];

const sign = (signers: string) => [
  {
    key: "ky",
    executor: {
      tool_key: "contracts-esign-send",
      args: {
        provider: { from: "const", value: "upload" },
        company_signers: { from: "const", value: signers },
      },
    },
  },
];
const flow = async (t: string, key: string, params: object, stages: unknown[], pos: number) => {
  const trigger = JSON.stringify({ event: "contract.received", params });
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger, app, enabled)
    values (${t}, ${key}, ${key}, ${JSON.stringify(stages)}::text::jsonb, ${trigger}::text::jsonb, 'contracts', true) returning id::text as id`;
  await o`insert into hub.company_flows (tenant_id, flow_id, enabled, position) values (${t}, ${r?.id as string}, true, ${pos})`;
};

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [A, B, C] = (await tenants(o, 3, 1461)) as [string, string, string];
  UA = (await users(o, A, 2, { from: 1461 })) as string[];
  UB = (await users(o, B, 3, { from: 1465 })) as string[];
  UC = (await users(o, C, 3, { from: 1470 })) as string[];
  await flow(
    A,
    "cr146b-nhan",
    { important_min_m: 100, critical_min_m: 300, owner_user_id: UA[0] },
    sign(`user:${UA[1]}`),
    0,
  );
  db = createDb(urls().hubApi, { max: 3 });
  mountContractAccess(db);
}, 120_000);
afterAll(async () => {
  registerContractAccess(null); // cổng toàn cục: không để lại `db` đã đóng cho file test kế tiếp
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-146b · receiveFlowOf", () => {
  it("ngưỡng (triệu đồng ⇒ VND) + người phụ trách + người ký lấy từ quy trình Nhận HĐ đang bật", async () => {
    const c = await receiveFlowOf(db, A);
    expect(c.importantMin).toBe(100_000_000);
    expect(c.criticalMin).toBe(300_000_000);
    expect(c.ownerId).toBe(UA[0] as string);
    expect(c.signers).toEqual([{ kind: "user", id: UA[1] as string }]);
  });

  it("công ty không có quy trình Nhận HĐ ⇒ mặc định 500 triệu / 2 tỷ, không có người ký (chéo tenant: không đọc quy trình của A)", async () => {
    const c = await receiveFlowOf(db, B);
    expect(c).toEqual({
      importantMin: 500_000_000,
      criticalMin: 2_000_000_000,
      ownerId: null,
      signers: null,
    });
  });

  it("quy trình Nhận HĐ không có bước Ký ⇒ signers null; người ký ≠ người phụ trách; người ký công ty khác không lọt vào danh sách", async () => {
    await flow(
      B,
      "cr146b-nhan-b",
      { owner_user_id: UB[0] },
      [{ key: "nhan", executor: { tool_key: "x" } }],
      0,
    );
    expect((await receiveFlowOf(db, B)).signers).toBeNull();
    const ms = await signerMembersOf(db, A, [
      { kind: "user", id: UA[1] as string },
      { kind: "user", id: UB[1] as string }, // người của công ty B
    ]);
    expect(ms.map((m) => m.id)).toEqual([UA[1] as string]);
    expect(ms.map((m) => m.id)).not.toContain(UA[0] as string); // không phải người phụ trách/người tạo
  });

  it("hàm hub 0143 chỉ trả cấu hình của tenant đang đặt", async () => {
    const own = await o`select hub.contract_received_params(${A}::uuid) as p`;
    expect(own[0]).toBeDefined();
  });

  it("soát #2 · bước Ký theo VAI: giải vai như lúc chạy ⇒ người ký = người được giao (isSigner + danh sách uỷ quyền), người ký cũ thì không", async () => {
    const stages = [
      {
        key: "ky",
        name: "Ký hợp đồng",
        executor: {
          kind: "tool",
          tool_key: "contracts-esign-send",
          args: {
            provider: { from: "const", value: "upload" },
            company_signers: { from: "const", value: `user:${UC[1]}` }, // người ký CŨ (trước khi giao việc theo vai)
            signer_role: { from: "const", value: "nguoi-ky" },
          },
        },
      },
    ];
    await flow(C, "cr182-nhan-vai", {}, stages, 0);
    const acc = contractAccess();
    const tx = {} as never;
    // Vai chưa giao ⇒ giữ người ký cũ (không chặn).
    expect(await acc?.isSigner(tx, C, UC[1] as string)).toBe(true);
    const [gx] = await o<{ id: string }[]>`insert into admin.groups (tenant_id, key, name)
      values (${C}, 'nguoi-ky-x', ${o.json({ vi: "Người ký X" })}) returning id::text as id`;
    await o`insert into admin.group_members (tenant_id, group_id, user_id) values (${C}, ${gx?.id as string}, ${UC[0] as string})`;
    await o`insert into hub.process_role_assignments (tenant_id, flow_id, role_key, group_id, updated_by)
      select ${C}, d.id, 'nguoi-ky', ${gx?.id as string}, ${UC[2] as string} from hub.process_defs d where d.tenant_id = ${C} and d.key = 'cr182-nhan-vai'`;
    expect((await receiveFlowOf(db, C)).signers).toEqual([{ kind: "group", id: gx?.id as string }]);
    expect(await acc?.isSigner(tx, C, UC[0] as string)).toBe(true); // thành viên nhóm được giao
    expect(await acc?.isSigner(tx, C, UC[1] as string)).toBe(false); // người ký cũ
    expect(await acc?.isSigner(tx, C, UC[2] as string)).toBe(false); // người giao việc, không phải người ký
  });
});
