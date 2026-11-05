// CR-121 F-2 · e2e D-5 ca 7: platform_admin mở "Chi tiết lượt chạy" của lượt duyệt HĐ công ty 1 (quy trình thư viện gán qua service routing,
// luật mặc định source 'admin', engine chạy lượt duyệt) ⇒ 200. Gốc lỗi: thẻ duyệt có `run_id` = id lượt duyệt của GÓI (contracts.approvals),
// KHÔNG phải `hub.process_runs.id` ⇒ `/process-runs/<run_id>/detail` 404. Thẻ nay trả thêm `engine_run_id` = id lượt engine (đích đúng).
// Không nới quyền: tenant_admin công ty khác vẫn 404 (kể cả gửi `?tenant_id` của công ty này).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { RunDetailSchema } from "@ai/contracts/chat";
import { ContractApprovalSchema } from "@ai/contracts/pack-contracts";
import {
  APPROVAL_SLOT,
  compileSlotStages,
} from "../../../apps/hub-api/src/modules/packs/contracts/domain/approval-slot.rules";
import { approval, groupId, seedContract, toLevel1 } from "../HD3/_hd3";
import { type Json, T } from "../P-d/_support/pd";
import { type CtxCf, startCf } from "./_cf";

let c: CtxCf;
beforeAll(async () => {
  c = await startCf();
}, 180_000);
afterAll(async () => {
  await c?.stop();
});

/** Quy trình thư viện đã xuất bản của khe duyệt HĐ (một bước), CHƯA gán cho công ty nào. */
async function libDef(key: string, name: string): Promise<string> {
  const [kO] = await c.sql<
    { key: string }[]
  >`select key from admin.groups where id = ${await groupId(c, "owner")}`;
  const body = {
    steps: [
      {
        kind: "review",
        key: "kt",
        name,
        department_group_id: null,
        department_group_key: kO?.key,
        head_only: false,
        due_h: 48,
        remind_every_h: null,
        escalate_group_id: null,
        exclude_starter: false,
        when: null,
      },
    ],
  };
  const stages = compileSlotStages(body);
  const [d] = await c.sql<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, slot, slot_body, published_version)
    values (null, ${key}, ${name}, ${JSON.stringify(stages)}::text::jsonb, ${APPROVAL_SLOT},
      ${JSON.stringify(body)}::text::jsonb, 1) returning id::text as id`;
  const id = d?.id as string;
  await c.sql`insert into hub.process_def_releases (def_id, rel_version, name, stages, slot_body)
    values (${id}, 1, ${name}, ${JSON.stringify(stages)}::text::jsonb, ${JSON.stringify(body)}::text::jsonb)`;
  return id;
}

describe("CR-121 F-2 · chi tiết lượt chạy của lượt duyệt HĐ (quy trình thư viện đã gán)", () => {
  it("F-2 · thẻ duyệt trả engine_run_id nên platform_admin mở được chi tiết, tenant_admin công ty khác 404", async () => {
    const def = await libDef("cf-f2-lib", "F2 Duyệt thư viện");
    const assign = await c.call(
      "P",
      "PUT",
      `/tenants/${T.acme}/process-routing/${APPROVAL_SLOT}/processes/${def}`,
    );
    expect(assign.status).toBe(200);
    const id = await seedContract(c, 741);
    const { runId: approvalId } = await toLevel1(c, id, 10_000_000);

    const card = ContractApprovalSchema.parse((await approval(c, "A", id)).json);
    const [row] = await c.sql<Json[]>`select engine_run_id::text as e, mode from contracts.approvals
      where id = ${approvalId}`;
    expect(row?.mode).toBe("engine");
    expect(card.run_id).toBe(approvalId);
    expect(card.engine_run_id).toBe(row?.e as string);
    expect(card.engine_run_id).not.toBe(card.run_id);

    const asT = `?tenant_id=${T.acme}`;
    const ok = await c.call("P", "GET", `/process-runs/${card.engine_run_id}/detail${asT}`);
    expect(ok.status).toBe(200);
    expect(RunDetailSchema.parse(ok.json).id).toBe(card.engine_run_id as string);
    // id lượt duyệt của gói (run_id) không là lượt engine ⇒ 404 (đúng: không phải lỗi quyền/def).
    expect((await c.call("P", "GET", `/process-runs/${approvalId}/detail${asT}`)).status).toBe(404);

    // Không nới quyền: tenant_admin công ty khác ⇒ 404 (cả khi gửi ?tenant_id của công ty này — bị bỏ qua với vai không phải platform_admin).
    for (const q of ["", asT]) {
      const r = await c.call("Db", "GET", `/process-runs/${card.engine_run_id}/detail${q}`);
      expect({ q, status: r.status }).toEqual({ q, status: 404 });
    }
  }, 120_000);
});
