// CR-121 R6 · c16 · unit lõi trang Công cụ AI (danh sách gộp agent · lệnh · workflow).
import { describe, expect, test } from "bun:test";
import type { AiTool } from "@ai/contracts/workflow-tools";
import {
  companyTally,
  filterTools,
  idTail,
  initial,
  moreCompanies,
  parseKind,
  parseStatus,
  sliceShown,
  toolCounts,
} from "./ai-tools";

const tool = (p: Partial<AiTool>): AiTool => ({
  kind: "workflow",
  id: "00000000-0000-4000-8000-000000000001",
  name: "Xuất hợp đồng",
  description: "Xuất hợp đồng ra file Word",
  enabled: true,
  side_effect: false,
  companies_count: 0,
  companies: [],
  secret: null,
  key: null,
  ...p,
});

const items = [
  tool({
    kind: "agent",
    id: "00000000-0000-4000-8000-0000000abcdef",
    name: null,
    description: null,
    companies_count: 7,
    companies: ["A", "B"],
  }),
  tool({ kind: "command", name: "dich", description: null, companies_count: 1, companies: ["A"] }),
  tool({ name: "Bug Fix", enabled: false }),
  tool({
    name: "Tra tri thức",
    description: "tìm trong kho",
    companies_count: 2,
    companies: ["A", "B"],
  }),
];

describe("filterTools", () => {
  test("Đang bật = bật toàn hệ thống; Chưa dùng = chưa công ty nào dùng", () => {
    expect(filterTools(items, { status: "on" })).toHaveLength(3);
    expect(filterTools(items, { status: "unused" }).map((t) => t.name)).toEqual(["Bug Fix"]);
  });
  test("chip loại: agent · lệnh · workflow", () => {
    expect(filterTools(items, { kind: "command" })).toHaveLength(1);
    expect(filterTools(items, { kind: "workflow" })).toHaveLength(2);
  });
  test("ô tìm: tên (lệnh có /), đuôi id agent, mô tả; không phân biệt hoa thường", () => {
    expect(filterTools(items, { q: "/dich" }).map((t) => t.kind)).toEqual(["command"]);
    expect(filterTools(items, { q: "ABCDEF" }).map((t) => t.kind)).toEqual(["agent"]);
    expect(filterTools(items, { q: "kho" }).map((t) => t.name)).toEqual(["Tra tri thức"]);
  });
  test("lọc theo secret (nút ở Secrets) và tìm theo mã workflow", () => {
    const w = [
      tool({ name: "A", secret: "dify-a", key: "xuat-hd" }),
      tool({ name: "B", secret: "dify-b", key: "ghi-so" }),
    ];
    expect(filterTools(w, { secret: "dify-a" }).map((t) => t.name)).toEqual(["A"]);
    expect(filterTools(w, { q: "ghi-so" }).map((t) => t.name)).toEqual(["B"]);
    expect(filterTools(items, { secret: "dify-a" })).toEqual([]);
  });
  test("bộ lọc cộng dồn (AND)", () => {
    expect(filterTools(items, { kind: "agent", status: "unused" })).toEqual([]);
  });
});

describe("đếm, cắt, helper", () => {
  test("đếm chip trên toàn danh mục", () => {
    expect(toolCounts(items)).toEqual({
      all: 4,
      on: 3,
      unused: 1,
      agent: 1,
      command: 1,
      workflow: 2,
    });
  });
  test("Xem thêm: cắt theo số đang hiện", () => {
    expect(sliceShown([1, 2, 3], 2)).toEqual({ rows: [1, 2], more: true });
    expect(sliceShown([1, 2], 2)).toEqual({ rows: [1, 2], more: false });
  });
  test("công ty: bật/tổng, avatar, phần dư ngoài 5 tên", () => {
    expect(companyTally([{ on: true }, { on: false }])).toEqual({ on: 1, total: 2 });
    expect(initial(" công ty")).toBe("C");
    expect(moreCompanies(tool({ companies_count: 8, companies: ["a", "b", "c", "d", "e"] }))).toBe(
      3,
    );
    expect(idTail("00000000-0000-4000-8000-0000000abcdef")).toBe("abcdef");
  });
  test("tham số URL lạ bị bỏ", () => {
    expect(parseKind("workflow")).toBe("workflow");
    expect(parseKind("x")).toBeUndefined();
    expect(parseStatus("unused")).toBe("unused");
    expect(parseStatus("x")).toBeUndefined();
  });
});
