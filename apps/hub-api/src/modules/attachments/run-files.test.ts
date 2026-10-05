// HUB-FR-44 · HUB-FR-75 · spec-decisions "REVIEW 1 — Hub" RV-7: `attachment_ids` chuẩn hoá chữ thường; trùng sau chuẩn hoá
// ⇒ 400 `VALIDATION_ERROR` issue `duplicate` như contract.
import { describe, expect, test } from "bun:test";
import { AppError } from "../../lib/errors";
import { normalizeAttachmentIds } from "./run-files";

const U1 = "0B3E6F4C-1D2A-4C5B-8E9F-00000000000A";
const u1 = U1.toLowerCase();
const u2 = "0b3e6f4c-1d2a-4c5b-8e9f-00000000000b";

const thrown = (f: () => unknown): unknown => {
  try {
    f();
  } catch (e) {
    return e;
  }
  return null;
};

describe("normalizeAttachmentIds [RV-7 · H2c-R09]", () => {
  test("HUB-FR-44 · chữ hoa → chữ thường, giữ thứ tự; rỗng ⇒ rỗng", () => {
    expect(normalizeAttachmentIds([U1, u2])).toEqual([u1, u2]);
    expect(normalizeAttachmentIds([u2, U1])).toEqual([u2, u1]);
    expect(normalizeAttachmentIds([])).toEqual([]);
  });

  test("HUB-FR-44 · [U1, u1] (trùng sau chuẩn hoá) ⇒ 400 VALIDATION_ERROR issue attachment_ids duplicate", () => {
    for (const ids of [
      [U1, u1],
      [u1, u2, U1],
    ]) {
      const e = thrown(() => normalizeAttachmentIds(ids));
      expect(e).toBeInstanceOf(AppError);
      const a = e as AppError;
      expect({ code: a.code, status: a.status, details: a.details }).toEqual({
        code: "VALIDATION_ERROR",
        status: 400,
        details: {
          issues: [{ path: ["attachment_ids"], code: "custom", message: "duplicate" }],
        },
      });
    }
  });
});
