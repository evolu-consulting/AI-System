// CR-105 · pl-seed-sample · quy trình thư viện mẫu "QT thử" (khe `contracts.approval`) CHỈ cho dev/test. = "Quy trình HĐ mặc định"
// (migration hub 0069) + bước "Kế toán duyệt" trỏ phòng theo MÃ (`department_group_key`). Body qua đúng `validateSlotBody` +
// `compileSlotStages` của gói contracts (như khi tạo bằng UI). Có release v1 đã xuất bản; KHÔNG gán tenant nào, KHÔNG làm mặc định
// khe. Idempotent: id cố định + ON CONFLICT DO NOTHING. Chặn production ở `libSampleEnabled` (và `hub:seed` prod không bật fixtures).
import {
  compileSlotStages,
  type SlotFlowBody,
  validateSlotBody,
} from "../packs/contracts/domain/approval-slot.rules";
import { defaultSlotBody } from "../packs/contracts/domain/approval-slot-default.rules";
import type { Tx } from "./seed.repo";

export const LIBRARY_SAMPLE = {
  id: "0c105000-0000-4000-8000-000000000105",
  key: "qt-thu",
  name: "QT thử",
  slot: "contracts.approval",
  accountingGroupKey: "pb-ke-toan",
} as const;

/** Chỉ khi bật fixtures VÀ không phải production (hai lớp chặn: `deploy/prod-sohoptac2/setup.sh` không đặt HUB_SEED_FIXTURES). */
export const libSampleEnabled = (appEnv: string, fixtures: boolean): boolean =>
  fixtures && appEnv !== "production";

export function librarySampleBody(): SlotFlowBody {
  const base = defaultSlotBody();
  const first = base.steps[0];
  if (first?.kind !== "review") throw new Error("library-sample-base");
  const accounting = {
    ...first,
    key: "accounting",
    name: "Kế toán duyệt",
    exclude_starter: false,
    when: null,
    department_group_id: null,
    department_group_key: LIBRARY_SAMPLE.accountingGroupKey,
  };
  const body: SlotFlowBody = { steps: [...base.steps, accounting] };
  const issues = validateSlotBody(body);
  if (issues.length) throw new Error(`library-sample-invalid: ${JSON.stringify(issues)}`);
  return body;
}

/** Ghi def + release v1; trả true nếu vừa tạo mới. Số câu SQL cố định (2). */
export async function writeLibrarySample(tx: Tx): Promise<boolean> {
  const body = librarySampleBody();
  const stages = tx.json(compileSlotStages(body) as unknown as Parameters<typeof tx.json>[0]);
  const slotBody = tx.json(body as unknown as Parameters<typeof tx.json>[0]);
  const s = LIBRARY_SAMPLE;
  const ins =
    await tx`insert into hub.process_defs (id, tenant_id, key, name, description, input_hint, run_group_ids, stages,
      token_budget, enabled, sources, inputs, slot, slot_body, published_version)
    values (${s.id}, null, ${s.key}, ${s.name}, 'Mẫu thử (dev/test): duyệt HĐ mặc định + Kế toán duyệt.', 'Mã hợp đồng',
      '{}'::uuid[], ${stages}::jsonb, null, true, '[]'::jsonb,
      '[{"key":"contract-id","label":"Hợp đồng","type":"text","required":true}]'::jsonb, ${s.slot}, ${slotBody}::jsonb, 1)
    on conflict (id) do nothing returning id`;
  await tx`insert into hub.process_def_releases (def_id, rel_version, name, stages, slot_body, note)
    values (${s.id}, 1, ${s.name}, ${stages}::jsonb, ${slotBody}::jsonb, 'seed dev')
    on conflict (def_id, rel_version) do nothing`;
  return ins.length > 0;
}
