// CR-152 cr152c · điểm uy tín của «Nhượng quyền» + «Hợp tác có chia»: ô mới, nguồn điểm của mốc kỳ, đúng hạn vs trễ, HD8 map vai.
import { describe, expect, it } from "bun:test";
import { roleOf } from "./ledger.rules";
import { v2eContribution } from "./obligation-impact.rules";
import {
  COOPERATION_CELL,
  cellProblem,
  DEFAULT_JOB_TYPES,
  DEFAULT_SETTINGS,
  defaultCell,
  REP_CELLS,
  scoreSource,
} from "./rep-config.rules";
import { hd8RoleOf } from "./rep-current.rules";
import { type CellInput, cellScore } from "./rep-score.rules";

const TODAY = "2026-11-14";
const ctx = (g: "franchise" | "cooperation", r: "franchisee" | "franchisor" | "cooperator") => ({
  cell: defaultCell(g, r),
  settings: DEFAULT_SETTINGS,
  jobTypes: DEFAULT_JOB_TYPES,
});

describe("ô uy tín mới (CR-152)", () => {
  it("8 ô: 6–7 Nhượng quyền, 8 Hợp tác, mặc định hợp lệ, hai tiêu chí tổng 100", () => {
    expect(REP_CELLS.length).toBe(8);
    expect(REP_CELLS[COOPERATION_CELL - 1]).toEqual(["cooperation", "cooperator"]);
    for (const [g, r] of REP_CELLS.slice(5)) {
      const c = defaultCell(g, r);
      expect(cellProblem(c)).toBeNull();
      expect(c.criteria.map((x) => x.key)).toEqual(["report_on_time", "fee_on_time"]);
      expect(c.criteria.map((x) => x.milestone)).toEqual(["report", "payment"]);
    }
  });
});

describe("nguồn điểm của mốc (scoreSource)", () => {
  const rep = { kind: "other", period_key: "2026-10" };
  it("báo cáo kỳ của đối tác ⇒ m:report, mốc phí của đối tác ⇒ m:payment", () => {
    expect(scoreSource({ owner: "partner", ...rep }, 6)).toBe("m:report");
    expect(scoreSource({ owner: "partner", kind: "payment", period_key: "2026-10" }, 6)).toBe(
      "m:payment",
    );
  });
  it("mình báo cáo / mình trả phí (đối tác là bên nhượng quyền) ⇒ chỉ đếm giao dịch (tx)", () => {
    expect(scoreSource({ owner: "ours", ...rep }, 7)).toBe("tx");
    expect(scoreSource({ owner: "ours", kind: "payment", period_key: "2026-10" }, 7)).toBe("tx");
  });
  it("Hợp tác: Đối soát do mình ghi vẫn tính cho đối tác (ô 8), mốc không phải mốc kỳ thì không", () => {
    expect(scoreSource({ owner: "ours", ...rep }, COOPERATION_CELL)).toBe("m:report");
    expect(scoreSource({ owner: "ours", kind: "other", period_key: null }, COOPERATION_CELL)).toBe(
      "tx",
    );
    expect(scoreSource({ owner: "ours", ...rep }, 6)).toBe("tx");
  });
  it("loại cũ giữ nguyên: giao hàng của đối tác ⇒ m:delivery, của mình ⇒ tx", () => {
    expect(scoreSource({ owner: "partner", kind: "delivery" }, 3)).toBe("m:delivery");
    expect(scoreSource({ owner: "ours", kind: "delivery" }, 3)).toBe("tx");
  });
});

describe("xác nhận mốc kỳ ⇒ đúng hạn vs trễ", () => {
  const cfg = defaultCell("franchise", "franchisee");
  const head = { owner: "partner", kind: "other", period_key: "2026-10", rep_cell: 6 };
  it("đúng hạn ⇒ điểm việc 100, trễ lỗi đối tác ⇒ trừ 2 điểm/ngày, trễ lỗi mình ⇒ không trừ", () => {
    const on = v2eContribution({ ...head, due_date: "2026-11-10" }, "2026-11-10", null, TODAY, cfg);
    expect(on).toMatchObject({ src: "m:report", h: 1, hs: 100 });
    const late = v2eContribution(
      { ...head, due_date: "2026-11-05" },
      "2026-11-10",
      "partner",
      TODAY,
      cfg,
    );
    expect(late?.hs).toBe(90);
    const ours = v2eContribution(
      { ...head, due_date: "2026-11-05" },
      "2026-11-10",
      "ours",
      TODAY,
      cfg,
    );
    expect(ours?.hs).toBe(100);
  });
  it("điểm ô Nhượng quyền: báo cáo đúng hạn 100 + trả phí trễ 5 ngày (lỗi đối tác) 90 ⇒ 95", () => {
    const inp: CellInput = {
      party: "tax:1",
      role: "franchisee",
      grp: "franchise",
      sources: { "m:report": { n: 3, wh: 3, whs: 300 }, "m:payment": { n: 3, wh: 3, whs: 270 } },
      value: 0,
      stars: {},
    };
    const s = cellScore(inp, ctx("franchise", "franchisee"));
    expect(s.score).toBe(95);
    expect(s.jobs).toBe(6);
    expect(s.level).toBe("good");
  });
  it("ô Hợp tác: chỉ có đối soát đúng hạn ⇒ tiêu chí phần chia chưa có dữ liệu bị bỏ, điểm 100", () => {
    const inp: CellInput = {
      party: "tax:2",
      role: "cooperator",
      grp: "cooperation",
      sources: { "m:report": { n: 3, wh: 3, whs: 300 } },
      value: 0,
      stars: {},
    };
    expect(cellScore(inp, ctx("cooperation", "cooperator")).score).toBe(100);
  });
  it("ô bên nhượng quyền (mình trả): mọi mốc là của mình ⇒ chưa có điểm, nhãn MỚI", () => {
    const inp: CellInput = {
      party: "tax:3",
      role: "franchisor",
      grp: "franchise",
      sources: { tx: { n: 4, wh: 4, whs: 400 } },
      value: 0,
      stars: {},
    };
    const s = cellScore(inp, ctx("franchise", "franchisor"));
    expect(s.score).toBeNull();
    expect(s.level).toBe("new");
  });
});

describe("HD8: hai vai Khách hàng / Nhà cung cấp", () => {
  it("bên nhận quyền, đối tác hợp tác, bên trả hoa hồng ⇒ Khách hàng, bên nhượng quyền ⇒ Nhà cung cấp", () => {
    expect(hd8RoleOf("franchisee")).toBe("customer");
    expect(hd8RoleOf("cooperator")).toBe("customer");
    expect(hd8RoleOf("commission_payer")).toBe("customer");
    expect(hd8RoleOf("franchisor")).toBe("supplier");
    expect(hd8RoleOf("supplier")).toBe("supplier");
    expect(hd8RoleOf("customer")).toBe("customer");
  });
  it("khớp vai sổ HD8 theo chiều tiền của mốc: đối tác trả mình ⇒ customer, mình trả ⇒ supplier", () => {
    expect(roleOf("receive")).toBe(hd8RoleOf("franchisee"));
    expect(roleOf("receive")).toBe(hd8RoleOf("cooperator"));
    expect(roleOf("pay")).toBe(hd8RoleOf("franchisor"));
  });
});
