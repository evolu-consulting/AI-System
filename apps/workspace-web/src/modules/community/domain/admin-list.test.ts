// CR-137 · lọc/sắp xếp danh sách quản trị.
import { describe, expect, test } from "bun:test";
import {
  countByStatus,
  filterByStatus,
  keepSelection,
  shortDay,
  sortForReview,
} from "./admin-list";

const rows = [
  { id: "a", status: "approved", createdAt: "2026-11-10T00:00:00Z" },
  { id: "b", status: "pending", createdAt: "2026-11-01T00:00:00Z" },
  { id: "c", status: "pending", createdAt: "2026-11-05T00:00:00Z" },
  { id: "d", status: "rejected", createdAt: "2026-11-11T00:00:00Z" },
];

describe("admin-list", () => {
  test("lọc theo trạng thái, all giữ hết", () => {
    expect(filterByStatus(rows, "pending").map((r) => r.id)).toEqual(["b", "c"]);
    expect(filterByStatus(rows, "all")).toHaveLength(4);
  });
  test("chờ xử lý lên đầu, mới nhất trước, không đổi mảng gốc", () => {
    expect(sortForReview(rows, "pending").map((r) => r.id)).toEqual(["c", "b", "d", "a"]);
    expect(rows[0]?.id).toBe("a");
  });
  test("đếm theo trạng thái", () => {
    expect(countByStatus(rows)).toEqual({ approved: 1, pending: 2, rejected: 1 });
  });
  test("ngày ngắn; ISO hỏng ⇒ rỗng", () => {
    expect(shortDay("2026-11-05T12:00:00Z", "vi-VN")).toBe("5/11/2026");
    expect(shortDay("x", "vi-VN")).toBe("");
  });
  test("giữ chọn chỉ khi dòng còn trong danh sách", () => {
    expect(keepSelection(rows, "b")).toBe("b");
    expect(keepSelection(rows, "zz")).toBeNull();
    expect(keepSelection(rows, null)).toBeNull();
  });
});
