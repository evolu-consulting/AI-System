// e2e-journey-approval · người duyệt (được giao / trưởng phòng của bước) ĐỌC được HĐ + thẻ duyệt khi run tới bước của họ, dù ngoài
// phòng/cây của chủ HĐ (chế độ thấy `org`). Quy trình thư viện: Kế toán (head_only) → Giám đốc (head_only), gói tự thêm "Xác nhận" s0.
// Người không liên quan (thành viên Kế toán không phải trưởng phòng), tenant khác ⇒ không thấy. Chỉ ĐỌC (RLS UPDATE giữ nguyên).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  APPROVAL_SLOT,
  compileSlotStages,
} from "../../../apps/hub-api/src/modules/packs/contracts/domain/approval-slot.rules";
import { setSlotDefault } from "../../../apps/hub-api/src/test-support/slot-default";
import { act, addRole, agentJson, approval, bump, CBASE, seedContract, total } from "../HD3/_hd3";
import { type Json, PA, PA_FIX, type Role, T, waitStatus } from "../P-d/_support/pd";
import { type CtxCf, caller, startCf } from "./_cf";

let c: CtxCf;
beforeAll(async () => {
  c = await startCf();
  await addRole(c, "editor", [PA.T, PA.H2]);
  await c.sql`insert into contracts.visibility_settings (tenant_id, mode) values (${T.acme}, 'org')
    on conflict (tenant_id) do update set mode = 'org'`;
  const [gd] = await c.sql<Json[]>`select group_id::text as id from admin.group_members
    where tenant_id = ${T.acme} and user_id = ${PA.H2.id} limit 1`;
  const gGd = gd?.id as string;
  // trưởng phòng: T = Kế toán, H2 = Giám đốc (B chỉ là thành viên Kế toán)
  for (const [g, u] of [
    [PA_FIX.gKeToan, PA.T.id],
    [gGd, PA.H2.id],
  ] as const)
    await c.sql`insert into admin.departments (tenant_id, group_id, head_user_id) values (${T.acme}, ${g}, ${u})
      on conflict (group_id) do update set head_user_id = excluded.head_user_id`;
  const keys = await c.sql<
    Json[]
  >`select id::text as id, key from admin.groups where id in (${PA_FIX.gKeToan}, ${gGd})`;
  const kOf = (id: string) => keys.find((k) => k.id === id)?.key as string;
  const rv = (key: string, name: string, dept: string): Json => ({
    kind: "review",
    key,
    name,
    department_group_id: null,
    department_group_key: dept,
    head_only: true,
    due_h: 48,
    remind_every_h: null,
    escalate_group_id: null,
    exclude_starter: false,
    when: null,
  });
  const body = {
    steps: [
      rv("kt", "Phòng Kế toán duyệt", kOf(PA_FIX.gKeToan)),
      rv("gd", "Ban Giám đốc duyệt", kOf(gGd)),
    ],
  };
  const stages = compileSlotStages(body);
  const [d] = await c.sql<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, slot, slot_body, published_version)
    values (null, 'cf-approver-visible', 'Duyệt 2 cấp', ${JSON.stringify(stages)}::text::jsonb, ${APPROVAL_SLOT},
      ${JSON.stringify(body)}::text::jsonb, 1) returning id::text as id`;
  const id = d?.id as string;
  await c.sql`insert into hub.process_def_releases (def_id, rel_version, name, stages, slot_body)
    values (${id}, 1, 'Duyệt 2 cấp', ${JSON.stringify(stages)}::text::jsonb, ${JSON.stringify(body)}::text::jsonb)`;
  await setSlotDefault(c.sql, T.acme, APPROVAL_SLOT, id);
  await bump(c);
  await untilCan(["T", "H2"]);
}, 180_000);
afterAll(async () => {
  await c?.stop();
});

/** Chờ cache quyền: các vai đều có `read` + `write` (H có thể kèm quyền khác từ Group Giám đốc). */
async function untilCan(roles: Role[]): Promise<void> {
  for (const r of roles) {
    for (let i = 0; i < 80; i++) {
      const a = ((await c.call(r, "GET", "/pack/contracts/me"))?.json?.actions ?? []) as string[];
      if (a.includes("read") && a.includes("write")) break;
      await bump(c);
    }
  }
}

const status = async (who: Parameters<CtxCf["call"]>[0], id: string) =>
  (await c.call(who, "GET", `${CBASE}/${id}`)).status;

describe("người duyệt của bước đang mở đọc được HĐ + thẻ duyệt (chế độ org, ngoài cây chủ HĐ)", () => {
  it("sau Xác nhận: trưởng Kế toán đọc + duyệt; thành viên Kế toán thường, tenant khác không; Giám đốc đọc khi run tới bước", async () => {
    const id = await seedContract(c, 861, { createdBy: PA.A.id, owner: PA.A.id });
    c.model.reply = { ok: true, text: agentJson(total(10_000_000)) };
    const done = c.extracted(id);
    expect((await c.call("A", "POST", `${CBASE}/${id}/extract`)).status).toBe(202);
    expect(await done).toBe("needs_review");
    const [a] = await c.sql<Json[]>`select a.engine_run_id::text as run
      from contracts.approvals a join contracts.contracts k on k.run_id = a.id where k.id = ${id}`;
    const run = a?.run as string;
    await waitStatus(c.sql, run, "waiting_review");

    // Xác nhận (s0, người tải) ⇒ bước Kế toán mở
    expect(await c.port.act(caller(PA.A), run, { stage: "s0" }, { result: "pass" })).toBe("ok");
    await waitStatus(c.sql, run, "waiting_review");

    // trưởng Kế toán (T) đọc HĐ + thấy thẻ duyệt có nút
    expect({ t: await status("T", id) }).toEqual({ t: 200 });
    expect((await approval(c, "T", id)).json?.can_act).toBe(true);
    // thành viên Kế toán không phải trưởng phòng (B): không liên quan ⇒ không thấy
    expect([403, 404]).toContain(await status("B", id));
    // tenant khác
    expect([403, 404]).toContain(await status("D", id));
    // Giám đốc chưa tới bước ⇒ chưa thấy
    expect([403, 404]).toContain(await status("H2", id));

    expect((await act(c, "T", id, "approve")).status).toBe(200);
    await waitStatus(c.sql, run, "waiting_review");
    // run tới bước Giám đốc ⇒ H đọc + duyệt; T đã quyết vẫn đọc; B vẫn không
    expect({ h2: await status("H2", id) }).toEqual({ h2: 200 });
    expect((await approval(c, "H2", id)).json?.can_act).toBe(true);
    expect({ t: await status("T", id) }).toEqual({ t: 200 });
    expect([403, 404]).toContain(await status("B", id));
    expect((await act(c, "H2", id, "approve")).status).toBe(200);
    await waitStatus(c.sql, run, "done");
  }, 120_000);
});
