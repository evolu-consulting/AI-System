// CR-181 · s9 · luật thuần lượt ký / bước Ký ondoc / chặn Gửi.
import { describe, expect, test } from "bun:test";
import {
  needsOnDoc,
  type OpenSignStep,
  onBehalfOfVersion,
  ondocDone,
  ondocStepAt,
  signBlockOf,
  signTurnOf,
} from "./sign-turn.rules";

const U1 = "00000000-0000-4000-8000-000000000001";
const U2 = "00000000-0000-4000-8000-000000000002";
const G1 = "00000000-0000-4000-8000-0000000000a1";
const review = (evidence?: string) => ({
  executor: { kind: "approve" },
  after: { kind: "review", evidence },
});
const esign = (provider: string, signers: string) => ({
  executor: {
    kind: "tool",
    tool_key: "contracts-esign-send",
    args: {
      provider: { from: "const", value: provider },
      company_signers: { from: "const", value: signers },
    },
  },
});
const wait = { executor: { kind: "wait_event", event: "esign.completed" } };
const step = (stages: unknown[], idx: number, o: Partial<OpenSignStep> = {}): OpenSignStep => ({
  runId: "run",
  idx,
  stages,
  task: { userIds: [U1], groupId: G1, escalatedGroupId: null, claimedBy: null, need: "one" },
  myGroups: [],
  ...o,
});

describe("signTurnOf (BR-D1)", () => {
  test("người được giao bước duyệt có bằng chứng ⇒ approve", () => {
    expect(signTurnOf(step([review("opinion_plus")], 0), U1)).toEqual({
      allowed: true,
      step: "approve",
      run_id: "run",
    });
  });
  test("thành viên Group duyệt ⇒ approve, người ngoài ⇒ không", () => {
    expect(signTurnOf(step([review("opinion_plus")], 0, { myGroups: [G1] }), U2).allowed).toBe(
      true,
    );
    expect(signTurnOf(step([review("opinion_plus")], 0), U2)).toEqual({
      allowed: false,
      reason: "NOT_ASSIGNED",
    });
  });
  test("người khác đã nhận việc ⇒ không", () => {
    const s = step([review("opinion_plus")], 0, {
      task: {
        userIds: [U1, U2],
        groupId: null,
        escalatedGroupId: null,
        claimedBy: U1,
        need: "one",
      },
    });
    expect(signTurnOf(s, U2).reason).toBe("CLAIMED_BY_OTHER");
  });
  test("bước chỉ ý kiến ⇒ không có lượt ký", () => {
    expect(signTurnOf(step([review("opinion")], 0), U1).reason).toBe("STEP_NO_SIGN");
  });
  test("bước Ký ondoc: người ký (user / thành viên Group) ⇒ sign", () => {
    const st = [review(), esign("ondoc", `user:${U1},group:${G1}`), wait];
    expect(signTurnOf(step(st, 2, { task: null }), U1).step).toBe("sign");
    expect(signTurnOf(step(st, 2, { task: null, myGroups: [G1] }), U2).allowed).toBe(true);
    expect(signTurnOf(step(st, 2, { task: null }), U2).reason).toBe("NOT_SIGNER");
  });
  test("bước Ký qua nhà cung cấp ⇒ không phải ký trên tài liệu", () => {
    expect(ondocStepAt([esign("vnpt", `user:${U1}`), wait], 1)).toBeNull();
  });
  test("không có lượt mở ⇒ không", () => {
    expect(signTurnOf(null, U1).reason).toBe("NO_OPEN_STEP");
  });
});

describe("needsOnDoc / signBlockOf / ondocDone", () => {
  test("BR-T2 · Q3: chỉ khi có bước Ký ondoc hoặc duyệt có bằng chứng", () => {
    expect(needsOnDoc([review("opinion")])).toBe(false);
    expect(needsOnDoc([review("opinion_plus")])).toBe(true);
    expect(needsOnDoc([esign("ondoc", `user:${U1}`)])).toBe(true);
    expect(needsOnDoc([esign("upload", `user:${U1}`)])).toBe(false);
  });
  test("BR-C3 · lý do chặn", () => {
    expect(signBlockOf({ ready: true, missing: [] })).toBeNull();
    expect(signBlockOf({ ready: false, missing: [{ code: "NO_SIGN_FILE" }] })).toBe(
      "sign_no_files",
    );
    expect(signBlockOf({ ready: false, missing: [{ code: "NO_FIELD" } as never] })).toBe(
      "sign_missing_fields",
    );
  });
  test("BR-D3/C4 · xong khi có ô Bên A và tất cả đã ký", () => {
    expect(ondocDone({ total: 0, open: 0 })).toBe(false);
    expect(ondocDone({ total: 2, open: 1 })).toBe(false);
    expect(ondocDone({ total: 2, open: 0 })).toBe(true);
  });
});

// CR-184 · ý (5) · uỷ quyền khi vắng với ký trên tài liệu.
describe("signTurnOf + uỷ quyền (CR-184)", () => {
  const U3 = "00000000-0000-4000-8000-000000000003";
  const st = [review(), esign("ondoc", `user:${U1},group:${G1}`), wait];
  const deleg = (userId: string, kinds: string[], groups: string[] = []) => ({
    userId,
    kinds,
    groups,
  });
  test("bước Ký: A uỷ quyền esign cho B ⇒ B có lượt sign, ghi «thay A»", () => {
    const t = signTurnOf(step(st, 2, { task: null, delegations: [deleg(U1, ["esign"])] }), U2);
    expect(t).toEqual({
      allowed: true,
      step: "sign",
      run_id: "run",
      behalf: [{ user_id: U1, groups: [] }],
    });
  });
  test("bước Ký: A chỉ uỷ quyền approve (không esign) ⇒ B không ký được", () => {
    const s = step(st, 2, { task: null, delegations: [deleg(U1, ["approve"])] });
    expect(signTurnOf(s, U2).reason).toBe("NOT_SIGNER");
  });
  test("bước Ký: người ký qua Group — A thuộc Group ký uỷ quyền esign ⇒ B có lượt", () => {
    const s = step(st, 2, { task: null, delegations: [deleg(U3, ["esign"], [G1])] });
    expect(signTurnOf(s, U2).behalf).toEqual([{ user_id: U3, groups: [G1] }]);
  });
  test("bước Ký: người uỷ quyền không phải người ký của bước ⇒ không có lượt (C bất kỳ)", () => {
    const s = step(st, 2, { task: null, delegations: [deleg(U3, ["esign"])] });
    expect(signTurnOf(s, U2).allowed).toBe(false);
    expect(signTurnOf(step(st, 2, { task: null }), U3).allowed).toBe(false);
  });
  test("bước duyệt: việc nhờ uỷ quyền approve (behalfOf) ⇒ approve + behalf", () => {
    const s = step([review("opinion_plus")], 0, {
      task: {
        userIds: [U2],
        groupId: null,
        escalatedGroupId: null,
        claimedBy: null,
        need: "one",
        behalfOf: U1,
      },
    });
    expect(signTurnOf(s, U2)).toEqual({
      allowed: true,
      step: "approve",
      run_id: "run",
      behalf: [{ user_id: U1, groups: [] }],
    });
  });
});

describe("onBehalfOfVersion (CR-184)", () => {
  const behalf = [{ user_id: U1, groups: [G1] }];
  test("ô của A (đích danh hoặc nhóm của A) ⇒ A; ô của chính mình ⇒ null", () => {
    expect(onBehalfOfVersion(behalf, [{ signer_kind: "user", signer_ref: U1 }], new Set())).toBe(
      U1,
    );
    expect(onBehalfOfVersion(behalf, [{ signer_kind: "group", signer_ref: G1 }], new Set())).toBe(
      U1,
    );
    expect(
      onBehalfOfVersion(
        behalf,
        [{ signer_kind: "group", signer_ref: G1 }],
        new Set([`group:${G1}`]),
      ),
    ).toBeNull();
  });
  test("dấu tự do: chỉ ghi thay khi người gọi không tự là người ký", () => {
    expect(onBehalfOfVersion(behalf, [], new Set())).toBe(U1);
    expect(onBehalfOfVersion(behalf, [], new Set([`user:${U2}`]))).toBeNull();
  });
});
