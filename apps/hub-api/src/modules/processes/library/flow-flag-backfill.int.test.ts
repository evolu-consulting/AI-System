// CR-125 · G8 · int (DB thật): migration hub 0126 bật `flow_triggers` cho công ty có `company_flows` đang bật. Chạy MIGRATION THẬT 2 lần (file SQL
// trong tx như drizzle): công ty có dòng gán bật (cờ tắt hoặc chưa có hàng) ⇒ BẬT; công ty đã bật giữ nguyên `updated_at`; công ty không có dòng gán,
// hoặc chỉ có dòng đã tắt ⇒ giữ nguyên (tắt/vắng); chạy lại vô hại.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tenantId } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";

const MISSING = tenantId(2311); // dòng gán bật, chưa có hàng cờ
const OFF = tenantId(2312); // dòng gán bật, cờ tắt
const ON = tenantId(2313); // dòng gán bật, cờ đã bật (updated_at cũ)
const NONE = tenantId(2314); // không có dòng gán, cờ tắt
const DISABLED = tenantId(2315); // chỉ dòng gán đã tắt, cờ tắt
const BARE = tenantId(2316); // không có gì
const OLD = new Date("2026-01-01T00:00:00Z");

const MIGRATION = readFileSync(
  join(
    import.meta.dir,
    "../../../../../../packages/db/migrations-hub/0126_flow_triggers_backfill.sql",
  ),
  "utf8",
);
const PARTS = MIGRATION.split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

let o: Sql;
const migrate = () =>
  o.begin(async (tx) => {
    for (const p of PARTS) await tx.unsafe(p);
  });
const state = async () =>
  Object.fromEntries(
    (
      await o<
        { tenant_id: string; flow_triggers: boolean; old: boolean }[]
      >`select tenant_id::text, flow_triggers, updated_at = ${OLD} as old from hub.tenant_flow_settings`
    ).map((r) => [r.tenant_id, [r.flow_triggers, r.old]]),
  );

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  await o`insert into admin.tenants (id, key, name) values (${MISSING}, 't2311', 'M'), (${OFF}, 't2312', 'O'), (${ON}, 't2313', 'N'),
    (${NONE}, 't2314', 'X'), (${DISABLED}, 't2315', 'D'), (${BARE}, 't2316', 'B')`;
  const [d] = await o<{ id: string }[]>`insert into hub.process_defs (tenant_id, key, name, stages)
    values (null, 'ffb-lib', 'ffb-lib', '[{"key":"dau"}]'::jsonb) returning id::text as id`;
  const flow = d?.id as string;
  await o`insert into hub.company_flows (tenant_id, flow_id, enabled) values (${MISSING}, ${flow}, true), (${OFF}, ${flow}, true),
    (${ON}, ${flow}, true), (${DISABLED}, ${flow}, false)`;
  await o`insert into hub.tenant_flow_settings (tenant_id, flow_triggers, updated_at) values (${OFF}, false, ${OLD}), (${ON}, true, ${OLD}),
    (${NONE}, false, ${OLD}), (${DISABLED}, false, ${OLD})`;
}, 120_000);
afterAll(async () => {
  await o?.end({ timeout: 2 });
});

describe("CR-125 · G8 · hub 0126 backfill cờ flow_triggers", () => {
  it("công ty có dòng gán bật ⇒ BẬT, công ty khác không đổi, chạy lại vô hại", async () => {
    await migrate();
    const s = await state();
    expect(s[MISSING]?.[0]).toBe(true);
    expect(s[OFF]).toEqual([true, false]); // bật + updated_at đổi
    expect(s[ON]).toEqual([true, true]); // đã bật ⇒ không đụng updated_at
    expect(s[NONE]).toEqual([false, true]);
    expect(s[DISABLED]).toEqual([false, true]);
    expect(s[BARE]).toBeUndefined();
    const before = JSON.stringify(s);
    await migrate();
    expect(JSON.stringify(await state())).toBe(before);
  });
});
