// ADM-FR-24 · M3-R14 · contract `CommandAccessItem` có `groups`, `group_count`, `visible_user_count`
// (spec M3 §3 "Commands"; test-plan R1c). Xanh ở T6 (commands.ts đổi ở T6). Trước đó đỏ vì chưa có code.
import { describe, expect, it } from "bun:test";
import { CommandAccessItemSchema } from "@ai/contracts";

const U = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const feat = { id: U(9), key: "ke-toan", name: { vi: "Kế toán" } };
const item = (groups: unknown[], extra: Record<string, unknown> = {}) => ({
  tenant_id: U(1),
  tenant_key: "acme",
  tenant_name: "Acme Corp",
  tenant_active: true,
  features: [feat],
  active_user_count: 6,
  groups,
  group_count: groups.length,
  visible_user_count: 2,
  ...extra,
});
const g = (i: number) => ({
  id: U(100 + i),
  key: `nhom-${i}`,
  name: { vi: `Nhóm ${i}` },
  is_beta: false,
  feature: feat,
});
const ok = (r: { success: boolean }) => r.success;

describe("ADM-FR-24 · CommandAccessItem (M3-R14)", () => {
  it("ADM-FR-24 · M3-R14 · có groups ≤ 20 (21 fail; mỗi mục kèm feature {id,key,name}), group_count, visible_user_count", () => {
    expect(ok(CommandAccessItemSchema.safeParse(item([])))).toBe(true);
    expect(
      ok(CommandAccessItemSchema.safeParse(item(Array.from({ length: 20 }, (_, i) => g(i))))),
    ).toBe(true);
    expect(
      ok(CommandAccessItemSchema.safeParse(item(Array.from({ length: 21 }, (_, i) => g(i))))),
    ).toBe(false);
    const { feature: _f, ...noFeature } = g(1);
    expect(ok(CommandAccessItemSchema.safeParse(item([noFeature])))).toBe(false);
  });

  it("ADM-FR-24 · M3-R14 · active_user_count giữ nghĩa M2; thiếu visible_user_count/group_count fail; khoá lạ fail", () => {
    const { visible_user_count: _v, ...noVisible } = item([]);
    const { group_count: _c, ...noCount } = item([]);
    expect(ok(CommandAccessItemSchema.safeParse(noVisible))).toBe(false);
    expect(ok(CommandAccessItemSchema.safeParse(noCount))).toBe(false);
    expect(ok(CommandAccessItemSchema.safeParse(item([], { extra: 1 })))).toBe(false);
    expect(CommandAccessItemSchema.parse(item([])).active_user_count).toBe(6);
  });
});
