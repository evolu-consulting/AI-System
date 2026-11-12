// CHỈ CHO TEST (CR-127 Z3d-2): khe mẫu cho các int kiểm CƠ CHẾ CHUNG của thư viện/định tuyến/gán khe (không riêng HĐ). Dùng khe
// Community còn sống `community.post-moderation` + mẫu mặc định do hub 0092 gieo (id cố định, đã xuất bản v1) — thay cho khe duyệt HĐ cũ.

import type { Sql } from "@ai/test-kit/db";
import { communitySlotSpecs } from "../../packs/community/public";
import { slotRegistry } from "../../packs/kit/public";

export const GEN_SLOT = "community.post-moderation";
export const GEN_PACK = "community";
export const GEN_FEATURE = "community-read";
export const GEN_DEFAULT_ID = "0c120000-0000-4000-8000-000000000921";
export const GEN_DEFAULT_KEY = "community-post-moderation";

/** Đăng ký 3 khe Community (như `community.mount`) vào registry của tiến trình test. */
export function registerCommunitySlots(): void {
  for (const s of communitySlotSpecs()) slotRegistry.register(s);
}

/** Catalog tool giả cho 3 khe Community (tên = `systemTools` của khe; tham số = input bắt buộc của khe) — int dựng `PackToolCatalog` từ đây. */
export const communityToolInfos = communitySlotSpecs().flatMap((s) =>
  s.systemTools.map((name) => ({
    name,
    description: `Công cụ ${name}`,
    action: "write" as const,
    params: s.requiredInputs.map((r) => ({
      name: r.replaceAll("-", "_"),
      type: "text",
      required: true,
      description: r,
    })),
  })),
);

/** Body mặc định của khe `community.post-moderation` (đúng `slot_body` hub 0092), bước đầu mang tên `Kiểm tra <tag>` để phân biệt bản. */
export function genSlotBody(tag?: string): { steps: Record<string, unknown>[] } {
  const steps: Record<string, unknown>[] = [
    { key: "screen", kind: "agent", name: "Agent sàng lọc", agent_key: "community-screen" },
    {
      key: "review",
      kind: "review",
      name: "Quản trị duyệt bài",
      group_key: "community-admin",
      remind_every_h: 24,
      escalate_after_h: 48,
    },
    { key: "publish", kind: "set", name: "Đăng bài" },
  ];
  if (tag) (steps[0] as { name: string }).name = `Kiểm tra ${tag}`;
  return { steps };
}

/** Khe thường (không opt-in) còn sống: `contracts.intake` + mẫu mặc định hub 0093 — cho int phụ thuộc "khe luôn bật" (bỏ gán mặc định ⇒ 409). */
export const INTAKE_SLOT = "contracts.intake";
export const INTAKE_DEFAULT_ID = "0c120000-0000-4000-8000-000000000093";

/** Hub 0136 lưu trữ mẫu `hd-nhan-hop-dong` và gỡ dòng khe ⇒ int cần "khe thường có mặc định sống" dựng lại trong DB test (không ảnh hưởng prod). */
export async function reviveIntakeDefault(o: Sql): Promise<void> {
  await o`update hub.process_defs set deleted_at = null, enabled = true where id = ${INTAKE_DEFAULT_ID}`;
  await o`insert into hub.process_slots (slot, default_def_id) values (${INTAKE_SLOT}, ${INTAKE_DEFAULT_ID})
    on conflict (slot) do update set default_def_id = excluded.default_def_id`;
}
