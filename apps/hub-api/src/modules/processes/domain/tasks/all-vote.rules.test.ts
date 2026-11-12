// CR-127 · E5 · spec §5.4 · R#13 · R#14 · luật thuần "Cần: tất cả".
import { describe, expect, test } from "bun:test";
import {
  requiredVoters,
  type Voter,
  voteAs,
  voteProgress,
  voteVerdict,
  zeroVoterTargets,
} from "./all-vote.rules";

const V = (userId: string, usable = true): Voter => ({ userId, usable });
const ABC = [V("a"), V("b"), V("c")];

describe("CR-127 · E5 · Cần: tất cả", () => {
  test("n loại người vô hiệu / rời phòng; tiến độ chỉ đếm phiếu Duyệt của người còn tính", () => {
    const vs = [V("a"), V("b"), V("c", false)];
    expect(requiredVoters(vs)).toEqual(["a", "b"]);
    expect(
      voteProgress(vs, [
        { userId: "a", result: "pass" },
        { userId: "c", result: "pass" },
      ]),
    ).toEqual({
      done: 1,
      total: 2,
    });
  });

  test("đủ n/n Duyệt ⇒ final; thiếu ⇒ partial; Trả lại/Từ chối ⇒ final ngay", () => {
    expect(voteVerdict(ABC, [], { userId: "a", result: "pass" })).toBe("partial");
    const ab = [
      { userId: "a", result: "pass" as const },
      { userId: "b", result: "pass" as const },
    ];
    expect(voteVerdict(ABC, ab, { userId: "c", result: "pass" })).toBe("final");
    expect(voteVerdict(ABC, [], { userId: "b", result: "fail" })).toBe("final");
    expect(voteVerdict(ABC, [], { userId: "b", result: "reject" })).toBe("final");
  });

  test("người bị vô hiệu sau đó ⇒ loại khỏi n ở phiếu kế tiếp", () => {
    const vs = [V("a"), V("b"), V("c", false)];
    expect(
      voteVerdict(vs, [{ userId: "a", result: "pass" }], { userId: "b", result: "pass" }),
    ).toBe("final");
  });

  test("tư cách bỏ phiếu: chính mình / thay A (uỷ quyền) / đã bỏ / bị loại / không phải người bỏ phiếu", () => {
    expect(voteAs("a", ABC, [], null)).toEqual({ kind: "vote", userId: "a", onBehalfOf: null });
    expect(voteAs("a", ABC, [{ userId: "a", result: "pass" }], null)).toEqual({ kind: "voted" });
    expect(voteAs("d", ABC, [], "a")).toEqual({ kind: "vote", userId: "a", onBehalfOf: "d" });
    expect(voteAs("d", ABC, [{ userId: "a", result: "pass" }], "a")).toEqual({ kind: "voted" });
    expect(voteAs("c", [V("c", false)], [], null)).toEqual({ kind: "excluded" });
    expect(voteAs("d", ABC, [], null)).toEqual({ kind: "none" });
    expect(voteAs("d", [V("a", false)], [], "a")).toEqual({ kind: "none" });
  });

  test("n = 0 ⇒ người chuyển cấp > nhóm chuyển cấp > quản trị công ty (trừ người gửi); không ai ⇒ null", () => {
    expect(zeroVoterTargets("s", { userId: "x", groupId: "g", adminIds: [] })).toEqual({
      userIds: ["x"],
      groupId: null,
    });
    expect(zeroVoterTargets("s", { userId: null, groupId: "g", adminIds: ["m"] })).toEqual({
      userIds: [],
      groupId: "g",
    });
    expect(
      zeroVoterTargets("s", { userId: null, groupId: null, adminIds: ["s", "m", "m"] }),
    ).toEqual({ userIds: ["m"], groupId: null });
    expect(zeroVoterTargets("s", { userId: "s", groupId: null, adminIds: ["s"] })).toBeNull();
  });
});
