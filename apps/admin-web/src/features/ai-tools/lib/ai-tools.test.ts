// CR-121 R6 · c16 · unit lõi trang Công cụ AI.
import { describe, expect, test } from "bun:test";
import type { AiToolUsage } from "@ai/contracts/workflow-tools";
import {
  companyTally,
  filterTools,
  parseStatus,
  parseUsageKind,
  sliceShown,
  toolCounts,
  usageParts,
} from "./ai-tools";

const tool = (p: Partial<AiToolUsage>): AiToolUsage => ({
  workflow_id: "00000000-0000-4000-8000-000000000001",
  key: "xuat-hd",
  name: "Xuất hợp đồng",
  description: "Xuất hợp đồng ra file Word",
  enabled: true,
  side_effect: false,
  agent_count: 0,
  command_count: 0,
  company_count: 0,
  ...p,
});

const items = [
  tool({ name: "Đọc file", agent_count: 23 }),
  tool({ name: "Kiểm tra hạn mức", agent_count: 1, command_count: 1 }),
  tool({ name: "Bug Fix", enabled: false }),
  tool({ name: "Tra tri thức", description: "tìm trong kho", command_count: 2 }),
];

describe("usageParts", () => {
  test("chỉ loại có số > 0, thứ tự agent → lệnh", () => {
    expect(usageParts(items[1] as AiToolUsage)).toEqual([
      { kind: "agent", count: 1 },
      { kind: "command", count: 1 },
    ]);
    expect(usageParts(items[2] as AiToolUsage)).toEqual([]);
  });
});

describe("filterTools", () => {
  test("Đang bật = công cụ bật toàn hệ thống; Chưa dùng = không agent/lệnh nào", () => {
    expect(filterTools(items, { status: "on" })).toHaveLength(3);
    expect(filterTools(items, { status: "unused" }).map((t) => t.name)).toEqual(["Bug Fix"]);
  });
  test("chip loại: chỉ công cụ có loại đó gọi tới", () => {
    expect(filterTools(items, { kind: "command" }).map((t) => t.name)).toEqual([
      "Kiểm tra hạn mức",
      "Tra tri thức",
    ]);
    expect(filterTools(items, { kind: "agent" })).toHaveLength(2);
  });
  test("ô tìm theo tên hoặc mô tả, không phân biệt hoa thường; khoá kỹ thuật không được tìm", () => {
    expect(filterTools(items, { q: "ĐỌC" }).map((t) => t.name)).toEqual(["Đọc file"]);
    expect(filterTools(items, { q: "kho" }).map((t) => t.name)).toEqual(["Tra tri thức"]);
    expect(filterTools(items, { q: "xuat-hd" })).toEqual([]);
  });
  test("các bộ lọc cộng dồn (AND)", () => {
    expect(filterTools(items, { kind: "agent", status: "unused" })).toEqual([]);
  });
});

describe("toolCounts / sliceShown / companyTally / parse", () => {
  test("đếm chip trên toàn danh mục", () => {
    expect(toolCounts(items)).toEqual({ all: 4, on: 3, unused: 1, agent: 2, command: 2 });
  });
  test("Xem thêm: cắt theo số đang hiện", () => {
    expect(sliceShown([1, 2, 3], 2)).toEqual({ rows: [1, 2], more: true });
    expect(sliceShown([1, 2], 2)).toEqual({ rows: [1, 2], more: false });
  });
  test("công ty bật / tổng", () => {
    expect(companyTally([{ on: true }, { on: false }, { on: true }])).toEqual({ on: 2, total: 3 });
  });
  test("tham số URL lạ bị bỏ", () => {
    expect(parseUsageKind("workflow")).toBeUndefined();
    expect(parseUsageKind("agent")).toBe("agent");
    expect(parseStatus("x")).toBeUndefined();
    expect(parseStatus("unused")).toBe("unused");
  });
});
