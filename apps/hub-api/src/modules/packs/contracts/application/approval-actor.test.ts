// HD-FR-33 · người duyệt theo Group cấu hình; tenant chưa có Group duyệt (bật feature tay) ⇒ dựa quyền gói write/admin.
import { describe, expect, test } from "bun:test";
import { APPROVAL_DEFAULTS } from "../domain/approval-def.rules";
import { type ApprovalGroups, approvalActor } from "./approval.usecase";

const who = { tenantId: "t1", userId: "u1" };
const S = { ...APPROVAL_DEFAULTS };
const L1 = APPROVAL_DEFAULTS.level1GroupKey;
const L2 = APPROVAL_DEFAULTS.level2GroupKey;

const groups = (o: {
  ids?: Record<string, string>;
  mine?: string[];
  acts?: string[] | null;
}): ApprovalGroups => ({
  idsOf: async () => new Map(Object.entries(o.ids ?? {})),
  userGroups: async () => new Set(o.mine ?? []),
  ...(o.acts === null ? {} : { actionsOf: async () => new Set(o.acts ?? []) }),
});

describe("approvalActor", () => {
  test("tenant có Group duyệt ⇒ theo thành viên Group, KHÔNG xét quyền gói", async () => {
    const ids = { [L1]: "g1", [L2]: "g2" };
    expect(await approvalActor(groups({ ids, mine: ["g1"], acts: [] }), who, S)).toMatchObject({
      inLevel1: true,
      inLevel2: false,
    });
    // phủ định: có quyền write/admin nhưng không thuộc Group ⇒ không duyệt được
    expect(
      await approvalActor(groups({ ids, mine: [], acts: ["read", "write", "admin"] }), who, S),
    ).toMatchObject({ inLevel1: false, inLevel2: false });
  });

  test("người thuộc Group cấp 2 (Toàn quyền) cũng xác nhận được cấp 1, dù không ở Group cấp 1", async () => {
    const ids = { [L1]: "g1", [L2]: "g2" };
    expect(await approvalActor(groups({ ids, mine: ["g2"], acts: [] }), who, S)).toMatchObject({
      inLevel1: true,
      inLevel2: true,
    });
    // phủ định: chỉ xem (không thuộc Group nào) vẫn không xác nhận được
    expect(
      await approvalActor(groups({ ids, mine: ["g9"], acts: ["read"] }), who, S),
    ).toMatchObject({
      inLevel1: false,
      inLevel2: false,
    });
  });

  test("tenant chưa có Group duyệt ⇒ cấp 1 theo write, cấp 2 theo admin", async () => {
    const at = (acts: string[]) => approvalActor(groups({ acts }), who, S);
    expect(await at(["read", "write", "admin"])).toMatchObject({ inLevel1: true, inLevel2: true });
    expect(await at(["read", "write"])).toMatchObject({ inLevel1: true, inLevel2: false });
    // phủ định: chỉ xem / không quyền ⇒ không duyệt bước nào
    expect(await at(["read"])).toMatchObject({ inLevel1: false, inLevel2: false });
    expect(await at([])).toMatchObject({ inLevel1: false, inLevel2: false });
  });

  test("chỉ thiếu một Group ⇒ dự phòng đúng bước đó", async () => {
    const g = groups({ ids: { [L1]: "g1" }, mine: [], acts: ["read", "write", "admin"] });
    // cấp 2 dự phòng theo admin ⇒ cũng xác nhận được cấp 1 (Toàn quyền làm được cả bước 1)
    expect(await approvalActor(g, who, S)).toMatchObject({ inLevel1: true, inLevel2: true });
  });

  test("cổng không có actionsOf ⇒ không dự phòng (fail-closed)", async () => {
    expect(await approvalActor(groups({ acts: null }), who, S)).toMatchObject({
      inLevel1: false,
      inLevel2: false,
    });
  });
});
