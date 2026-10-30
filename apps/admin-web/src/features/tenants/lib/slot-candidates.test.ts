import { describe, expect, test } from "bun:test";
import type { LibraryListItem } from "@/features/processes/library-api";
import { slotCandidates } from "./slot-candidates";

const row = (over: Partial<LibraryListItem>): LibraryListItem =>
  ({
    id: "i",
    key: "k",
    name: "A",
    enabled: true,
    is_template: false,
    stage_count: 2,
    version: 1,
    updated_at: "2026-10-31T00:00:00Z",
    active_runs: 0,
    slot: "contracts.approval",
    published_version: 1,
    ...over,
  }) as LibraryListItem;

describe("slotCandidates", () => {
  test("chỉ cùng khe + đã xuất bản + đang bật, sắp theo nhãn", () => {
    const out = slotCandidates(
      [
        row({ id: "b", name: "B", published_version: 3 }),
        row({ id: "a", name: "A" }),
        row({ id: "d", name: "Nháp", published_version: null }),
        row({ id: "o", name: "Khác", slot: "community.x" }),
        row({ id: "x", name: "Tắt", enabled: false }),
      ],
      "contracts.approval",
    );
    expect(out).toEqual([
      { id: "a", label: "A · v1" },
      { id: "b", label: "B · v3" },
    ]);
  });
  test("không có dữ liệu ⇒ rỗng", () => {
    expect(slotCandidates(undefined, "contracts.approval")).toEqual([]);
  });
});
