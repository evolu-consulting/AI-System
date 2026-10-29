// CR-103 · seed flow mẫu · kiểm + chuẩn hoá def ĐÚNG như đường lưu của API (`DefsService#check` + `withHandoff`): hình dạng contract
// → luật chéo stage/tham chiếu (`validateProcessDef`, gồm luật từng loại node) → Hub ép trường (`ensureHandoff` + `normalizeStage`).
// Thuần (nhận `DefRefs` từ ngoài) để dry-run dùng refs giả và `--apply` dùng refs thật của tenant.
import { type ProcessDefInput, ProcessDefInputSchema } from "@ai/contracts/hub-admin";
import {
  type DefRefs,
  validateProcessDef,
  withHandoff,
} from "../../../apps/hub-api/src/modules/processes/defs/def.rules";

export type ShowcaseCheck = { ok: true; def: ProcessDefInput } | { ok: false; issues: string[] };

/** Mô tả `DefCheck` lỗi thành các dòng ngắn `<mã>: <path>`. */
function describe(c: ReturnType<typeof validateProcessDef>): string[] {
  if (c.ok) return [];
  if (c.code === "PROCESS_REF_INVALID") return [`${c.code}: ${c.path} (${c.ref})`];
  const rules = "rules" in c ? c.rules : [];
  return c.paths.map((p, i) => `${c.code}: ${p}${rules[i] ? ` [${rules[i]}]` : ""}`);
}

export function checkShowcase(input: unknown, refs: DefRefs): ShowcaseCheck {
  const parsed = ProcessDefInputSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => `contracts: ${i.path.join(".")} (${i.message})`),
    };
  const def = parsed.data as ProcessDefInput;
  const issues = describe(validateProcessDef(def, refs));
  return issues.length > 0 ? { ok: false, issues } : { ok: true, def: withHandoff(def) };
}

/** `DefRefs` cho dry-run: chỉ các Group đã biết (không agent/team/user/tool — flow mẫu không dùng). */
export const dryRunRefs = (groupIds: readonly string[]): DefRefs => ({
  agentIds: new Set(),
  teamIds: new Set(),
  groupIds: new Set(groupIds),
  userIds: new Set(),
});
