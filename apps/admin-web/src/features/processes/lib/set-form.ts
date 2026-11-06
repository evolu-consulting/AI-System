// CR-103 · R4 fnr-showcase: node `set` của editor — đổi qua lại draft ↔ contract, ép giá trị Hub ép (như `tool-form`). Thuần.
import type { SetExecutor, SetValue } from "@ai/contracts/hub-admin";
import { emptyAutofix } from "./autofix-form";
import type { SetDraft, SetRowDraft, StageDraft } from "./draft-types";

/** Giá trị `StageDraft.executor` của kiểu "Ghi giá trị". */
export const SET_EXECUTOR = "set";
export const SET_SECTION = "Kết quả";
export const SET_ROWS_MAX = 20;

export const emptySetRow = (): SetRowDraft => ({
  key: "",
  source: "input",
  input: "",
  value: "",
  step: null,
  ref: "",
  as: "",
});
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
    rows: ex.values.map((v): SetRowDraft => {
      const row: SetRowDraft = { ...emptySetRow(), key: v.key, as: v.as ?? "" };
      const f = v.from;
      if ("input" in f) return { ...row, source: "input", input: f.input };
      if ("const" in f) return { ...row, source: "const", value: String(f.const) };
      return f.kind === "field"
        ? { ...row, source: "field", step: f.step, ref: f.key }
        : { ...row, source: "fact", ref: f.key };
    }),
  };
}
/** Hằng số hợp lệ (chuỗi số hữu hạn, không rỗng) ⇒ số; còn lại giữ chuỗi. */
const constOf = (v: string): string | number =>
  v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : v;

/** Nguồn của một dòng; chưa chọn đủ ⇒ null (dòng bị bỏ, lỗi thiếu hiện live ở lúc lưu bằng luật server `SET_INVALID`). */
function fromOf(r: SetRowDraft): SetValue["from"] | null {
  if (r.source === "input") return r.input === "" ? null : { input: r.input };
  if (r.source === "const") return { const: constOf(r.value) };
  if (r.source === "fact") return r.ref === "" ? null : { kind: "fact", key: r.ref };
  return r.step === null || r.ref === "" ? null : { kind: "field", step: r.step, key: r.ref };
}

export function setToDef(d: SetDraft): SetExecutor {
  const values: SetExecutor["values"] = [];
  for (const r of d.rows) {
    const from = r.key === "" ? null : fromOf(r);
    if (from) values.push({ key: r.key, from, ...(r.as ? { as: r.as } : {}) });
  }
  return { kind: "set", values };
}
