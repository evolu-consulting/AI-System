// CR-127 · E7 · BR-17 · unit "Chạy thử": đường đi theo dữ kiện (node Nếu), người sẽ nhận việc, cảnh báo, đóng vai (canAct), 4 trường hợp.
import { describe, expect, it } from "bun:test";
import type { ProcessStageDef } from "@ai/contracts/hub-admin";
import type { DelegationRow } from "../tasks/delegation.rules";
import type { World } from "./flow-preview.rules";
import { factsFor, scenariosOf, valueFor } from "./flow-preview.scenarios";
import { type Decision, type PreviewInput, stepsWithoutEnd, walkFlow } from "./flow-preview.walk";

const T = "11111111-0000-4000-8000-000000000001";
const U = (n: number) => `22222222-0000-4000-8000-00000000000${n}`;
const [STARTER, HEAD, L1, L2, ADMIN, DEL] = [U(1), U(2), U(3), U(4), U(5), U(6)];
const [G_KD, G_KT, G_ESC] = [
  "33333333-0000-4000-8000-000000000001",
  "33333333-0000-4000-8000-000000000002",
  "33333333-0000-4000-8000-000000000003",
];
const user = (id: string, name: string, usable = true, role = "member") =>
  [id, { id, name, usable, role }] as const;

const world = (over: Partial<World> = {}): World => ({
  tenantId: T,
  users: new Map([
    user(STARTER, "Trần Bình"),
    user(HEAD, "Phạm Cường"),
    user(L1, "Lê Thị Hoa"),
    user(L2, "Phạm Dung"),
    user(ADMIN, "Quản trị", true, "tenant_admin"),
    user(DEL, "Người thay"),
  ]),
  groups: new Map([
    [G_KD, { name: "Phòng KD", memberIds: [STARTER, HEAD], headUserId: HEAD }],
    [G_KT, { name: "Phòng Kế toán", memberIds: [L1, L2], headUserId: null }],
    [G_ESC, { name: "Ban GĐ", memberIds: [ADMIN], headUserId: null }],
  ]),
  adminIds: [ADMIN],
  delegations: [],
  ...over,
});

const stage = (key: string, step: number, executor: object, after: object, more: object = {}) =>
  ({
    key,
    name: key,
    step,
    executor,
    after,
    real_action: false,
    ...more,
  }) as unknown as ProcessStageDef;
const review = (group: string, o: object = {}) => ({ kind: "review", group_id: group, ...o });
const approve = { kind: "approve", reject_step: 6, return_step: 7 };
const END = { kind: "notify" };
const AUTO = { kind: "auto" };
const IF = {
  kind: "if",
  when: {
    op: "and",
    conds: [{ from: { kind: "fact", key: "total_value" }, op: "gt", value: 500_000_000 }],
  },
  then_step: 3,
  else_step: 4,
};
const flow = (kd: object = {}, kt: object = {}): ProcessStageDef[] => [
  stage("start", 0, END, AUTO),
  stage("kd", 1, approve, review(G_KD, { head_only: true, ...kd })),
  stage("ktra", 2, IF, AUTO),
  stage(
    "kt",
    3,
    approve,
    review(G_KT, { escalate: { after_h: 48, group_id: G_ESC }, evidence: "opinion_plus", ...kt }),
  ),
  stage("sign", 4, END, AUTO),
  stage("done", 5, END, AUTO, { outcome: "approved" }),
  stage("rej", 6, END, AUTO, { outcome: "rejected" }),
  stage("ret", 7, END, AUTO, { outcome: "returned" }),
];

const input = (
  stages: ProcessStageDef[],
  facts: PreviewInput["facts"],
  w = world(),
): Omit<PreviewInput, "decisions"> => ({
  stages,
  facts,
  starterId: STARTER,
  at: new Date("2026-11-10T03:00:00Z"),
  world: w,
  factLabels: new Map([["total_value", "Giá trị hợp đồng"]]),
  outcomes: [
    { key: "approved", label: "Đã duyệt", effect: "HĐ → Hoàn tất" },
    { key: "rejected", label: "Từ chối", effect: "HĐ → Từ chối" },
    { key: "returned", label: "Trả lại", effect: "HĐ → Nháp" },
  ],
});
const ok = (r: Decision["result"], k: string, actor?: string): Decision => ({
  step_key: k,
  result: r,
  ...(actor ? { actor_user_id: actor } : {}),
});
const keys = (r: { path: { step_key: string }[] }) => r.path.map((p) => p.step_key);

describe("E7 · đường đi", () => {
  it("lớn hơn ngưỡng ⇒ qua Kế toán; Duyệt hết ⇒ Kết thúc 'approved'", () => {
    const r = walkFlow({
      ...input(flow(), { total_value: 650_000_000 }),
      decisions: [ok("approve", "kd"), ok("approve", "kt")],
    });
    expect(keys(r)).toEqual(["start", "kd", "ktra", "kt", "sign", "done"]);
    expect(r.status).toBe("finished");
    expect(r.outcome?.key).toBe("approved");
    const ifRow = r.path.find((p) => p.step_key === "ktra");
    expect(ifRow?.branch).toBe("then");
    expect(ifRow?.reason).toBe("Giá trị hợp đồng > 500000000 ⇒ Đúng");
  });

  it("nhỏ hơn ngưỡng ⇒ bỏ qua Kế toán (liệt kê ở skipped)", () => {
    const r = walkFlow({
      ...input(flow(), { total_value: 300_000_000 }),
      decisions: [ok("approve", "kd")],
    });
    expect(keys(r)).toEqual(["start", "kd", "ktra", "sign", "done"]);
    expect(r.skipped.map((s) => s.step_key)).toContain("kt");
  });

  it("chưa có quyết định ⇒ dừng chờ ở bước Duyệt, kèm người nhận việc", () => {
    const r = walkFlow({ ...input(flow(), { total_value: 650_000_000 }), decisions: [] });
    expect(r.status).toBe("waiting");
    expect(r.waiting_step).toBe("kd");
    const kd = r.path.at(-1);
    expect(kd?.status).toBe("waiting");
    expect(kd?.review?.need).toBe("head");
    expect(kd?.review?.who).toEqual([{ user_id: HEAD, name: "Phạm Cường", via: "head" }]);
    expect(r.skipped).toEqual([]);
  });

  it("Từ chối / Trả lại đi tới Kết thúc của node Duyệt", () => {
    const base = input(flow(), { total_value: 650_000_000 });
    const rej = walkFlow({ ...base, decisions: [ok("approve", "kd"), ok("reject", "kt")] });
    expect(rej.outcome?.key).toBe("rejected");
    const ret = walkFlow({ ...base, decisions: [ok("return", "kd")] });
    expect(ret.outcome?.key).toBe("returned");
    expect(keys(ret)).toEqual(["start", "kd", "ret"]);
  });

  it("dữ kiện thiếu ⇒ coi như Sai + cảnh báo 'chưa có dữ liệu'", () => {
    const r = walkFlow({ ...input(flow(), {}), decisions: [ok("approve", "kd")] });
    expect(r.path.find((p) => p.step_key === "ktra")?.branch).toBe("else");
    expect(r.path.find((p) => p.step_key === "ktra")?.missing).toEqual(["total_value"]);
    expect(r.warnings.some((w) => w.code === "facts_missing")).toBe(true);
  });

  it("nhánh không tới Kết thúc ⇒ cảnh báo; đủ Kết thúc ⇒ không", () => {
    expect(stepsWithoutEnd(flow())).toEqual([]);
    const cut = flow().filter((s) => s.key !== "done");
    expect(stepsWithoutEnd(cut).length).toBeGreaterThan(0);
  });
});

describe("E7 · người nhận việc + cảnh báo", () => {
  it("việc nhóm: mọi thành viên nhận được, hạn chuyển cấp + bằng chứng", () => {
    const r = walkFlow({
      ...input(flow(), { total_value: 650_000_000 }),
      decisions: [ok("approve", "kd")],
    });
    const kt = r.path.find((p) => p.step_key === "kt")?.review;
    expect(kt?.need).toBe("one");
    expect(kt?.who.map((h) => h.name)).toEqual(["Lê Thị Hoa", "Phạm Dung"]);
    expect(kt?.due_h).toBe(48);
    expect(kt?.evidence).toBe("opinion_plus");
  });

  it("người gửi là trưởng phòng duy nhất (R#15) ⇒ cảnh báo + giao quản trị công ty", () => {
    const w = world({
      groups: new Map([
        [G_KD, { name: "Phòng KD", memberIds: [STARTER], headUserId: STARTER }],
        [G_KT, { name: "KT", memberIds: [L1], headUserId: null }],
      ]),
    });
    const r = walkFlow({ ...input(flow(), { total_value: 1 }, w), decisions: [] });
    expect(r.warnings.some((x) => x.code === "starter_only" && x.step_key === "kd")).toBe(true);
    expect(
      r.path.at(-1)?.review?.who.some((h) => h.via === "escalated" && h.user_id === ADMIN),
    ).toBe(true);
  });

  it("'Cần: tất cả' mà phòng chỉ có người gửi (n = 0) ⇒ cảnh báo + giao quản trị; n = số người trừ người gửi", () => {
    const solo = world({
      groups: new Map([
        [G_KD, { name: "KD", memberIds: [STARTER], headUserId: null }],
        [G_KT, { name: "KT", memberIds: [L1, L2], headUserId: null }],
      ]),
    });
    const zero = walkFlow({
      ...input(flow({ head_only: false, need: "all" }), { total_value: 1 }, solo),
      decisions: [],
    });
    expect(zero.warnings.some((x) => x.code === "all_zero")).toBe(true);
    expect(zero.path.at(-1)?.review?.who.map((h) => h.user_id)).toEqual([ADMIN]);
    const some = walkFlow({
      ...input(flow(), { total_value: 650_000_000 }),
      decisions: [ok("approve", "kd")],
    });
    const all = walkFlow({
      ...input(flow({}, { need: "all" }), { total_value: 650_000_000 }),
      decisions: [ok("approve", "kd")],
    });
    expect(some.path.at(-1)?.review?.voters_n).toBeNull();
    expect(all.path.at(-1)?.review?.voters_n).toBe(2);
  });

  it("phòng 1 người / chưa có trưởng phòng / chưa chọn phòng", () => {
    const w = world({
      groups: new Map([
        [G_KD, { name: "Ban GĐ", memberIds: [HEAD], headUserId: null }],
        [G_KT, { name: "KT", memberIds: [L1, L2], headUserId: null }],
      ]),
    });
    const r = walkFlow({ ...input(flow(), { total_value: 1 }, w), decisions: [] });
    expect(r.warnings.map((x) => x.code)).toEqual(expect.arrayContaining(["no_head"]));
    const one = walkFlow({
      ...input(flow({ head_only: false }), { total_value: 1 }, w),
      decisions: [],
    });
    expect(one.warnings.some((x) => x.code === "group_single")).toBe(true);
    const none = walkFlow({
      ...input(flow({ group_id: "33333333-0000-4000-8000-0000000000ff" }), { total_value: 1 }),
      decisions: [],
    });
    expect(none.warnings.some((x) => x.code === "group_missing")).toBe(true);
    expect(none.path.at(-1)?.review?.who).toEqual([]);
  });

  it("uỷ quyền đang hiệu lực ⇒ người làm thay hiện cùng; người gửi không được làm thay", () => {
    const d = (to: string): DelegationRow => ({
      fromUserId: HEAD,
      toUserId: to,
      fromAt: new Date("2026-11-01T00:00:00Z"),
      toAt: new Date("2026-12-01T00:00:00Z"),
      kinds: ["approve"],
    });
    const r = walkFlow({
      ...input(flow(), { total_value: 1 }, world({ delegations: [d(DEL)] })),
      decisions: [],
    });
    expect(r.path.at(-1)?.review?.who).toEqual([
      { user_id: HEAD, name: "Phạm Cường", via: "head" },
      { user_id: DEL, name: "Người thay", via: "delegated", on_behalf_of: HEAD },
    ]);
    const self = walkFlow({
      ...input(flow(), { total_value: 1 }, world({ delegations: [d(STARTER)] })),
      decisions: [],
    });
    expect(self.path.at(-1)?.review?.who.map((h) => h.via)).toEqual(["head"]);
  });
});

describe("E7 · đóng vai (canAct)", () => {
  it("người không có quyền ⇒ dừng chờ + can_act=false; trưởng phòng ⇒ được", () => {
    const base = input(flow(), { total_value: 1 });
    const no = walkFlow({ ...base, decisions: [ok("approve", "kd", L1)] });
    expect(no.status).toBe("waiting");
    expect(no.path.at(-1)?.can_act).toBe(false);
    const yes = walkFlow({ ...base, decisions: [ok("approve", "kd", HEAD)] });
    expect(yes.path.find((p) => p.step_key === "kd")).toMatchObject({
      status: "done",
      can_act: true,
      actor: { name: "Phạm Cường" },
    });
  });

  it("exclude_starter: người gửi trong phòng không tự duyệt", () => {
    const base = input(flow({ head_only: false, exclude_starter: true }), { total_value: 1 });
    const r = walkFlow({ ...base, decisions: [ok("approve", "kd", STARTER)] });
    expect(r.path.at(-1)?.can_act).toBe(false);
  });
});

describe("E7 · 4 trường hợp", () => {
  it("valueFor / factsFor sinh dữ kiện từ ngưỡng", () => {
    const c = { from: { kind: "fact", key: "v" } as const, op: "gt" as const, value: 500 };
    expect(valueFor(c, true)).toBe(501);
    expect(valueFor(c, false)).toBe(500);
    expect(valueFor({ ...c, op: "eq", value: "a" }, false)).toBe("a_khac");
    expect(factsFor(flow(), {}, true)).toEqual({ total_value: 500_000_001 });
    expect(factsFor(flow(), {}, false)).toEqual({ total_value: 500_000_000 });
  });

  it("Duyệt hết Đúng / Sai · Từ chối ở bước cuối · Trả lại ở bước đầu", () => {
    const sc = scenariosOf(input(flow(), {}));
    expect(sc.map((s) => s.key)).toEqual(["approve_then", "approve_else", "reject", "return"]);
    expect(sc.map((s) => s.result.outcome?.key)).toEqual([
      "approved",
      "approved",
      "rejected",
      "returned",
    ]);
    expect(keys(sc[0]?.result ?? { path: [] })).toContain("kt");
    expect(keys(sc[1]?.result ?? { path: [] })).not.toContain("kt");
    expect(sc[2]?.label).toBe("kt Từ chối");
  });

  it("không có node Nếu theo dữ kiện ⇒ bỏ trường hợp nhánh Sai", () => {
    const plain = flow()
      .filter((s) => s.key !== "ktra")
      .map((s, i) => ({ ...s, step: i }) as ProcessStageDef);
    const sc = scenariosOf(
      input(
        plain.map((s) =>
          s.key === "kd"
            ? ({
                ...s,
                executor: { kind: "approve", reject_step: 5, return_step: 6 },
              } as ProcessStageDef)
            : s,
        ),
        {},
      ),
    );
    expect(sc.some((s) => s.key === "approve_else")).toBe(false);
  });
});
