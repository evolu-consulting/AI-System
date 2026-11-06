// CR-121 c9 · unit schema: body `{}` của clone-for-company, response 201/200, lọc `slot`/`def_id` của GET /process-runs, mã lỗi mới.
import { describe, expect, it } from "bun:test";
import { ProcessRunListQuerySchema } from "../chat/processes-api";
import {
  CloneForCompanyRequestSchema,
  CloneForCompanyResponseSchema,
  ProcessLibraryViewSchema,
} from "./process-company";
import { HUB_ADMIN_LIBRARY_ERRORS } from "./process-library";

const ID = "c1219000-0000-4000-8000-000000000001";

describe("CR-121 c9 · contracts", () => {
  it("clone-for-company: body chỉ nhận {}", () => {
    expect(CloneForCompanyRequestSchema.safeParse({}).success).toBe(true);
    expect(CloneForCompanyRequestSchema.safeParse({ tenant_id: ID }).success).toBe(false);
  });

  it("response đủ 4 trường, rel_version ≥ 1", () => {
    const ok = { def_id: ID, source_template_id: ID, rel_version: 1, created: false };
    expect(CloneForCompanyResponseSchema.safeParse(ok).success).toBe(true);
    expect(CloneForCompanyResponseSchema.safeParse({ ...ok, rel_version: 0 }).success).toBe(false);
    expect(CloneForCompanyResponseSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });

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

  it("mã lỗi mới là 422", () => {
    expect(HUB_ADMIN_LIBRARY_ERRORS.NOT_LIBRARY_DEF).toBe(422);
    expect(HUB_ADMIN_LIBRARY_ERRORS.SLOT_GONE).toBe(422);
  });
});
