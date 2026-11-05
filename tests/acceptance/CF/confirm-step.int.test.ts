// e2e-journey-approval · "Xác nhận và lưu" thuộc người tải HĐ lên, KHÔNG phải bước của quy trình: quy trình thư viện chỉ khai các bước DUYỆT
// (không có nhóm sửa ở đầu) ⇒ gói tự thêm bước xác nhận (nhóm sửa) ở đầu lượt; người tải xác nhận (Đạt s0) ⇒ bước duyệt đầu của quy trình mở.
// Xác nhận lần hai không tạo gì thêm (một run, bước duyệt vẫn mở đúng một lần). Hub THẬT, model giả.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  APPROVAL_SLOT,
  compileSlotStages,
} from "../../../apps/hub-api/src/modules/packs/contracts/domain/approval-slot.rules";
import { setSlotDefault } from "../../../apps/hub-api/src/test-support/slot-default";
import { groupId, seedContract, toLevel1 } from "../HD3/_hd3";
import { type Json, PA, T, waitStatus } from "../P-d/_support/pd";
import { type CtxCf, caller, startCf } from "./_cf";

let c: CtxCf;
beforeAll(async () => {
  c = await startCf();
}, 180_000);
afterAll(async () => {
  await c?.stop();
});

const rv = (key: string, name: string, dept: string): Json => ({
  kind: "review",
  key,
  name,
  department_group_id: null,
  department_group_key: dept,
  head_only: false,
  due_h: 48,
  remind_every_h: null,
  escalate_group_id: null,
  exclude_starter: false,
  when: null,
});

/** Quy trình thư viện CHỈ có hai bước duyệt (owner ⇒ editor-không-phải-nhóm-đầu); gán làm mặc định của tenant. */
async function assignApprovalOnly(): Promise<void> {
  const [kO] = await c.sql<
    { key: string }[]
  >`select key from admin.groups where id = ${await groupId(c, "owner")}`;
  const body = {
    steps: [
      rv("kt", "Kế toán duyệt", kO?.key as string),
      rv("gd", "Giám đốc duyệt", kO?.key as string),
    ],
  };
  const stages = compileSlotStages(body);
  const [d] = await c.sql<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, slot, slot_body, published_version)
    values (null, 'cf-confirm-step', 'Chỉ bước duyệt', ${JSON.stringify(stages)}::text::jsonb, ${APPROVAL_SLOT},
      ${JSON.stringify(body)}::text::jsonb, 1) returning id::text as id`;
  const id = d?.id as string;
  await c.sql`insert into hub.process_def_releases (def_id, rel_version, name, stages, slot_body)
    values (${id}, 1, 'Chỉ bước duyệt', ${JSON.stringify(stages)}::text::jsonb, ${JSON.stringify(body)}::text::jsonb)`;
  await setSlotDefault(c.sql, T.acme, APPROVAL_SLOT, id);
}

describe("confirm-step · người tải xác nhận trước, rồi tới bước duyệt đầu của quy trình", () => {
  it("quy trình chỉ có bước duyệt ⇒ s0 = Xác nhận (nhóm sửa); A xác nhận hai lần ⇒ MỘT run, bước 'Kế toán duyệt' mở, không mở lại", async () => {
    await assignApprovalOnly();
    const id = await seedContract(c, 741);
    const aid = (await toLevel1(c, id, 10_000_000)).runId;
    const [a] = await c.sql<
      Json[]
    >`select engine_run_id::text as run, mode from contracts.approvals where id = ${aid}`;
    expect(a?.mode).toBe("engine");
    const run = a?.run as string;
    await waitStatus(c.sql, run, "waiting_review");
    const before = await c.port.stepsView(caller(PA.A), run);
    expect(before?.steps.filter((s) => s.key.startsWith("s")).map((s) => s.key)).toEqual([
      "s0",
      "s1",
      "s2",
    ]); // s0 = Xác nhận do gói thêm; s1/s2 = Kế toán/Giám đốc của quy trình
    expect(before?.steps[0]?.status).toBe("open");

    expect(await c.port.act(caller(PA.A), run, { stage: "s0" }, { result: "pass" })).toBe("ok");
    expect(await c.port.act(caller(PA.A), run, { stage: "s0" }, { result: "pass" })).not.toBe("ok");
    await waitStatus(c.sql, run, "waiting_review");
    const after = await c.port.stepsView(caller(PA.H), run);
    expect(after?.steps.filter((s) => /^s\d$/.test(s.key)).map((s) => [s.key, s.status])).toEqual([
      ["s0", "passed"],
      ["s1", "open"],
      ["s2", "pending"],
    ]);
    const [n] = await c.sql<
      { n: number }[]
    >`select count(*)::int as n from contracts.approvals where contract_id = ${id}`;
    expect(n?.n).toBe(1);
  }, 120_000);
});
