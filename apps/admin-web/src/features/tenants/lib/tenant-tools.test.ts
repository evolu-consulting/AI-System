// ADM-FR-73 · AC-A15 · P-d2 · T20-FE: lọc client của tab "Tool quy trình" + nhãn "Bật bởi".
import { describe, expect, test } from "bun:test";
import type { TenantWorkflowTool } from "@ai/contracts";
import { grantedLabel } from "../components/tools/ToolRow";
import { filterTools } from "../hooks/use-tenant-tools";

const row = (p: Partial<TenantWorkflowTool>): TenantWorkflowTool => ({
  workflow_id: "00000000-0000-4000-8000-000000000001",
  key: "xuat-hd",
  name: "Xuất HĐ",
  side_effect: false,
  enabled: true,
  on: false,
  granted_at: null,
  granted_by: null,
  ...p,
});

describe("filterTools", () => {
  const items = [row({ name: "Xuất HĐ", key: "xuat-hd" }), row({ name: "Ghi sổ", key: "ghi-so" })];
  test("lọc theo tên hoặc ký hiệu, không phân biệt hoa thường", () => {
    expect(filterTools(items, "ghi").map((x) => x.key)).toEqual(["ghi-so"]);
    expect(filterTools(items, "XUẤT").map((x) => x.key)).toEqual(["xuat-hd"]);
    expect(filterTools(items, "khong")).toEqual([]);
  });
  test("rỗng/khoảng trắng ⇒ giữ nguyên", () => {
    expect(filterTools(items, "  ")).toHaveLength(2);
  });
});

describe("grantedLabel", () => {
  const t = (k: string, p?: Record<string, unknown>) => `${k}|${p?.name}|${p?.date}`;
  test("chưa bật / đã tắt (null) ⇒ '—'", () => {
    expect(grantedLabel(t, row({}), "vi-VN")).toBe("—");
    expect(
      grantedLabel(t, row({ granted_at: "2026-10-05T03:00:00.000Z", granted_by: null }), "vi-VN"),
    ).toBe("—");
  });
  test("đang bật ⇒ tên + ngày theo locale", () => {
    const s = grantedLabel(
      t,
      row({ granted_at: "2026-10-05T03:00:00.000Z", granted_by: "Trần Minh Anh" }),
      "en-GB",
    );
    expect(s.startsWith("tenants.tools.grantedBy|Trần Minh Anh|")).toBe(true);
    expect(s).toContain("2026");
  });
});
