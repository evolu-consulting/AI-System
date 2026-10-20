// V2-K · TQ-01 · BA §4.1/§5.9: loại, số ngày, khoá, thứ tự (quá hạn đầu), cắt nguồn.
import { describe, expect, it } from "bun:test";
import { buildTodo, parseTodoKey, type RawTodo, TODO_SOURCE_MAX } from "./todo.rules";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const raw = (kind: RawTodo["kind"], n: number, due: string): RawTodo => ({
  kind,
  id: U(n),
  due,
  title: `v${n}`,
});

describe("V2-K · Cần xử lý", () => {
  it("mốc trễ ⇒ quá hạn (đầu, trễ lâu trước); mốc tới hạn ⇒ sắp đến hạn; đánh giá / thiếu file cuối", () => {
    const out = buildTodo(
      [
        raw("missing_file", 1, "2026-10-01"),
        raw("milestone", 2, "2026-10-25"),
        raw("milestone", 3, "2026-10-18"),
        raw("rating", 4, "2026-10-10"),
        raw("contract_expiring", 5, "2026-10-22"),
        raw("milestone", 6, "2026-10-01"),
      ],
      "2026-10-21",
    );
    expect(out.items.map((i) => [i.kind, i.days])).toEqual([
      ["overdue", 20],
      ["overdue", 3],
      ["contract_expiring", -1],
      ["due_soon", -4],
      ["rating", 11],
      ["missing_file", 20],
    ]);
    expect(out.counts).toEqual({ total: 6, overdue: 2 });
    expect(out.items[0]?.key).toBe(`milestone:${U(6)}:2026-10-01`);
    expect(out.truncated).toBe(false);
  });
  it("khoá: tiền tố hợp lệ + uuid + ngày; sai ⇒ null", () => {
    expect(parseTodoKey(`rating:${U(1)}:2026-10-10`)).toEqual({
      raw: "rating",
      id: U(1),
      due: "2026-10-10",
    });
    expect(parseTodoKey(`overdue:${U(1)}:2026-10-10`)).toBeNull();
    expect(parseTodoKey(`rating:x:2026-10-10`)).toBeNull();
  });
  it("nguồn vượt trần ⇒ cắt + truncated", () => {
    const many = Array.from({ length: TODO_SOURCE_MAX + 1 }, (_, i) =>
      raw("missing_file", i + 1, "2026-10-01"),
    );
    const out = buildTodo(many, "2026-10-21");
    expect(out.items).toHaveLength(TODO_SOURCE_MAX);
    expect(out.truncated).toBe(true);
  });
});
