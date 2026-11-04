// dlc-step-library · luật thuần của thư viện bước DLC: phần audit (trường nghiệp vụ, không lời dặn dài) + mục audit của một thao tác.
export const DLC_STEP_ENTITY = "dlc_step_template";

export type DlcStepFields = {
  key: string;
  name: string;
  action: string;
  agent_key: string | null;
  instruction: string;
  gate_group: string | null;
  reject_to: string | null;
  max_rounds: number;
  timeout_min: number;
};

/** Ảnh trường cho audit: `instruction` chỉ ghi độ dài (có thể tới 8000 ký tự). */
export function auditFields(s: DlcStepFields): Record<string, unknown> {
  const { instruction, ...rest } = s;
  return { ...rest, instruction_len: instruction.length };
}

/** Mục audit của tạo / sửa / xoá một mẫu (`before`/`after` null theo thao tác). */
export function dlcStepAudit(
  action: "create" | "update" | "delete",
  row: { id: string } & DlcStepFields,
  before: DlcStepFields | null,
) {
  const after = action === "delete" ? null : auditFields(row);
  return {
    tenantId: null,
    action,
    entity: DLC_STEP_ENTITY,
    entityId: row.id,
    entityName: row.key,
    before: before ? auditFields(before) : null,
    after,
    summary: { key: row.key, name: row.name, action: row.action },
  } as const;
}
