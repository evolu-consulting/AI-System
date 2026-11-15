import { describe, expect, it } from "bun:test";
import { fileKeyOf, fileKeyParts } from "./partner.files";

const T = "11111111-1111-4111-8111-111111111111";
const F = "22222222-2222-4222-8222-222222222222";

describe("CR-169 · khoá tệp partner", () => {
  it("khoá = <tenant>/<id>, phân tích ngược", () => {
    expect(fileKeyOf(T, F)).toBe(`${T}/${F}`);
    expect(fileKeyParts(fileKeyOf(T, F))).toEqual({ tenant: T, id: F });
  });
  it("sai dạng ⇒ null", () => {
    for (const k of ["", T, `${T}/x`, `${T}/${F}/y`, `x/${F}`, `${T}/../${F}`])
      expect(fileKeyParts(k)).toBeNull();
  });
});
