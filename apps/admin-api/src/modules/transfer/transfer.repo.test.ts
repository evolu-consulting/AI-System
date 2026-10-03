// ADM-FR-54 · review M4 #3 + vòng 2 · trần snapshot: vượt → 400 VALIDATION_ERROR (không mượn 413 kích thước file).
import { describe, expect, it } from "bun:test";
import { capRows, SNAPSHOT_ROW_CAP } from "./transfer.repo";

describe("ADM-FR-54 · capRows", () => {
  it("≤ trần → giữ nguyên; trần + 1 → 400 VALIDATION_ERROR too_big theo loại, không PAYLOAD_TOO_LARGE", () => {
    const at = Array.from({ length: SNAPSHOT_ROW_CAP }, (_, i) => i);
    expect(capRows(at, "groups")).toHaveLength(SNAPSHOT_ROW_CAP);
    type E = { code?: string; status?: number; details?: { issues?: unknown[] } };
    let err: E | undefined;
    try {
      capRows([...at, SNAPSHOT_ROW_CAP], "groups");
    } catch (e) {
      err = e as E;
    }
    expect(err?.code).toBe("VALIDATION_ERROR");
    expect(err?.status).toBe(400);
    expect(err?.details?.issues?.[0]).toMatchObject({ path: ["groups"], code: "too_big" });
  });
});
