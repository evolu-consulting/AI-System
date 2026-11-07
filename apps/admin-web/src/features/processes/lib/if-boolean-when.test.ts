// CR-123 · u4 · lỗi demo: "Đối tác mới là Có" ở node Nếu bị Hub từ chối FLOW_WHEN_INVALID. Dựng điều kiện như trình sửa rồi qua luật Hub (`condOk`).
import { describe, expect, test } from "bun:test";
import { emptyStage } from "./def-form";
import { eventOf, toFlowDef, validateFlowDef } from "./flow-def";
import { draftToIf } from "./if-form";

const ev = eventOf("contracts", "contract.submitted");
const bool = ev?.facts.find((f) => f.type === "boolean");
if (!ev || !bool) throw new Error("manifest thiếu dữ kiện Có/Không");
const meta = {
  key: "duyet-hd",
  name: "Duyệt HĐ",
  app: "contracts",
  owner: "library" as const,
  trigger: { event: "contract.submitted" },
};
const outcome = ev.outcomes[0]?.key;
const stage = (step: number, extra: object) => ({
  ...emptyStage(step),
  key: `s${step}`,
  name: `s${step}`,
  filename: "out.md",
  executor: "set",
  ...extra,
});
const ifStage = (op: string, value: string) =>
  stage(0, {
    executor: "if",
    ifx: {
      op: "and",
      conds: [{ from: `fact|${bool.key}`, type: "string", op, value }],
      yes: 2,
      no: null,
    },
  });
const issues = (stages: object[], m: object = meta) =>
  validateFlowDef(toFlowDef(stages as never, m as never), "contracts").map((i) => i.path);

describe("điều kiện Có/Không", () => {
  test("node Nếu 'là Có' / 'không là Không' (chuỗi true/false) qua luật Hub", () => {
    const end = stage(1, { outcome });
    for (const [op, v] of [
      ["eq", "true"],
      ["eq", "false"],
      ["ne", "true"],
    ] as const)
      expect(issues([ifStage(op, v), end]).filter((p) => p.includes("conds"))).toEqual([]);
  });
  test("editor phát đúng chuỗi true/false, không phải chữ tự gõ", () => {
    const c = draftToIf({
      op: "and",
      conds: [{ from: `fact|${bool.key}`, type: "string", op: "eq", value: "true" }],
      yes: 2,
      no: null,
    }).when.conds[0];
    expect(c?.value).toBe("true");
  });
  test("chữ lạ / phép thứ tự trên Có/Không vẫn bị chặn", () => {
    const end = stage(1, { outcome });
    expect(issues([ifStage("eq", "yes"), end])).toContain("stages.0.executor.when.conds.0");
    expect(issues([ifStage("gt", "true"), end])).toContain("stages.0.executor.when.conds.0");
  });
  test("Bắt đầu khi: dữ kiện Có/Không dùng boolean thật và qua luật Hub", () => {
    const ok = {
      ...meta,
      trigger: {
        event: "contract.submitted",
        when: { op: "and", conds: [{ fact: bool.key, op: "eq", value: true }] },
      },
    };
    const bad = {
      ...meta,
      trigger: {
        event: "contract.submitted",
        when: { op: "and", conds: [{ fact: bool.key, op: "eq", value: "true" }] },
      },
    };
    const end = [stage(0, { outcome })];
    expect(issues(end, ok).filter((p) => p.startsWith("trigger"))).toEqual([]);
    expect(issues(end, bad).filter((p) => p.startsWith("trigger"))).not.toEqual([]);
  });
});
