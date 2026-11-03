// dlc-engine · hub 0070 seed def thư viện mặc định cho 3 khe DLC là JSON tĩnh trong SQL — khớp đúng `dlcSeedRows()` (đổi luật
// biên dịch / sơ đồ mặc định mà quên migration mới ⇒ test này đỏ).
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dlcSeedRows } from "./dlc-seed.rules";

const SQL = readFileSync(
  join(
    import.meta.dir,
    "../../../../../../../packages/db/migrations-hub/0070_dlc_library_seed.sql",
  ),
  "utf8",
);
const lits = [...SQL.matchAll(/'(\[\{.*?\}\]|\{"steps".*?\})'::jsonb/g)].map((m) =>
  JSON.parse((m[1] as string).replaceAll("''", "'")),
);

describe("dlc-engine · seed 0070", () => {
  it("mỗi khe: stages + slot_body trong SQL = code; id / khoá / khe cố định", () => {
    for (const r of dlcSeedRows()) {
      expect(lits).toContainEqual(r.stages);
      expect(lits).toContainEqual(r.body);
      expect(SQL).toContain(`'${r.id}', NULL, '${r.key}'`);
      expect(SQL).toContain(`VALUES ('${r.slot}', '${r.id}')`);
    }
  });
});
