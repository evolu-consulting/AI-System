// products-confirm (unit, repo giả): lựa chọn "Gắn sản phẩm" gửi kèm `approve` chỉ được áp khi bước này làm HĐ thành "đã xác nhận"
// (finalize thành công) — trong CÙNG tx; chuyển cấp 2 / không có lựa chọn ⇒ không gắn/tạo SP.
import { describe, expect, test } from "bun:test";
import type { ProductLink } from "@ai/contracts";
import { APPROVAL_DEFAULTS } from "../domain/approval-def.rules";
import type { ApprovalTxRepos, ApprovalUow } from "./approval.ports";
import { type ApprovalDeps, actApproval } from "./approval.usecase";

const T = "00000000-0000-4000-8000-000000000001";
const A = "00000000-0000-4000-8000-0000000000a1";
const C = "00000000-0000-4000-8000-0000000000c1";
const RUN = "00000000-0000-4000-8000-0000000000d1";
const LINKS: ProductLink[] = [
  { item_id: "00000000-0000-4000-8000-0000000000e1", new_product: { name: "SP", group: "goods" } },
];

function harness(finalizes: boolean) {
  const calls = { link: [] as unknown[][], toLevel2: 0 };
  const repos = {
    approval: {
      settings: async () => APPROVAL_DEFAULTS,
      state: async () => ({
        runId: RUN,
        status: "needs_review",
        hasSource: true,
        version: 1,
        approval: { id: RUN, status: "level1", startedBy: A, feedback: null },
        value: 1,
        threshold: 100,
      }),
      finalize: async () => finalizes,
      toLevel2: async () => {
        calls.toLevel2 += 1;
        return true;
      },
    },
    links: {
      link: async (...a: unknown[]) => {
        calls.link.push(a);
        return { kind: "ok", created: 1, linked: 1 };
      },
    },
    outbox: { enqueue: async () => undefined },
  } as unknown as ApprovalTxRepos;
  const uow = { tenant: (_w: unknown, fn: (r: ApprovalTxRepos) => unknown) => fn(repos) };
  const d: ApprovalDeps = {
    uow: uow as unknown as ApprovalUow,
    groups: {
      idsOf: async () => new Map([[APPROVAL_DEFAULTS.level1GroupKey, "g1"]]),
      userGroups: async () => new Set(["g1"]),
    },
    jobs: { enqueue: async () => undefined },
  };
  return { act: actApproval(d), calls };
}
const who = { tenantId: T, userId: A };

describe("products-confirm · gắn SP lúc duyệt", () => {
  test("approve làm HĐ đã xác nhận ⇒ gắn/tạo SP đúng HĐ + lựa chọn, một lần", async () => {
    const h = harness(true);
    await h.act(who, C, { action: "approve", products: LINKS });
    expect(h.calls.link).toEqual([[C, LINKS, A]]);
  });
  test("chưa xác nhận (chuyển cấp 2) ⇒ không gắn; không gửi lựa chọn ⇒ không gắn", async () => {
    const h = harness(false);
    await h.act(who, C, { action: "approve", products: LINKS });
    expect([h.calls.link.length, h.calls.toLevel2]).toEqual([0, 1]);
    const h2 = harness(true);
    await h2.act(who, C, { action: "approve" });
    expect(h2.calls.link).toEqual([]);
  });
});
