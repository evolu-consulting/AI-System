// CR-121 · D-4 · cổng "đã gán quy trình" = dấu tường minh `source` của luật (hub 0096), không so với mẫu khe lúc hỏi. Thật: DB, `ensureSlotDefaults`
// (ghi 'auto'), `upsertAssignment`/`deleteAssignment` (đường admin gán), `upsertSlotDefault` (platform đổi mẫu khe), backfill 0096.
//   (a) platform đổi mẫu mặc định của khe ⇒ công ty đang giữ luật tự cấp VẪN chưa gán (không âm thầm sang engine);
//   (b) admin chủ động gán đúng mẫu mặc định ⇒ đã gán; bỏ gán (ensureSlotDefaults cấp lại 'auto') ⇒ chưa gán;
//   (c) backfill: luật còn nguyên trạng lúc tự cấp ⇒ 'auto'; có dấu admin ⇒ 'admin'.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { withHubScope } from "@ai/db/hub-scope";
import { enableAddon, enablePack, tenantId } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../lib/db";
import { deleteAssignment, upsertAssignment, upsertSlotDefault } from "./slot-assign.repo";
import { slotAssigned } from "./slot-assigned.repo";
import { ensureSlotDefaults } from "./slot-defaults";
import { GEN_DEFAULT_ID, GEN_FEATURE, GEN_PACK, GEN_SLOT } from "./slot-generic.fixture";

const SLOT = GEN_SLOT;
const DFLT = GEN_DEFAULT_ID;
const SLOTS = [{ slot: SLOT, feature: GEN_FEATURE }];
const A = tenantId(1401);
const B = tenantId(1402);
const C = tenantId(1403);
const D = tenantId(1404);
const ACTOR = "7e5d00a1-0000-4000-8000-0000000014ff";

let o: Sql;
let db: Db;
let other = "";

const source = async (t: string) =>
  (
    await o<
      { source: string }[]
    >`select source from hub.process_routing_rules where tenant_id = ${t} and slot = ${SLOT} order by priority`
  ).map((r) => r.source);

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${A}, 't1401', 'A'), (${B}, 't1402', 'B'),
    (${C}, 't1403', 'C'), (${D}, 't1404', 'D')`;
  await enablePack(o, [A, B], GEN_PACK);
  await enableAddon(o, [A, B], GEN_FEATURE);
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, description, input_hint,
      run_group_ids, stages, token_budget, enabled, sources, inputs, slot, slot_body, published_version)
    select null, 'assigned-other', 'Mẫu khe mới', description, input_hint, run_group_ids, stages, token_budget, enabled,
      sources, inputs, slot, slot_body, 1 from hub.process_defs where id = ${DFLT} returning id::text as id`;
  other = r?.id as string;
  await o`insert into hub.process_def_releases (def_id, rel_version, name, stages, slot_body)
    select ${other}, 1, 'Mẫu khe mới', stages, slot_body from hub.process_def_releases
    where def_id = ${DFLT} order by rel_version desc limit 1`;
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("slotAssigned · dấu tường minh `source`", () => {
  it("(a) tự cấp ⇒ chưa gán, platform đổi mẫu mặc định của khe ⇒ vẫn chưa gán", async () => {
    expect(await slotAssigned(db, A, SLOT)).toBe(false);
    expect(await ensureSlotDefaults(db, SLOTS, [A])).toBe(1);
    expect(await source(A)).toEqual(["auto"]);
    expect(await slotAssigned(db, A, SLOT)).toBe(false);
    await withHubScope(db, { kind: "system" }, (tx) =>
      upsertSlotDefault(tx, { slot: SLOT, defId: other, actorId: ACTOR }),
    );
    expect(await slotAssigned(db, A, SLOT)).toBe(false);
    await withHubScope(db, { kind: "system" }, (tx) =>
      upsertSlotDefault(tx, { slot: SLOT, defId: DFLT, actorId: ACTOR }),
    );
  });

  it("(b) admin chủ động gán đúng mẫu mặc định ⇒ đã gán, bỏ gán ⇒ cấp lại tự động ⇒ chưa gán", async () => {
    expect(await ensureSlotDefaults(db, SLOTS, [B])).toBe(1);
    expect(await slotAssigned(db, B, SLOT)).toBe(false);
    await withHubScope(db, { kind: "system" }, (tx) =>
      upsertAssignment(tx, { tenantId: B, slot: SLOT, defId: DFLT, actorId: ACTOR }),
    );
    expect(await source(B)).toEqual(["admin"]);
    expect(await slotAssigned(db, B, SLOT)).toBe(true);
    // đổi mẫu khe sau đó cũng không làm mất "đã gán"
    await withHubScope(db, { kind: "system" }, (tx) =>
      upsertSlotDefault(tx, { slot: SLOT, defId: other, actorId: ACTOR }),
    );
    expect(await slotAssigned(db, B, SLOT)).toBe(true);
    await withHubScope(db, { kind: "system" }, (tx) =>
      upsertSlotDefault(tx, { slot: SLOT, defId: DFLT, actorId: ACTOR }),
    );
    await withHubScope(db, { kind: "system" }, (tx) => deleteAssignment(tx, B, SLOT));
    expect(await ensureSlotDefaults(db, SLOTS, [B])).toBe(1);
    expect(await source(B)).toEqual(["auto"]);
    expect(await slotAssigned(db, B, SLOT)).toBe(false);
  });

  it("(c) backfill 0096: nguyên trạng tự cấp ⇒ 'auto', có dấu admin (người sửa đầu luật) ⇒ 'admin'", async () => {
    for (const t of [C, D]) {
      await o`insert into hub.process_tenant_defs (tenant_id, def_id, slot) values (${t}, ${DFLT}, ${SLOT})`;
      await o`insert into hub.process_routings (tenant_id, slot, updated_by) values (${t}, ${SLOT}, ${t === D ? ACTOR : null})`;
      await o`insert into hub.process_routing_rules (tenant_id, slot, priority, condition, def_id, is_default, source)
        values (${t}, ${SLOT}, 49, '{}'::jsonb, ${DFLT}, true, 'admin')`;
    }
    const file = readFileSync(
      new globalThis.URL(
        "../../../../../../packages/db/migrations-hub/0096_routing_rule_source.sql",
        import.meta.url,
      ),
      "utf8",
    );
    for (const stmt of file.split("--> statement-breakpoint"))
      if (stmt.trim()) await o.unsafe(stmt);
    expect(await source(C)).toEqual(["auto"]);
    expect(await source(D)).toEqual(["admin"]);
    expect(await slotAssigned(db, C, SLOT)).toBe(false);
    expect(await slotAssigned(db, D, SLOT)).toBe(true);
  });
});
