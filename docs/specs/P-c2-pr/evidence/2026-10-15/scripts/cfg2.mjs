// Helper UAT P-c2: cấu hình nguồn `repo` + def `fixbug-pr` (bản chép của evolu) cho từng kịch bản.
import { login, hub } from "./api.mjs";
import { sql } from "./sql.mjs";
export const EV = "01a11c1d-ca4e-7000-b4eb-212defbb548f";
export const REV = "a7ed5de4-bb6f-45bb-bdd7-a4f5598983be"; // nhóm "SDLC - người duyệt" (vio.ngo)
export const b64 = (s) => Buffer.from(s).toString("base64");
export const FIXED = "export function add(a: number, b: number): number {\n  return a + b;\n}\n";
export const GH_URL = "https://github.com/pc2-uat/app.git";
export const ghCfg = (o = {}) => ({ kind: "git_remote", url: GH_URL, branch: "main", ...o });
export const tok = (u = "julian.bui", t = "evolu") => login(t, u);
export async function getSource(t, key = "repo") { return (await hub(t, "GET", "/admin/sources/" + key)).json; }
/** PUT nguồn (giữ version). */
export async function putSource(t, key, config, description) {
  const s = await getSource(t, key);
  const r = await hub(t, "PUT", "/admin/sources/" + key, { version: s.version, config, description: description ?? s.description });
  if (r.status !== 200) throw new Error("PUT source " + r.status + JSON.stringify(r.json).slice(0, 300));
  return r.json;
}
export async function getDef(t, key = "fixbug-pr") {
  const l = (await hub(t, "GET", "/process-defs?include_templates=false&limit=100")).json.items.find((d) => d.key === key);
  if (!l) return null;
  return (await hub(t, "GET", "/process-defs/" + l.id)).json;
}
export async function ensureDef(t) {
  let d = await getDef(t);
  if (d) return d;
  const tpl = (await hub(t, "GET", "/process-defs?include_templates=true&limit=100")).json.items.find((x) => x.key === "fixbug-pr");
  const r = await hub(t, "POST", `/process-defs/${tpl.id}/copy`, {});
  if (r.status !== 201) throw new Error("copy " + r.status + JSON.stringify(r.json).slice(0, 300));
  return r.json;
}
/** test_cmd (kèm #fake:apply=…), nguồn, bật/tắt. */
export async function setDef(t, { testCmd, sourceKey = "repo", enabled = true, instruction } = {}) {
  const def = await ensureDef(t);
  const b = structuredClone(def);
  for (const k of ["is_template", "source_template_id", "created_at", "updated_at", "id", "tenant_id"]) delete b[k];
  b.enabled = enabled;
  b.sources = [sourceKey];
  const s = b.stages[0];
  s.autofix = { ...s.autofix, source_key: sourceKey, install_cmd: null, write_allowlist: ["src/**", "test/**"], ...(testCmd ? { test_cmd: testCmd } : {}) };
  s.after = { kind: "review", group_id: REV };
  if (instruction) s.instruction = instruction;
  const r = await hub(t, "PUT", "/process-defs/" + def.id, b);
  if (r.status !== 200) throw new Error("PUT def " + r.status + JSON.stringify(r.json).slice(0, 400));
  return r.json;
}
export const INSTR = "Tái hiện lỗi theo mô tả, tìm nguyên nhân gốc và sửa trong /workspace bằng ws_*; chạy lệnh test tới khi xanh rồi tóm tắt thay đổi. #fake:sections=Thay đổi|Test|Bàn giao";
export { sql, hub, login };
