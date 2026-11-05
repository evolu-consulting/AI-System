// CR-117 · unit: luật thuần của check `slo` — chuỗi vi phạm liên tiếp, tốc độ đốt ngân sách, phán quyết, đọc lại trạng thái.
import { describe, expect, it } from "bun:test";
import {
  BURN_WARN,
  burnRate,
  HIST_MAX,
  judge,
  nextState,
  parseStates,
  SLO_DEFS,
  type SloDef,
  type SloState,
  summarize,
} from "./slo.rules";

const D: SloDef = { id: "x", label: "X", unit: "ms", limit: 100, target: 0.95 };
const run = (vals: (number | null)[]): SloState =>
  vals.reduce<SloState | undefined>((s, v) => nextState(D, s, v), undefined) as SloState;

describe("nextState", () => {
  it("vi phạm liên tiếp cộng dồn; một lượt tốt đặt lại chuỗi", () => {
    expect(run([150, 160, 170]).streak).toBe(3);
    expect(run([150, 160, 50]).streak).toBe(0);
    expect(run([150, 160, 50, 120]).streak).toBe(1);
  });
  it("đúng ngưỡng (= limit) không phải vi phạm", () => {
    expect(run([100]).streak).toBe(0);
  });
  it("lượt không có số đo giữ nguyên chuỗi và lịch sử", () => {
    const s = run([150, 160, null]);
    expect(s.streak).toBe(2);
    expect(s.hist).toBe("11");
    expect(s.v).toBeNull();
  });
  it("lịch sử cắt ở HIST_MAX lượt mới nhất", () => {
    const s = run(Array.from({ length: HIST_MAX + 10 }, () => 150));
    expect(s.hist.length).toBe(HIST_MAX);
  });
});

describe("burnRate", () => {
  it("chưa đủ mẫu ⇒ null", () => {
    expect(burnRate("11", 0.95)).toBeNull();
  });
  it("2 xấu / 10 mẫu với target 95% ⇒ đốt 4x mức cho phép", () => {
    expect(burnRate("1100000000", 0.95)).toBeCloseTo(4, 5);
  });
  it("toàn tốt ⇒ 0", () => {
    expect(burnRate("000000", 0.95)).toBe(0);
  });
});

describe("judge", () => {
  const st = (streak: number, hist = "0".repeat(10)): SloState => ({ id: "x", v: 1, streak, hist });
  it("dưới ngưỡng chuỗi ⇒ ok; đủ warn ⇒ warn; đủ crit ⇒ crit", () => {
    expect(judge([st(1)], [D], 2, 4)).toBe("ok");
    expect(judge([st(2)], [D], 2, 4)).toBe("warn");
    expect(judge([st(4)], [D], 2, 4)).toBe("crit");
  });
  it("chuỗi ngắn nhưng đốt ngân sách nhanh (≥ BURN_WARN) ⇒ warn", () => {
    expect(BURN_WARN).toBe(6);
    expect(judge([st(1, "1010101010")], [D], 2, 4)).toBe("warn"); // 5/10 → 10x
  });
  it("lấy mức xấu nhất giữa các SLO; chưa đo gì ⇒ unknown", () => {
    const a: SloState = { id: "x", v: 1, streak: 0, hist: "0000000" };
    const b: SloState = { id: "y", v: 1, streak: 5, hist: "11111" };
    const d2: SloDef = { ...D, id: "y" };
    expect(judge([a, b], [D, d2], 2, 4)).toBe("crit");
    expect(judge([{ id: "x", v: null, streak: 0, hist: "" }], [D], 2, 4)).toBe("unknown");
  });
});

describe("summarize", () => {
  it("nêu SLO vi phạm kèm số lượt và tốc độ đốt", () => {
    const s: SloState = { id: "x", v: 150, streak: 3, hist: "0000000111" };
    const m = summarize([s], [D], 2);
    expect(m).toContain("X vượt 100ms 3 lượt liên tiếp");
    expect(m).toContain("đốt ngân sách");
  });
  it("ổn ⇒ liệt kê số đo; chưa đo ⇒ nói rõ", () => {
    expect(summarize([{ id: "x", v: 42, streak: 0, hist: "0" }], [D], 2)).toBe(
      "Trong mục tiêu: X 42ms",
    );
    expect(summarize([{ id: "x", v: null, streak: 0, hist: "" }], [D], 2)).toBe(
      "Chưa có số đo SLO nào",
    );
  });
});

describe("parseStates", () => {
  it("đọc lại value của lượt trước; bỏ mục sai dạng và ký tự lạ trong hist", () => {
    const m = parseStates({
      slos: [
        { id: "a", v: 5, streak: 2, hist: "01x1" },
        { id: 7, v: 1, streak: 1, hist: "0" },
        { id: "b", v: "lỗi", streak: -3, hist: "1" },
      ],
    });
    expect(m.get("a")).toEqual({ id: "a", v: 5, streak: 2, hist: "011" });
    expect(m.get("b")).toEqual({ id: "b", v: null, streak: 0, hist: "1" });
    expect(m.size).toBe(2);
  });
  it("không phải object/thiếu slos ⇒ rỗng", () => {
    expect(parseStates(null).size).toBe(0);
    expect(parseStates({}).size).toBe(0);
  });
});

describe("SLO_DEFS", () => {
  it("id duy nhất, target trong (0,1)", () => {
    expect(new Set(SLO_DEFS.map((d) => d.id)).size).toBe(SLO_DEFS.length);
    for (const d of SLO_DEFS) expect(d.target > 0 && d.target < 1).toBe(true);
  });
});
