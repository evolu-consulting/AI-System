// CR-123 · u10 · danh sách HĐ thêm ĐÚNG MỘT khoá `step_label` (cột "Bước"): nhãn lấy theo lô cho cả trang từ cùng nguồn thẻ duyệt;
// hàng không có lượt engine ⇒ null (UI giữ nhãn trạng thái); một lô duy nhất (không gọi theo từng hàng).
import { describe, expect, it } from "bun:test";
import { listContracts } from "./list-contracts.usecase";

const page = {
  total: 3,
  items: [{ id: "c1" }, { id: "c2" }, { id: "c3" }],
  parents: [],
  step_runs: [
    { id: "c1", run: "r1", from_run: true },
    { id: "c2", run: "r2" },
  ],
};
const uow = {
  tenant: <T>(_w: unknown, fn: (r: never) => Promise<T>) =>
    fn({ contracts: { list: async () => page } } as never),
};
const q = { sort: "updated_at", dir: "desc", page: 1, page_size: 20 } as const;
const who = { tenantId: "t", userId: "u" };

describe("listContracts · step_label", () => {
  it("một lô cho cả trang, hàng có run ⇒ nhãn, hàng không có run ⇒ null", async () => {
    const calls: (readonly string[])[] = [];
    const out = await listContracts<{ id: string; step_label?: unknown; waiting?: unknown }>({
      uow,
      stepLabels: async (_w, ids, fromRuns) => {
        calls.push(ids);
        expect([...fromRuns]).toEqual(["r1"]);
        return new Map([
          [
            "r1",
            {
              label: { code: "waiting_sign", who: "Giám đốc" },
              waiting: { step: "Ký số", who: "Giám đốc", due_at: null },
            },
          ],
          ["r2", { label: null, waiting: null }],
        ]);
      },
    })(who, q);
    expect(calls).toEqual([["r1", "r2"]]);
    expect(out.items).toEqual([
      {
        id: "c1",
        step_label: { code: "waiting_sign", who: "Giám đốc" },
        waiting: { step: "Ký số", who: "Giám đốc", due_at: null },
      },
      { id: "c2", step_label: null, waiting: null },
      { id: "c3", step_label: null, waiting: null },
    ]);
  });

  it("không có cầu engine ⇒ vẫn đủ khoá `step_label: null` + `waiting: null`, không gọi ai", async () => {
    const out = await listContracts<{ id: string; step_label?: unknown; waiting?: unknown }>({
      uow,
    })(who, q);
    expect(out.items.every((x) => (x as { step_label?: unknown }).step_label === null)).toBe(true);
  });

  it("không hàng nào có run ⇒ không gọi lô", async () => {
    let n = 0;
    const none = {
      tenant: <T>(_w: unknown, fn: (r: never) => Promise<T>) =>
        fn({ contracts: { list: async () => ({ ...page, step_runs: [] }) } } as never),
    };
    await listContracts<{ id: string; step_label?: unknown; waiting?: unknown }>({
      uow: none,
      stepLabels: async () => {
        n++;
        return new Map();
      },
    })(who, q);
    expect(n).toBe(0);
  });
});
