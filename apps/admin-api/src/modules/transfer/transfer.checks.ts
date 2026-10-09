// ADM-FR-54 · M4-R14 · Q11 · kiểm tham chiếu + luật module cho `planImport` (plan-cd §3.3, §8.3). Thuần.
// CR-055: command không thuộc feature nào được phép (bỏ kiểm BR-10 khi import).
// Luật module gọi qua rules thuần của module đó (commands, workflows), không qua repo. Chỉ mục đổi mới bị kiểm luật;
// mục không đổi chỉ kiểm tham chiếu. Đường dẫn lỗi theo chỉ số trong file (`raw`).
import { CORE_FEATURE_KEY } from "@ai/contracts";
import {
  checkCommandEnable,
  checkInputMap,
  commandNames,
  inputMapError,
} from "../commands/commands.rules";
import { PLATFORM_TENANT_KEY } from "../tenants/tenants.rules";
import { findBrokenCommands } from "../workflows/workflows.rules";
import type { PlanCtx } from "./transfer.import-ctx";

/** feature phải có (DB hoặc file); `noCore` → `core` bị từ chối (tự hiệu lực, không entitlement/grant). */
function refFeature(c: PlanCtx, path: string, key: string, noCore: boolean): boolean {
  if (!c.m.features.has(key)) {
    c.err.add(path, "REF_NOT_FOUND", `Không tìm thấy feature "${key}"`, { ref: key });
    return false;
  }
  if (noCore && key === CORE_FEATURE_KEY) {
    c.err.rule(path, "CORE_FEATURE_PROTECTED", "Feature core tự hiệu lực, không gán được");
    return false;
  }
  return true;
}

/** Tenant chỉ sửa (Q11): `platform` → PLATFORM_TENANT; chưa có → TENANT_NOT_FOUND. Trả true nếu dùng được. */
function refTenant(c: PlanCtx, path: string, key: string): boolean {
  if (key === PLATFORM_TENANT_KEY) {
    c.err.add(path, "PLATFORM_TENANT", "Không nhập được tenant platform");
    return false;
  }
  if (!c.base.tenants.has(key)) {
    c.err.add(path, "TENANT_NOT_FOUND", `Tenant "${key}" chưa có — tạo tenant trước khi nhập`, {
      tenant: key,
    });
    return false;
  }
  return true;
}

function checkTenants(c: PlanCtx): void {
  for (const { i, raw } of c.file.tenants) {
    const at = `tenants[${i}]`;
    if (!refTenant(c, `${at}.key`, raw.key)) continue;
    raw.entitlements.forEach((f, j) => {
      refFeature(c, `${at}.entitlements[${j}]`, f, true);
    });
    const seen = new Set<string>();
    raw.quotas.forEach((q, j) => {
      const path = `${at}.quotas[${j}].feature`;
      const scope = q.feature ?? "";
      if (seen.has(scope)) c.err.add(path, "DUPLICATE_KEY", "Trùng dòng giới hạn cho cùng feature");
      seen.add(scope);
      if (q.feature !== null) refFeature(c, path, q.feature, false);
    });
  }
}

function checkGroups(c: PlanCtx): void {
  for (const { i, raw } of c.file.groups) refTenant(c, `groups[${i}].tenant`, raw.tenant);
}

/** Workflow đổi: tắt khi còn command bật (ngoài file) → WORKFLOW_IN_USE; schema làm hỏng command → SCHEMA_BREAKS_COMMANDS. */
function checkWorkflows(c: PlanCtx): void {
  const inFile = new Set(c.file.commands.map((x) => x.key));
  for (const x of c.diffed.workflows) {
    if (x.op === "unchanged") continue;
    const users = [...c.m.commands.values()].filter(
      (u) => u.workflow === x.key && !inFile.has(u.name),
    );
    const on = users.filter((u) => u.enabled).map((u) => u.name);
    if (!x.after.enabled && on.length > 0)
      c.err.rule(`workflows[${x.i}].enabled`, "WORKFLOW_IN_USE", "Workflow còn command đang bật", {
        commands: on.join(","),
      });
    const mapped = users.map((u) => ({ id: u.name, name: u.name, inputMap: u.input_map }));
    const broken = findBrokenCommands(x.after.input_schema, mapped);
    if (broken.length > 0)
      c.err.rule(
        `workflows[${x.i}].input_schema`,
        "SCHEMA_BREAKS_COMMANDS",
        "Schema mới làm hỏng input_map của command",
        { commands: broken.map((b) => b.name).join(",") },
      );
  }
}

/** Tên chính + alias → các command đang giữ (trạng thái sau import). */
function nameOwners(c: PlanCtx): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const cmd of c.m.commands.values())
    for (const n of commandNames(cmd)) owners.set(n, [...(owners.get(n) ?? []), cmd.name]);
  return owners;
}

function checkCommandRules(c: PlanCtx, x: PlanCtx["diffed"]["commands"][number]): void {
  const at = `commands[${x.i}]`;
  const wf = c.m.workflows.get(x.after.workflow);
  if (!wf) return;
  const mapErr = inputMapError(checkInputMap(wf.input_schema, x.after.args, x.after.input_map));
  if (mapErr) c.err.rule(`${at}.input_map`, mapErr.code, "input_map không khớp schema workflow");
  const en = checkCommandEnable(x.after.enabled, { id: wf.key, key: wf.key, enabled: wf.enabled });
  if (en) c.err.rule(`${at}.enabled`, en.code, `Workflow "${wf.key}" đang tắt`);
}

function checkCommands(c: PlanCtx): void {
  const owners = nameOwners(c);
  for (const x of c.diffed.commands) {
    const at = `commands[${x.i}]`;
    if (!c.m.workflows.has(x.after.workflow))
      c.err.add(
        `${at}.workflow`,
        "REF_NOT_FOUND",
        `Không tìm thấy workflow "${x.after.workflow}"`,
        {
          ref: x.after.workflow,
        },
      );
    if (x.op === "unchanged") continue;
    checkCommandRules(c, x);
    for (const n of commandNames(x.after)) {
      const other = (owners.get(n) ?? []).find((o) => o !== x.key);
      if (other === undefined) continue;
      const path = n === x.key ? `${at}.name` : `${at}.aliases`;
      c.err.rule(path, "COMMAND_NAME_TAKEN", `Tên "${n}" đã dùng bởi command "${other}"`, {
        name: n,
        command: other,
      });
    }
  }
}

function checkFeatures(c: PlanCtx): void {
  for (const x of c.diffed.features) {
    const at = `features[${x.i}]`;
    x.raw.commands.forEach((n, j) => {
      if (!c.m.commands.has(n))
        c.err.add(`${at}.commands[${j}]`, "REF_NOT_FOUND", `Không tìm thấy command "${n}"`, {
          ref: n,
        });
    });
    if (x.op !== "unchanged" && x.key === CORE_FEATURE_KEY && x.after.status !== "on")
      c.err.rule(`${at}.status`, "CORE_FEATURE_PROTECTED", "Feature core luôn bật");
  }
}

/** Grant mới: group + feature phải có; tenant phải có entitlement (DB hoặc cùng file) → NOT_ENTITLED. */
function checkGrants(c: PlanCtx): void {
  for (const { i, raw, key } of c.file.grants) {
    const at = `grants[${i}]`;
    if (!refTenant(c, `${at}.tenant`, raw.tenant) || c.base.grants.has(key)) continue;
    if (!c.m.groups.has(`${raw.tenant}/${raw.group}`))
      c.err.add(`${at}.group`, "REF_NOT_FOUND", `Không tìm thấy group "${raw.group}"`, {
        ref: raw.group,
      });
    if (!refFeature(c, `${at}.feature`, raw.feature, true)) continue;
    if (!c.m.tenants.get(raw.tenant)?.entitlements.includes(raw.feature))
      c.err.add(
        `${at}.feature`,
        "NOT_ENTITLED",
        `Tenant "${raw.tenant}" chưa được cấp "${raw.feature}"`,
        {
          tenant: raw.tenant,
          feature: raw.feature,
        },
      );
  }
}

export function runChecks(c: PlanCtx): void {
  checkTenants(c);
  checkGroups(c);
  checkWorkflows(c);
  checkCommands(c);
  checkFeatures(c);
  checkGrants(c);
}
