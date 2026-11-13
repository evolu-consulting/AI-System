import { describe, expect, test } from "bun:test";
import { evidenceKind } from "./evidence-kind";

describe("evidenceKind (CR-144)", () => {
  test("chỉ ảnh raster và PDF xem được", () => {
    for (const m of ["image/png", "image/jpeg", "image/webp", "image/gif", "IMAGE/PNG; x=1"])
      expect(evidenceKind(m)).toBe("image");
    expect(evidenceKind("application/pdf")).toBe("pdf");
    for (const m of ["image/svg+xml", "text/html", "application/zip", ""])
      expect(evidenceKind(m)).toBe("other");
  });
});
