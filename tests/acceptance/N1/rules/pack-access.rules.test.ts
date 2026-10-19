// PK-FR-05 · PK-AC05 · PK-AC06 · plan §5: luật thuần `checkPackAccess` (apps/hub-api/.../kit/domain/pack-access.rules.ts).
// "!entitled(read) || featureOff ⇒ PACK_DISABLED; grantedGroupIds(action) ∩ userGroupIds = ∅ ⇒ PACK_FORBIDDEN; còn lại ok".
// `packActionsFor` chưa có chữ ký trong plan ("…") ⇒ test qua `/me` ở access.int.test.ts (Cần bổ sung #3).
import { describe, expect, it } from "bun:test";
import { loadPackAccessRules } from "../_support/load";

const G1 = "a5e10000-0000-4000-8000-0000000000a1";
const G2 = "a5e10000-0000-4000-8000-0000000000a2";
const G3 = "a5e10000-0000-4000-8000-0000000000a3";
const base = {
  entitled: true,
  featureOff: false,
  userGroupIds: new Set([G1]),
  grantedGroupIds: [G1, G2],
};
const rules = () => loadPackAccessRules();

describe("PK-FR-05 · checkPackAccess", () => {
  it("PK-FR-05 · đã bật, user thuộc Group được cấp ⇒ ok", async () => {
    const { checkPackAccess } = await rules();
    expect(checkPackAccess(base)).toBe("ok");
  });
  it("PK-AC06 · chưa có entitlement `read` còn hiệu lực ⇒ PACK_DISABLED (kể cả khi user có Group)", async () => {
    const { checkPackAccess } = await rules();
    expect(checkPackAccess({ ...base, entitled: false })).toBe("PACK_DISABLED");
  });
  it("PK-AC06 · feature status='off' ⇒ PACK_DISABLED", async () => {
    const { checkPackAccess } = await rules();
    expect(checkPackAccess({ ...base, featureOff: true })).toBe("PACK_DISABLED");
  });
  it("PK-AC05 · đã bật nhưng user không thuộc Group nào được cấp ⇒ PACK_FORBIDDEN", async () => {
    const { checkPackAccess } = await rules();
    expect(checkPackAccess({ ...base, userGroupIds: new Set([G3]) })).toBe("PACK_FORBIDDEN");
    expect(checkPackAccess({ ...base, userGroupIds: new Set() })).toBe("PACK_FORBIDDEN");
  });
  it("PK-AC05 · không Group nào được cấp mã đó ⇒ PACK_FORBIDDEN", async () => {
    const { checkPackAccess } = await rules();
    expect(checkPackAccess({ ...base, grantedGroupIds: [] })).toBe("PACK_FORBIDDEN");
  });
  it("PK-FR-05 · ưu tiên: DISABLED thắng FORBIDDEN (chưa bật + không Group ⇒ DISABLED)", async () => {
    const { checkPackAccess } = await rules();
    expect(checkPackAccess({ ...base, entitled: false, userGroupIds: new Set() })).toBe(
      "PACK_DISABLED",
    );
    expect(checkPackAccess({ ...base, featureOff: true, userGroupIds: new Set() })).toBe(
      "PACK_DISABLED",
    );
  });
  it("PK-FR-05 · giao khác rỗng ở BẤT KỲ Group nào ⇒ ok (hợp các Group)", async () => {
    const { checkPackAccess } = await rules();
    expect(checkPackAccess({ ...base, userGroupIds: new Set([G3, G2]) })).toBe("ok");
  });
  it("PK-FR-05 · thuần: không đổi đầu vào (Set/mảng giữ nguyên)", async () => {
    const { checkPackAccess } = await rules();
    const inp = { ...base, userGroupIds: new Set([G1]), grantedGroupIds: [G1, G2] };
    checkPackAccess(inp);
    expect({ u: [...inp.userGroupIds], g: inp.grantedGroupIds }).toEqual({ u: [G1], g: [G1, G2] });
  });
});
