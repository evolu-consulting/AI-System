// CR-127 · E3 · spec §5.2 · luật thuần uỷ quyền.
import { describe, expect, it } from "bun:test";
import {
  type DelegationRow,
  delegationCheck,
  delegationKindsFor,
  mayViewDelegation,
  resolveDelegate,
  soleStarterTargets,
} from "./delegation.rules";

const d = (o: Partial<DelegationRow> = {}): DelegationRow => ({
  fromUserId: "A",
  toUserId: "B",
  fromAt: new Date("2026-11-10T00:00:00Z"),
  toAt: new Date("2026-11-20T00:00:00Z"),
  kinds: ["approve"],
  revokedAt: null,
  ...o,
});
const IN = new Date("2026-11-12T00:00:00Z");
const OUT = new Date("2026-11-21T00:00:00Z");
const member = { userId: "A", role: "member" as const };

describe("CR-127 E3 · resolveDelegate", () => {
  it("trong khoảng, đúng loại ⇒ B; ngoài khoảng / huỷ / sai loại ⇒ null", () => {
    expect(resolveDelegate("A", "review", IN, [d()], { starterId: "S" })).toBe("B");
    expect(resolveDelegate("A", "review", OUT, [d()], { starterId: "S" })).toBeNull();
    expect(
      resolveDelegate("A", "review", IN, [d({ revokedAt: IN })], { starterId: "S" }),
    ).toBeNull();
    expect(resolveDelegate("A", "milestone", IN, [d()], { starterId: "S" })).toBeNull();
    expect(
      resolveDelegate("A", "milestone", IN, [d({ kinds: ["milestone"] })], { starterId: null }),
    ).toBe("B");
  });
  it("hỏi/quyết định không áp; B là người gửi ⇒ không áp (R#15)", () => {
    expect(resolveDelegate("A", "ask", IN, [d()], { starterId: null })).toBeNull();
    expect(resolveDelegate("A", "decision", IN, [d()], { starterId: null })).toBeNull();
    expect(resolveDelegate("A", "review", IN, [d()], { starterId: "B" })).toBeNull();
  });
  it("nhiều bản ⇒ bản bắt đầu muộn nhất; bước form dùng loại form", () => {
    const late = d({ toUserId: "C", fromAt: new Date("2026-11-11T00:00:00Z") });
    expect(resolveDelegate("A", "review", IN, [d(), late], { starterId: null })).toBe("C");
    expect(delegationKindsFor("review")).toEqual(["approve", "form"]);
  });
});

describe("CR-127 E3 · delegationCheck", () => {
  const base = { actor: member, headsOfFrom: [], existing: [], toIsSigner: false };
  it("SELF · FORBIDDEN (đặt thay khi không phải trưởng phòng/quản trị) · ok", () => {
    expect(delegationCheck(d({ toUserId: "A" }), base)).toBe("DELEGATE_SELF");
    expect(delegationCheck(d({ fromUserId: "X" }), base)).toBe("DELEGATE_FORBIDDEN");
    expect(delegationCheck(d({ fromUserId: "X" }), { ...base, headsOfFrom: ["A"] })).toBe("ok");
    expect(
      delegationCheck(d({ fromUserId: "X" }), {
        ...base,
        actor: { userId: "A", role: "tenant_admin" },
      }),
    ).toBe("ok");
    expect(delegationCheck(d(), base)).toBe("ok");
  });
  it("CHAIN: B đang uỷ quyền tiếp / A đang làm thay — chỉ khi khoảng chồng", () => {
    expect(
      delegationCheck(d(), { ...base, existing: [d({ fromUserId: "B", toUserId: "C" })] }),
    ).toBe("DELEGATE_CHAIN");
    expect(
      delegationCheck(d(), { ...base, existing: [d({ fromUserId: "Z", toUserId: "A" })] }),
    ).toBe("DELEGATE_CHAIN");
    const later = d({
      fromUserId: "B",
      toUserId: "C",
      fromAt: new Date("2026-12-01T00:00:00Z"),
      toAt: new Date("2026-12-05T00:00:00Z"),
    });
    expect(delegationCheck(d(), { ...base, existing: [later] })).toBe("ok");
  });
  it("NOT_SIGNER: ký số chỉ cho người thuộc nhóm Người ký HĐ", () => {
    expect(delegationCheck(d({ kinds: ["esign"] }), base)).toBe("DELEGATE_NOT_SIGNER");
    expect(delegationCheck(d({ kinds: ["esign"] }), { ...base, toIsSigner: true })).toBe("ok");
  });
  it("R#43 · ai xem: from/to, quản trị, trưởng phòng của A", () => {
    expect(mayViewDelegation({ userId: "B", role: "member" }, d(), [])).toBe(true);
    expect(mayViewDelegation({ userId: "X", role: "member" }, d(), [])).toBe(false);
    expect(mayViewDelegation({ userId: "H", role: "member" }, d(), ["H"])).toBe(true);
    expect(mayViewDelegation({ userId: "X", role: "tenant_admin" }, d(), [])).toBe(true);
  });
});

describe("CR-127 E3b · R#15 soleStarterTargets", () => {
  const esc = { userId: null, groupId: null, adminIds: ["TA", "S"] };
  it("không phải người gửi duy nhất ⇒ null", () => {
    expect(soleStarterTargets({ gate: "H", soleUser: null, starter: "S" }, esc)).toBeNull();
    expect(soleStarterTargets({ gate: null, soleUser: "A", starter: "S" }, esc)).toBeNull();
  });
  it("người > nhóm > quản trị công ty (bỏ người gửi)", () => {
    const sole = { gate: "S", soleUser: null, starter: "S" };
    expect(soleStarterTargets(sole, { ...esc, userId: "X", groupId: "G" })).toEqual({
      userIds: ["X"],
      groupId: null,
    });
    expect(soleStarterTargets(sole, { ...esc, groupId: "G" })).toEqual({
      userIds: [],
      groupId: "G",
    });
    expect(soleStarterTargets({ gate: null, soleUser: "S", starter: "S" }, esc)).toEqual({
      userIds: ["TA"],
      groupId: null,
    });
    expect(soleStarterTargets(sole, { ...esc, adminIds: ["S"] })).toBeNull();
  });
});
