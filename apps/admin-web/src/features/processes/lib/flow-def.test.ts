import { describe, expect, test } from "bun:test";
import { CONTRACTS_MANIFEST } from "@ai/contracts/app-manifest";
import { emptyStage } from "./def-form";
import { whenAdd, whenGroup, whenRemove, whenSetOp, withOp } from "./fact-when";
import {
  eventOf,
  eventsOfApp,
  finishPatch,
  nodesForApp,
  retargetEvent,
  toFlowDef,
  validateFlowDef,
} from "./flow-def";

const ev = eventOf("contracts", "contract.submitted");
if (!ev) throw new Error("manifest contracts thiếu contract.submitted");
const total = ev.facts.find((f) => f.type === "number");
if (!total) throw new Error("thiếu dữ kiện số");

const setStage = (name: string, step: number, extra: object = {}) => ({
  ...emptyStage(step),
  key: `st-${name}`,
  name,
  filename: "out.md",
  executor: "set",
  ...extra,
});
const meta = {
  key: "duyet-hd",
  name: "Duyệt HĐ",
  app: "contracts",
  owner: "library" as const,
  trigger: { event: "contract.submitted" },
};

describe("fact-when", () => {
  test("thêm vế theo kiểu, nhóm lồng, đổi phép, xoá về null", () => {
    let w = whenAdd(null, total);
    expect(w.conds).toHaveLength(1);
    w = whenAdd(w, total);
    w = whenGroup(w, 0);
    expect(w.conds[0]).toHaveProperty("op", "or");
    w = whenSetOp(w, "or");
    expect(w.op).toBe("or");
    const one = whenRemove(whenAdd(null, total), [0]);
    expect(one).toBeNull();
  });
  test("đổi toán tử sang/khỏi `in` đổi dạng giá trị", () => {
    const c = withOp({ fact: "x", op: "eq", value: "a" }, "in");
    expect(c.value).toEqual(["a"]);
    expect(withOp(c, "eq").value).toBe("a");
  });
  test("tối đa 6 vế mỗi cấp", () => {
    let w = whenAdd(null, total);
    for (let i = 0; i < 9; i++) w = whenAdd(w, total);
    expect(w.conds).toHaveLength(6);
  });
});

describe("flow-def", () => {
  test("hợp lệ: trigger đúng manifest + Kết thúc đúng kết quả", () => {
    const stages = [setStage("a", 0), setStage("end", 1, { outcome: ev.outcomes[0]?.key })];
    expect(validateFlowDef(toFlowDef(stages, meta), "contracts")).toEqual([]);
  });
  test("thiếu Kết thúc / kết quả lạ / sự kiện lạ báo đúng khoá", () => {
    const a = validateFlowDef(toFlowDef([setStage("a", 0)], meta), "contracts");
    expect(a.map((i) => i.key)).toContain("noFinish");
    const b = validateFlowDef(
      toFlowDef([setStage("e", 0, { outcome: "khong_co" })], meta),
      "contracts",
    );
    expect(b.map((i) => i.key)).toContain("outcomeUnknown");
    const c = validateFlowDef(
      toFlowDef([setStage("e", 0, { outcome: ev.outcomes[0]?.key })], {
        ...meta,
        trigger: { event: "x.y" },
      }),
      "contracts",
    );
    expect(c.map((i) => i.key)).toContain("eventUnknown");
  });
  test("điều kiện sai kiểu dữ kiện ⇒ whenInvalid", () => {
    const w = {
      op: "and" as const,
      conds: [{ fact: total.key, op: "gt" as const, value: "nhieu" }],
    };
    const r = validateFlowDef(
      toFlowDef([setStage("e", 0, { outcome: ev.outcomes[0]?.key })], {
        ...meta,
        trigger: { event: "contract.submitted", when: w },
      }),
      "contracts",
    );
    expect(r.map((i) => i.key)).toContain("whenInvalid");
  });
  test("đổi sự kiện bỏ vế lạ và đưa Kết thúc về kết quả hợp lệ", () => {
    const other = eventsOfApp("contracts").find((e) => e.key !== ev.key);
    if (!other) throw new Error("cần ≥ 2 sự kiện");
    const w = whenAdd(null, total);
    const r = retargetEvent(
      { event: ev.key, when: w },
      [setStage("e", 0, { outcome: "khong_co" })],
      other,
    );
    expect(r.trigger.event).toBe(other.key);
    expect(r.stages[0]?.outcome).toBe(other.outcomes[0]?.key ?? "");
  });
  test("bảng node: có Kết thúc/Nếu/Công cụ; Ký số là node app; Kết thúc dùng kết quả đầu", () => {
    const ids = nodesForApp("contracts").map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining(["if", "tool", "finish", "esign"]));
    expect(nodesForApp("khong-co-app").map((n) => n.id)).not.toContain("esign");
    expect(finishPatch(ev).outcome).toBe(CONTRACTS_MANIFEST.events[0]?.outcomes[0]?.key ?? "");
  });
});
