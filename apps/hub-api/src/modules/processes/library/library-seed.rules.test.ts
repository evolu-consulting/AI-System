// CR-105 · L2a · hub 0069 seed def "Quy trình HĐ mặc định" là JSON tĩnh trong SQL — khớp đúng `defaultSlotBody()` + `compileSlotStages`
// (đổi luật biên dịch mà quên migration mới ⇒ test này đỏ).
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compileSlotStages } from "../../packs/contracts/domain/approval-slot.rules";
import {
  APPROVAL_DEFAULT_DEF,
  defaultSlotBody,
} from "../../packs/contracts/domain/approval-slot-default.rules";

const SQL = readFileSync(
  join(
    import.meta.dir,
    "../../../../../../packages/db/migrations-hub/0069_process_library_seed.sql",
  ),
  "utf8",
);
const jsonLits = [...SQL.matchAll(/'(\[\{.*?\}\]|\{"steps".*?\})'::jsonb/g)].map((m) =>
  JSON.parse((m[1] as string).replaceAll("''", "'")),
);

describe("CR-105 · seed 0069", () => {
  it("def mặc định 0069 = defaultSlotBody + compileSlotStages, id/key cố định", () => {
    const body = defaultSlotBody();
    expect(jsonLits.find((j) => !Array.isArray(j))).toEqual(body);
    expect(jsonLits.find((j) => Array.isArray(j) && j[0]?.key === "s0")).toEqual(
      compileSlotStages(body),
    );
    expect(SQL).toContain(`'${APPROVAL_DEFAULT_DEF.id}'`);
    expect(SQL).toContain(`'${APPROVAL_DEFAULT_DEF.key}'`);
  });
});
