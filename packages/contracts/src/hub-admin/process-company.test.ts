// CR-121 c9 · unit schema: lọc `slot`/`def_id` của GET /process-runs, mã lỗi mới.
import { describe, expect, it } from "bun:test";
import { ProcessRunListQuerySchema } from "../chat/processes-api";
import { ProcessLibraryViewSchema } from "./process-company";

const ID = "c1219000-0000-4000-8000-000000000001";

describe("CR-121 c9 · contracts", () => {
  it("đọc chỉ-xem luôn read_only=true (không có quyền sửa)", () => {
    const v = {
      read_only: true,
      def_id: ID,
      slot: "contracts.approval",
      slot_label: "Duyệt hợp đồng",
      name: "QT",
      description: "",
      rel_version: 2,
      stages: [],
      slot_body: null,
      company_copy: null,
      runs: [],
    };
    expect(ProcessLibraryViewSchema.safeParse(v).success).toBe(true);
    expect(ProcessLibraryViewSchema.safeParse({ ...v, read_only: false }).success).toBe(false);
  });

  it("GET /process-runs nhận slot đúng dạng <gói>.<việc> và def_id uuid", () => {
    const q = ProcessRunListQuerySchema.safeParse({ slot: "contracts.approval", def_id: ID });
    expect(q.success).toBe(true);
    expect(ProcessRunListQuerySchema.safeParse({ slot: "Sai Dang" }).success).toBe(false);
    expect(ProcessRunListQuerySchema.safeParse({ def_id: "x" }).success).toBe(false);
  });
});
