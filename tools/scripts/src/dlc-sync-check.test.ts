import { describe, expect, test } from "bun:test";
import { classify, groupFiles, journalWhenIssues, migrationIssues } from "./dlc-sync-check";

describe("dlc-handoff · dlc:check", () => {
  test("classify: DLC / seam / other", () => {
    expect(classify("apps/dlc-workspace/src/a.ts")).toBe("dlc");
    expect(classify("packages/db/migrations-pack-dlc/0002_x.sql")).toBe("dlc");
    expect(classify("packages/db/migrations-hub/0071_x.sql")).toBe("seam");
    expect(classify("packages/i18n/locales/process/admin.vi.json")).toBe("seam");
    expect(classify("apps/web/src/x.ts")).toBe("other");
  });

  test("groupFiles chia đúng nhóm", () => {
    const g = groupFiles(["tools/dlc-dify/a.py", ".env.example", "README.md"]);
    expect(g).toEqual({
      dlc: ["tools/dlc-dify/a.py"],
      seam: [".env.example"],
      other: ["README.md"],
    });
  });

  test("migrationIssues: va số khác tên, ngoài dải, file chung bỏ qua", () => {
    const ours = ["0069_a.sql", "0070_dlc_library_seed.sql", "0071_ours.sql"];
    const theirs = [
      "0069_a.sql",
      "0070_dlc_library_seed.sql",
      "0071_dlc_x.sql",
      "0072_dlc_y.sql",
      "0090_z.sql",
    ];
    const r = migrationIssues(ours, theirs);
    expect(r.collisions).toEqual(["0071_dlc_x.sql (HEAD đã có 0071_ours.sql)"]);
    expect(r.outOfRange).toEqual(["0090_z.sql"]);
  });

  test("journalWhenIssues: entry DLC mới có when ≤ max HEAD ⇒ lỗi (drizzle bỏ qua); bằng cũng lỗi; lớn hơn OK", () => {
    const ours = [
      { tag: "0070_dlc_library_seed", when: 1801200000000 },
      { tag: "0082_sweep_claim_indexes", when: 1802000000000 },
    ];
    const theirs = [
      { tag: "0070_dlc_library_seed", when: 1801200000000 },
      { tag: "0071_dlc_old", when: 1801300000000 },
      { tag: "0072_dlc_eq", when: 1802000000000 },
      { tag: "0073_dlc_new", when: 1802100000000 },
    ];
    expect(journalWhenIssues(ours, theirs)).toEqual([
      "0071_dlc_old when=1801300000000 ≤ max HEAD 1802000000000",
      "0072_dlc_eq when=1802000000000 ≤ max HEAD 1802000000000",
    ]);
    expect(journalWhenIssues(ours, ours)).toEqual([]);
  });
});
