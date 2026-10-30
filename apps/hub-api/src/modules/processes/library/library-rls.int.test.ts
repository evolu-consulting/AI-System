// CR-105 · L1 pl-slot-core · design §8 + readiness Chặn 1 · viết TRƯỚC code: cách ly tenant cho 3 bảng mới (gán, release, khe) và
// `process_defs_select` thu hẹp (scope user không thấy def thư viện có `slot`). Đường chạy thật: `hub_api` + `app.scope`
// (`inHub`, như `withHubScope`); dữ liệu dựng bằng owner. `defineRlsSuite` của test-kit chỉ đặt role gói + `app.tenant_id`
// (không `app.scope`) nên không áp được cho bảng Hub ⇒ ca hợp đồng tương đương viết tay ở đây (đọc chéo / ghi chéo / thăm dò).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenantId, userId } from "@ai/test-kit/builders";
import { cloneDb, type HubScopeArg, inHub, openOwner, pgCode, type Sql } from "@ai/test-kit/db";

const T = { a: tenantId(1051), b: tenantId(1052) };
const U = { a: userId(1051), b: userId(1052) };
const SLOT = "contracts.approval";
const NIL = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const sys: HubScopeArg = { kind: "system" };
const user = (k: "a" | "b"): HubScopeArg => ({ kind: "user", tenantId: T[k], userId: U[k] });
const STAGES = JSON.stringify([{ key: "s0" }]);

let o: Sql;
const ids = { libA: "", libB: "", tpl: "" };

const count = (scope: HubScopeArg | "none", q: string, p: unknown[] = []) =>
  inHub(scope, async (tx) => {
    const r = (await tx.unsafe(q, p as never[])) as unknown as { n: number }[];
    return r[0]?.n ?? -1;
  });
/** Số hàng bị tác động (chuỗi) hoặc SQLSTATE; mỗi lệnh một tx (ném trong tx ⇒ hoàn tác). */
const write = async (scope: HubScopeArg, q: string, p: unknown[] = []): Promise<string> => {
  try {
    return await inHub(scope, async (tx) => {
      const n = (await tx.unsafe(q, p as never[])).count;
      throw Object.assign(new Error("rollback"), { n });
    });
  } catch (e) {
    const x = e as { n?: number; code?: string };
    return x.n !== undefined ? String(x.n) : (x.code ?? "no-code");
  }
};

async function libDef(key: string, slot: string | null): Promise<string> {
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, slot,
      published_version) values (null, ${key}, ${key}, ${STAGES}::text::jsonb, ${slot}, ${slot ? 1 : null})
    returning id::text as id`;
  return r?.id as string;
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  await o`insert into admin.tenants (id, key, name) values (${T.a}, 't1051', 'T1051'), (${T.b}, 't1052', 'T1052')
    on conflict do nothing`;
  ids.libA = await libDef("pl-rls-a", SLOT);
  ids.libB = await libDef("pl-rls-b", SLOT);
  ids.tpl = await libDef("pl-rls-tpl", null);
  await o`insert into hub.process_def_releases (def_id, rel_version, name, stages)
    values (${ids.libA}, 1, 'A', ${STAGES}::text::jsonb), (${ids.libB}, 1, 'B', ${STAGES}::text::jsonb)`;
  await o`insert into hub.process_slots (slot, default_def_id) values (${SLOT}, ${ids.libA})
    on conflict (slot) do update set default_def_id = excluded.default_def_id`;
  await o`insert into hub.process_slot_assignments (tenant_id, slot, def_id)
    values (${T.a}, ${SLOT}, ${ids.libA}), (${T.b}, ${SLOT}, ${ids.libB})`;
}, 300_000);
afterAll(async () => {
  await o?.end({ timeout: 2 });
});

const ASG = "select count(*)::int as n from hub.process_slot_assignments";

describe("CR-105 · RLS thư viện quy trình", () => {
  it("chặn đọc chéo tenant bảng gán, release, khe", async () => {
    const read = {
      asgOwn: await count(user("a"), `${ASG} where tenant_id = $1`, [T.a]),
      asgCross: await count(user("b"), `${ASG} where tenant_id = $1`, [T.a]),
      asgAllB: await count(user("b"), ASG),
      asgNoScope: await count("none", ASG),
      asgSys: await count(sys, ASG),
      relUser: await count(user("a"), "select count(*)::int as n from hub.process_def_releases"),
      relSys: await count(
        sys,
        "select count(*)::int as n from hub.process_def_releases where def_id = any($1::uuid[])",
        [`{${ids.libA},${ids.libB}}`],
      ),
      slotUser: await count(user("a"), "select count(*)::int as n from hub.process_slots"),
      slotSys: await count(sys, "select count(*)::int as n from hub.process_slots"),
    };
    expect(read).toEqual({
      asgOwn: 1,
      asgCross: 0,
      asgAllB: 1,
      asgNoScope: 0,
      asgSys: 2,
      relUser: 0,
      relSys: 2,
      slotUser: 0,
      slotSys: 1,
    });
    // Ghi chỉ scope system: tenant không tự gán / đổi gán / xoá gán (kể cả hàng của chính mình), không chạm release/khe.
    const asgIns = `insert into hub.process_slot_assignments (tenant_id, slot, def_id) values ($1, 'x.y', $2)`;
    const writes = {
      insOwn: await write(user("a"), asgIns, [T.a, ids.libB]),
      updOwn: await write(user("a"), "update hub.process_slot_assignments set def_id = $1", [
        ids.libB,
      ]),
      delCross: await write(
        user("b"),
        "delete from hub.process_slot_assignments where tenant_id = $1",
        [T.a],
      ),
      relIns: await write(
        user("a"),
        "insert into hub.process_def_releases (def_id, rel_version, name, stages) values ($1, 9, 'x', '[{}]')",
        [ids.libA],
      ),
      slotUpd: await write(user("a"), "update hub.process_slots set default_def_id = $1", [
        ids.libB,
      ]),
      // Release bất biến: kể cả scope system không UPDATE/DELETE được (REVOKE).
      relUpdSys: await write(sys, "update hub.process_def_releases set name = 'x'"),
      relDelSys: await write(sys, "delete from hub.process_def_releases"),
    };
    expect(writes).toEqual({
      insOwn: "42501",
      updOwn: "0",
      delCross: "0",
      relIns: "42501",
      slotUpd: "0",
      relUpdSys: "42501",
      relDelSys: "42501",
    });
    // Thăm dò tồn tại: hàng của A ≡ không tồn tại dưới B.
    const probe = (t: string) => count(user("b"), `${ASG} where tenant_id = $1`, [t]);
    expect(await probe(T.a)).toBe(await probe(NIL));
  });

  it("process_defs_select thu hẹp: scope user không thấy def thư viện (có slot), vẫn thấy mẫu chạy thử", async () => {
    const q = "select count(*)::int as n from hub.process_defs where id = $1";
    expect({
      libUser: await count(user("a"), q, [ids.libA]),
      tplUser: await count(user("a"), q, [ids.tpl]),
      libSys: await count(sys, q, [ids.libA]),
    }).toEqual({ libUser: 0, tplUser: 1, libSys: 1 });
  });

  it("CHECK: slot sai dạng hoặc def tenant có slot bị từ chối; FK RESTRICT chặn xoá def đang gán", async () => {
    const bad = await pgCode(
      () => o`insert into hub.process_defs (tenant_id, key, name, stages, slot)
        values (null, 'pl-bad', 'x', ${STAGES}::text::jsonb, 'Contracts Approval')`,
    );
    const tenantSlot = await pgCode(
      () => o`insert into hub.process_defs (tenant_id, key, name, stages, slot)
        values (${T.a}, 'pl-bad2', 'x', ${STAGES}::text::jsonb, ${SLOT})`,
    );
    const del = await pgCode(() => o`delete from hub.process_defs where id = ${ids.libB}`);
    expect({ bad, tenantSlot, del }).toEqual({ bad: "23514", tenantSlot: "23514", del: "23503" });
  });
});
