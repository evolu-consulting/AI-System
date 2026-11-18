// CR-182 · R2 · `withRoles` thuần: điền người theo vai; vai chưa giao ⇒ trống + unassigned.
import { describe, expect, it } from "bun:test";
import { hasSignerRole, roleKeysOf, signerRoleOf, withRoles } from "./with-roles";

const G1 = "11111111-1111-4111-8111-111111111111";
const G2 = "22222222-2222-4222-8222-222222222222";
const U1 = "33333333-3333-4333-8333-333333333333";
const role = (key: string, label = key) => ({ key, label });
const review = (extra: Record<string, unknown>) => ({
  name: "Duyệt",
  after: { kind: "review", group_id: null, ...extra },
});
const sign = (extra: Record<string, unknown> = {}) => ({
  name: "Ký",
  executor: {
    kind: "tool",
    tool_key: "contracts-esign-send",
    args: { signer_role: { from: "const", value: "nguoi-ky" }, ...extra },
  },
});
type Obj = Record<string, unknown>;
const afterOf = (s: unknown) => (s as { after: Obj }).after;
const argsOf = (s: unknown) => (s as { executor: { args: Obj } }).executor.args;

describe("withRoles", () => {
  it("review: giao nhóm ⇒ group_id, giao người ⇒ approver_user_id, bỏ mã cũ", () => {
    const st = [review({ role: role("cap-1"), group_key: "old" })];
    const g = withRoles(st, [{ role_key: "cap-1", group_id: G1, user_id: null }]);
    expect(afterOf(g.stages[0])).toMatchObject({ group_id: G1 });
    expect(afterOf(g.stages[0]).group_key).toBeUndefined();
    expect(g.unassigned).toEqual([]);
    const u = withRoles(st, [{ role_key: "cap-1", group_id: null, user_id: U1 }]);
    expect(afterOf(u.stages[0])).toMatchObject({ group_id: null, approver_user_id: U1 });
  });

  it("review: vai chưa giao ⇒ trống + unassigned chặn; không đổi mảng vào", () => {
    const st = [review({ role: role("cap-1", "Duyệt cấp 1"), approver_user_id: U1 })];
    const o = withRoles(st, []);
    expect(afterOf(o.stages[0])).toMatchObject({ group_id: null });
    expect(afterOf(o.stages[0]).approver_user_id).toBeUndefined();
    expect(o.unassigned).toEqual([
      { stage: 0, slot: "review", role_key: "cap-1", label: "Duyệt cấp 1", blocking: true },
    ]);
    expect(afterOf(st[0]).approver_user_id).toBe(U1);
  });

  it("parallel: mỗi nhóm theo vai riêng; người không dùng được ⇒ unassigned", () => {
    const st = [
      review({
        parallel: {
          rule: "all",
          groups: [
            { label: "A", role: role("a") },
            { label: "B", role: role("b") },
            { label: "C", group_id: G2 },
          ],
        },
      }),
    ];
    const o = withRoles(st, [
      { role_key: "a", group_id: G1, user_id: null },
      { role_key: "b", group_id: null, user_id: U1 },
    ]);
    const gs = (afterOf(o.stages[0]).parallel as { groups: Obj[] }).groups;
    expect(gs[0]).toMatchObject({ group_id: G1 });
    expect(gs[1]).toMatchObject({ group_id: null });
    expect(gs[2]).toMatchObject({ group_id: G2 });
    expect(o.unassigned.map((x) => [x.slot, x.role_key])).toEqual([["parallel", "b"]]);
  });

  it("escalate: giao nhóm/người; chưa giao ⇒ null và KHÔNG chặn", () => {
    const st = [review({ escalate: { after_h: 4, role: role("tp") } })];
    expect(
      afterOf(withRoles(st, [{ role_key: "tp", group_id: G1, user_id: null }]).stages[0]).escalate,
    ).toEqual({ after_h: 4, role: role("tp"), group_id: G1 });
    expect(
      afterOf(withRoles(st, [{ role_key: "tp", group_id: null, user_id: U1 }]).stages[0]).escalate,
    ).toMatchObject({ user_id: U1 });
    const o = withRoles(st, []);
    expect(afterOf(o.stages[0]).escalate).toBeNull();
    expect(o.unassigned[0]).toMatchObject({ slot: "escalate", blocking: false });
  });

  it("Ký: signer_role ⇒ args.company_signers (nhóm hoặc người); chưa giao ⇒ gỡ company_signers cũ", () => {
    const st = [sign({ company_signers: { from: "const", value: `user:${U1}` } })];
    const g = withRoles(st, [{ role_key: "nguoi-ky", group_id: G1, user_id: null }]);
    expect(argsOf(g.stages[0]).company_signers).toEqual({ from: "const", value: `group:${G1}` });
    const u = withRoles(st, [{ role_key: "nguoi-ky", group_id: null, user_id: U1 }]);
    expect(argsOf(u.stages[0]).company_signers).toEqual({ from: "const", value: `user:${U1}` });
    const n = withRoles(st, []);
    expect(argsOf(n.stages[0]).company_signers).toBeUndefined();
    expect(n.unassigned).toMatchObject([{ slot: "sign", role_key: "nguoi-ky", blocking: true }]);
  });

  it("stage không có vai giữ nguyên (cùng tham chiếu); một vai nhiều bước giao một lần", () => {
    const plain = review({ group_id: G2 });
    const o = withRoles(
      [plain, review({ role: role("x") }), review({ role: role("x") }), sign()],
      [{ role_key: "x", group_id: G1, user_id: null }],
    );
    expect(o.stages[0]).toBe(plain);
    expect(afterOf(o.stages[1]).group_id).toBe(G1);
    expect(afterOf(o.stages[2]).group_id).toBe(G1);
    expect(o.unassigned.map((x) => x.role_key)).toEqual(["nguoi-ky"]);
  });

  it("roleKeysOf / signerRoleOf", () => {
    const st = [
      review({ role: role("a"), escalate: { after_h: 1, role: role("b") } }),
      sign(),
      { name: "x" },
    ];
    expect(roleKeysOf(st)).toEqual(["a", "b", "nguoi-ky"]);
    expect(signerRoleOf(st[1])).toBe("nguoi-ky");
    expect(signerRoleOf(st[0])).toBeNull();
  });
});

describe("withRoles · công tắc lùi ondoc (CR-182 R3)", () => {
  const legacy = {
    provider: { from: "const", value: "docusign" },
    company_signers: { from: "const", value: `user:${U1}` },
  };
  const asg = [{ role_key: "nguoi-ky", group_id: G1, user_id: null }];
  it("ondoc=false (công ty TẮT) ⇒ giữ provider cũ; ondoc=true (BẬT) ⇒ provider = ondoc, người ký từ vai", () => {
    const off = withRoles([sign(legacy)], asg, { ondoc: false });
    expect(argsOf(off.stages[0]).provider).toEqual({ from: "const", value: "docusign" });
    const on = withRoles([sign(legacy)], asg, { ondoc: true });
    expect(argsOf(on.stages[0]).provider).toEqual({ from: "const", value: "ondoc" });
    expect(argsOf(on.stages[0]).company_signers).toEqual({ from: "const", value: `group:${G1}` });
  });
  it("vai chưa giao ⇒ không đặt ondoc (lượt bị chặn); bước Ký không có vai ⇒ không đổi", () => {
    const n = withRoles([sign(legacy)], [], { ondoc: true });
    expect(argsOf(n.stages[0]).provider).toEqual({ from: "const", value: "docusign" });
    const plain = {
      name: "Ký",
      executor: { kind: "tool", tool_key: "contracts-esign-send", args: legacy },
    };
    expect(withRoles([plain], asg, { ondoc: true }).stages[0]).toBe(plain);
    expect(hasSignerRole([plain])).toBe(false);
    expect(hasSignerRole([sign()])).toBe(true);
  });
});
