// Helper (API, token julian.bui): cấu hình def fixbug-apply của evolu cho từng kịch bản. Dùng: import { setDef, getDef, GROUPS }
import { login, hub } from "./api.mjs";
import { sql } from "./sql.mjs";
export const b64 = (s) => Buffer.from(s).toString("base64");
export const FIXED = "export function add(a: number, b: number): number {\n  return a + b;\n}\n";
export async function getDef() {
  const t = await login("evolu", "julian.bui");
  const it = (await hub(t, "GET", "/process-defs?include_templates=false&limit=100")).json.items.find((d) => d.key === "fixbug-apply");
  return { t, def: (await hub(t, "GET", "/process-defs/" + it.id)).json };
}
export async function setDef({ enabled = true, af = {}, instruction, reviewGroup, output, defSources } = {}) {
  const { t, def } = await getDef();
  const b = structuredClone(def);
  for (const k of ["is_template", "source_template_id", "created_at", "updated_at"]) delete b[k];
  const id = b.id; delete b.id; delete b.tenant_id;
  b.enabled = enabled;
  if (defSources) b.sources = defSources;
  const s = b.stages[0];
  s.autofix = { ...s.autofix, ...af };
  if (instruction !== undefined) s.instruction = instruction;
  if (output) s.output = { ...s.output, ...output };
  if (reviewGroup !== undefined) s.after = { kind: "review", group_id: reviewGroup };
  const noSec = !(s.output.required_sections?.length);
  if (noSec) s.output = { ...s.output, required_sections: ["Thay đổi"] };
  const r = await hub(t, "PUT", "/process-defs/" + id, b);
  if (noSec) sql("update hub.process_defs set stages = jsonb_set(stages,'{0,output,required_sections}','[]'::jsonb) where key='fixbug-apply' and tenant_id is not null");
  if (r.status !== 200) throw new Error("PUT def " + r.status + JSON.stringify(r.json).slice(0, 300));
  return r.json;
}
export const BASE_INSTR = "Tái hiện lỗi theo mô tả, tìm nguyên nhân gốc và sửa trong /workspace bằng ws_*; chạy lệnh test tới khi xanh rồi tóm tắt thay đổi. #fake:sections=Thay đổi|Test|Bàn giao";
