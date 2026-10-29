// CR-103 · R4 fnr-showcase: node `set` của editor — đổi qua lại draft ↔ contract, ép giá trị Hub ép (như `tool-form`). Thuần.
import type { SetExecutor } from "@ai/contracts/hub-admin";
import { emptyAutofix } from "./autofix-form";
import type { SetDraft, SetRowDraft, StageDraft } from "./draft-types";

/** Giá trị `StageDraft.executor` của kiểu "Ghi giá trị". */
export const SET_EXECUTOR = "set";
export const SET_SECTION = "Kết quả";
export const SET_ROWS_MAX = 20;

export const emptySetRow = (): SetRowDraft => ({ key: "", source: "input", input: "", value: "" });
export const emptySet = (): SetDraft => ({ rows: [] });
export const isSet = (s: Pick<StageDraft, "executor">): boolean => s.executor === SET_EXECUTOR;
export const SET_PATCH: Partial<StageDraft> = { executor: SET_EXECUTOR };

/** Bản dùng để gửi/validate: Hub ép template/mục/answerer/nguồn; giữ `fields`, `filename`, `timeout`. */
export function normalizeSet(s: StageDraft): StageDraft {
  if (!isSet(s)) return s;
  return {
    ...s,
    instruction: "",
    template: `# ${s.name.trim()}\n\n## ${SET_SECTION}\n`,
    sections: [SET_SECTION],
    answerer: "starter",
    answererId: "",
    budget: "",
    sources: [],
    mustKnow: "",
    autofix: emptyAutofix(),
  };
}

export function setFromDef(ex: SetExecutor): SetDraft {
  return {
    rows: ex.values.map((v) =>
      "input" in v.from
        ? { key: v.key, source: "input", input: v.from.input, value: "" }
        : { key: v.key, source: "const", input: "", value: String(v.from.const) },
    ),
  };
}

/** Hằng số hợp lệ (chuỗi số hữu hạn, không rỗng) ⇒ số; còn lại giữ chuỗi. */
const constOf = (v: string): string | number =>
  v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : v;

/** Dòng chưa chọn field / nguồn bị bỏ (lỗi thiếu hiện live ở lúc lưu bằng luật server `SET_INVALID`). */
export function setToDef(d: SetDraft): SetExecutor {
  const values: SetExecutor["values"] = [];
  for (const r of d.rows) {
    if (r.key === "") continue;
    if (r.source === "input") {
      if (r.input !== "") values.push({ key: r.key, from: { input: r.input } });
    } else values.push({ key: r.key, from: { const: constOf(r.value) } });
  }
  return { kind: "set", values };
}
