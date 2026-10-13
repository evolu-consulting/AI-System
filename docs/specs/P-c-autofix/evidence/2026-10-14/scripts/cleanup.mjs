// Dọn dữ liệu uat- của UAT P-c1 (tenant evolu): run + kết quả tự-sửa + file diff/log, def bản chép fixbug-apply, nguồn repo/uat-*, user uat-outsider.
// Giữ lại: tin nhắn trong thread phòng Evolu team, job lịch sử (hub.jobs), template nền tảng fixbug-apply, locale user julian.bui (đã trả về en).
import { login, hub, AUTH } from "./api.mjs";
import { sql } from "./sql.mjs";
const EV = "01a11c1d-ca4e-7000-b4eb-212defbb548f";
const defId = sql(`select id from hub.process_defs where key='fixbug-apply' and tenant_id='${EV}'`);
const out = {};
if (defId) {
  out.runs = sql(`select count(*) from hub.process_runs where process_def_id='${defId}'`);
  out.attachments = sql(`with d as (delete from hub.attachments where id in (select diff_attachment_id from hub.autofix_results union select test_log_attachment_id from hub.autofix_results) returning 1) select count(*) from d`);
  out.autofix_results_before = sql("select count(*) from hub.autofix_results");
  out.room_messages = sql(`with d as (delete from hub.room_messages where process_run_id in (select id from hub.process_runs where process_def_id='${defId}') returning 1) select count(*) from d`);
  sql(`delete from hub.process_runs where process_def_id='${defId}'`);
  out.autofix_results_after = sql("select count(*) from hub.autofix_results");
  const t = await login("evolu", "julian.bui");
  const dv = sql(`select version from hub.process_defs where id='${defId}'`);
  const r = await fetch("http://localhost:4000/process-defs/" + defId + "?version=" + dv, { method: "DELETE", headers: { authorization: "Bearer " + t } });
  out.def_delete = r.status;
}
const p = await login("platform", "admin");
for (const k of ["repo", "uat-calc", "uat-lib", "uat-gh"]) {
  const r = await fetch(`http://localhost:4000/admin/sources/${k}?tenant_id=${EV}&version=1`, { method: "DELETE", headers: { authorization: "Bearer " + p } });
  out["source_" + k] = r.status;
}
// user uat-outsider: API không có xoá user ⇒ khoá (còn lại trong DB)
const u = sql(`select id from admin.users where username='uat-outsider'`);
if (u) {
  const r = await fetch(`${AUTH}/admin/users/${u}/lock?tenant_id=${EV}`, { method: "POST", headers: { authorization: "Bearer " + p } });
  out.user_lock = r.status;
}
// trả locale julian.bui về en
const tj = await login("evolu", "julian.bui");
out.locale = (await fetch(`${AUTH}/auth/me`, { method: "PATCH", headers: { authorization: "Bearer " + tj, "content-type": "application/json" }, body: JSON.stringify({ locale: "en" }) })).status;
console.log(JSON.stringify(out));
console.log("còn lại:", sql("select (select count(*) from hub.sources where deleted_at is null and key in ('repo','uat-calc','uat-lib','uat-gh'))||' nguồn; '||(select count(*) from hub.process_defs where key='fixbug-apply' and tenant_id is not null)||' def; '||(select count(*) from admin.users where username='uat-outsider')||' user'"));
