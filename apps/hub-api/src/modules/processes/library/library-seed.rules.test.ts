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

  it("seed 0069 trỏ phòng ban bằng *_group_key, *_group_id null (body và stage.slot)", () => {
    type Step = Record<string, unknown>;
    const body = jsonLits.find((j) => !Array.isArray(j)) as { steps: Step[] };
    const stages = jsonLits.find((j) => Array.isArray(j) && j[0]?.key === "s0") as {
      slot?: Step;
    }[];
    const refs = (s: Step) => [
      s.key,
      s.department_group_key,
      s.department_group_id,
      s.escalate_group_id,
    ];
    const want = [
      ["level1", "contracts-editor", null, null],
      ["level2", "contracts-owner", null, null],
    ];
    expect(body.steps.map(refs)).toEqual(want);
    expect(stages.flatMap((s) => (s.slot ? [refs(s.slot)] : []))).toEqual(want);
    // Không mã phòng ban nào nằm trong trường *_group_id.
    expect(SQL).not.toMatch(/"(department|escalate)_group_id":"[a-z]/);
  });
});
