// CR-105 · L2a · làn đầy đủ (chuyển dữ liệu khách) · viết TRƯỚC script: tenant có mẫu riêng ⇒ đúng một def thư viện + một gán, bước
// theo MÃ phòng ban, chạy lại không tạo trùng; `--dry-run` không ghi; tenant chưa lưu mẫu / cài đặt mặc định ⇒ không gán, chạy mặc định.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { groups, tenantId } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../src/lib/db";
import { APPROVAL_DEFAULT_DEF } from "../src/modules/packs/contracts/domain/approval-slot-default.rules";
import { resolveSlot } from "../src/modules/processes/library/slot-resolve.repo";
import { backfill } from "./process-library-backfill";

const SLOT = "contracts.approval";
const T = { own: tenantId(1081), dflt: tenantId(1082), none: tenantId(1083) };
let o: Sql;
let db: Db;
let g: Map<string, string>;

const review = (key: string, gid: string, when: unknown = null) => ({
  kind: "review",
  key,
  name: `Duyệt ${key}`,
  department_group_id: gid,
  head_only: false,
  due_h: 72,
  remind_every_h: null,
  escalate_group_id: null,
  exclude_starter: false,
  when,
});

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 2);
  await o`insert into admin.tenants (id, key, name) values (${T.own}, 't1081', 'Công ty Riêng'),
    (${T.dflt}, 't1082', 'Công ty Mặc định'), (${T.none}, 't1083', 'Công ty Trống')`;
  g = await groups(o, T.own, ["ke-toan", "giam-doc"]);
  await groups(o, T.dflt, ["contracts-editor", "contracts-owner"]);
  const steps = [
    review("kt", g.get("ke-toan") as string),
    review("gd", g.get("giam-doc") as string, {
      op: "and",
      conds: [{ field: "total_value", op: "ge", value: 1 }],
    }),
  ];
  await o`insert into contracts.approval_flows (tenant_id, steps) values (${T.own}, ${JSON.stringify(steps)}::text::jsonb)`;
  // Cài đặt = mặc định (ngưỡng 500 tr, editor/owner) ⇒ không khác def mặc định 0069.
  await o`insert into contracts.approval_settings (tenant_id) values (${T.dflt})`;
}, 180_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

const mine = (r: {
  created: { tenant: string }[];
  skipped: { tenant: string; reason: string }[];
}) => ({
  created: r.created.filter((x) => x.tenant.startsWith("t108")).map((x) => x.tenant),
  skipped: r.skipped
    .filter((x) => x.tenant.startsWith("t108"))
    .map((x) => `${x.tenant}:${x.reason}`),
});

describe("CR-105 · script chuyển mẫu duyệt HĐ sang thư viện", () => {
  it("chạy hai lần: một quy trình riêng, một gán, bước theo mã", async () => {
    const dry = await backfill(o, { dryRun: true });
    expect(mine(dry)).toEqual({ created: ["t1081"], skipped: ["t1082:default"] });
    expect([
      ...(await o`select count(*)::int as n from hub.process_defs where key = 'hd-t1081'`),
    ]).toEqual([{ n: 0 }]);

    const first = await backfill(o, { dryRun: false });
    const second = await backfill(o, { dryRun: false });
    expect({ first: mine(first), second: mine(second) }).toEqual({
      first: { created: ["t1081"], skipped: ["t1082:default"] },
      second: { created: [], skipped: ["t1081:exists", "t1082:default"] },
    });
    const defs = await o<
      { id: string; name: string; pv: number; body: { steps: Record<string, unknown>[] } }[]
    >`
      select id::text as id, name, published_version as pv, slot_body as body from hub.process_defs
      where tenant_id is null and key = 'hd-t1081' and slot = ${SLOT} and deleted_at is null`;
    expect(defs.length).toBe(1);
    const d = defs[0] as (typeof defs)[number];
    expect({
      name: d.name,
      pv: d.pv,
      steps: d.body.steps.map((s) => [s.key, s.department_group_key, s.department_group_id]),
      asg: await o`select def_id::text as def from hub.process_slot_assignments where tenant_id = ${T.own}`,
      rel: await o`select count(*)::int as n from hub.process_def_releases where def_id = ${d.id}`,
    }).toEqual({
      name: "Quy trình HĐ – Công ty Riêng",
      pv: 1,
      steps: [
        ["kt", "ke-toan", null],
        ["gd", "giam-doc", null],
      ],
      asg: [{ def: d.id }],
      rel: [{ n: 1 }],
    });
    // Lượt mới của tenant chạy đúng quy trình riêng.
    expect((await resolveSlot(db, T.own, SLOT))?.defId).toBe(d.id);
    expect(JSON.stringify(d.body)).not.toContain(g.get("ke-toan") as string);
  });

  it("tenant chưa lưu mẫu không gán, chạy mặc định", async () => {
    await backfill(o, { dryRun: false });
    expect([
      ...(await o`select count(*)::int as n from hub.process_slot_assignments where tenant_id in (${T.dflt}, ${T.none})`),
    ]).toEqual([{ n: 0 }]);
    const r = await resolveSlot(db, T.none, SLOT);
    const s = await resolveSlot(db, T.dflt, SLOT);
    expect({ none: r?.defId, dflt: s?.defId, isDefault: s?.isDefault }).toEqual({
      none: APPROVAL_DEFAULT_DEF.id,
      dflt: APPROVAL_DEFAULT_DEF.id,
      isDefault: true,
    });
  });
});
