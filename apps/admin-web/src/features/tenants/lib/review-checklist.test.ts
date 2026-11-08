// CR-125 · S1 · C1 · luật danh sách việc còn thiếu của bước Xem lại.
import { describe, expect, test } from "bun:test";
import type { PackState } from "@ai/contracts/packs";
import { reviewChecklist } from "./review-checklist";

const pack = (key: string, member_count: number): PackState => ({
  key,
  enabled: true,
  groups: [],
  role_count: 3,
  member_count,
});

describe("reviewChecklist", () => {
  test("chưa bật app nào ⇒ chỉ một mục 'chưa bật app'", () => {
    expect(reviewChecklist({ appsOn: [], packs: [], userCount: 1, flowsOff: [] })).toEqual([
      { kind: "noApps" },
    ]);
  });

  test("app đã bật mà chưa ai có vai ⇒ 'noPeople' đúng app đó; app đã có người thì không", () => {
    const r = reviewChecklist({
      appsOn: ["contracts", "community"],
      packs: [pack("contracts", 0), pack("community", 2)],
      userCount: 3,
      flowsOff: [],
    });
    expect(r).toEqual([{ kind: "noPeople", app: "contracts" }]);
  });

  test("chỉ có quản trị công ty ⇒ 'noUsers'; việc quy trình tắt ⇒ 'noFlow' kèm khe", () => {
    const r = reviewChecklist({
      appsOn: ["contracts"],
      packs: [pack("contracts", 1)],
      userCount: 1,
      flowsOff: [{ app: "contracts", slot: "contracts.approval" }],
    });
    expect(r).toEqual([
      { kind: "noUsers" },
      { kind: "noFlow", app: "contracts", slot: "contracts.approval" },
    ]);
  });

  test("đủ trọn ⇒ rỗng; không đọc được gói (tenant_admin) ⇒ bỏ mục 'noPeople'", () => {
    expect(
      reviewChecklist({
        appsOn: ["contracts"],
        packs: [pack("contracts", 2)],
        userCount: 4,
        flowsOff: [],
      }),
    ).toEqual([]);
    expect(
      reviewChecklist({ appsOn: ["contracts"], packs: undefined, userCount: 4, flowsOff: [] }),
    ).toEqual([]);
  });
});
