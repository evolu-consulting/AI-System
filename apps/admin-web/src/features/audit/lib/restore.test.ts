// ADM-FR-52 · M4-R13 · test câu khôi phục (tiêu đề, lỗi 409/400).

import { describe, expect, test } from "bun:test";
import type { AuditItem } from "@ai/contracts";
import { ApiError } from "@/lib/http";
import { displayName, restoreErrorSpec, restoreParams } from "./restore";

const item = {
  entity: "command",
  entity_name: "/dich",
  entity_version: 43,
} as AuditItem;
const t = (k: string) => (k === "audit.entity.command" ? "command" : k);

describe("restore", () => {
  test("displayName thêm `/` cho command, giữ nguyên thực thể khác", () => {
    expect(displayName("command", "dich")).toBe("/dich");
    expect(displayName("command", "/dich")).toBe("/dich");
    expect(displayName("group", "Kế toán")).toBe("Kế toán");
  });

  test("restoreParams: trước v{entity_version}, bản mới = +1", () => {
    expect(restoreParams(item)).toEqual({ name: "/dich", n: 43, next: 44 });
  });

  test("NAME_TAKEN dùng details.name + loại thực thể", () => {
    const err = new ApiError(409, "NAME_TAKEN", "x", { entity: "command", name: "dich" });
    expect(restoreErrorSpec(err, { ...item, entity_name: "/dich2" }, t)).toEqual({
      key: "audit.error.nameTaken",
      params: { name: "/dich", entityType: "command" },
    });
  });

  test("409/400 khác → key riêng; 403/mạng → null", () => {
    const spec = (code: ApiError["code"], status = 409) =>
      restoreErrorSpec(new ApiError(status, code, "x"), item, t)?.key ?? null;
    expect(spec("VERSION_CONFLICT")).toBe("audit.error.changedSince");
    expect(spec("NOT_RESTORABLE")).toBe("audit.error.notRestorable");
    expect(spec("RESTORE_REF_MISSING")).toBe("audit.error.refMissing");
    expect(spec("VALIDATION_ERROR", 400)).toBe("audit.error.invalid");
    expect(spec("FORBIDDEN", 403)).toBeNull();
    expect(restoreErrorSpec(new Error("x"), item, t)).toBeNull();
  });
});
