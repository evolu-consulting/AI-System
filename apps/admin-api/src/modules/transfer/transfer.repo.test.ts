// ADM-FR-54 · review M4 #3 · trần snapshot: vượt → 413 thay vì cắt im lặng.
import { describe, expect, it } from "bun:test";
import { IMPORT_MAX_BYTES } from "@ai/contracts";
import { capRows, SNAPSHOT_ROW_CAP } from "./transfer.repo";

describe("ADM-FR-54 · capRows", () => {
  it("≤ trần → giữ nguyên; trần + 1 → PAYLOAD_TOO_LARGE {max_bytes}", () => {
    const at = Array.from({ length: SNAPSHOT_ROW_CAP }, (_, i) => i);
    expect(capRows(at)).toHaveLength(SNAPSHOT_ROW_CAP);
    let err: { code?: string; details?: unknown } | null = null;
    try {
      capRows([...at, SNAPSHOT_ROW_CAP]);
    } catch (e) {
      err = e as { code?: string; details?: unknown };
    }
    expect([err?.code, err?.details]).toEqual([
      "PAYLOAD_TOO_LARGE",
      { max_bytes: IMPORT_MAX_BYTES },
    ]);
  });
});
