// CR-121 c11 · R4 · Công ty › Quy trình: dựng dòng "việc" theo ứng dụng từ MỘT lần đọc năng lực công ty + luật của từng việc.
// Logic THUẦN (không React/API): trạng thái Đang bật/tắt kèm LÝ DO bằng lời nghiệp vụ, số luật, nhóm theo app, đổi mặc định.
import type { CapabilityApp } from "@ai/contracts/capabilities";
import type { ProcessRouting } from "@ai/contracts/hub-admin";
import { fromServer, type RuleDraft } from "@ai/web-kit/routing-rules";

/** Lý do một việc đang tắt (hiện cạnh "Đang tắt"). */
export type OffReason = "noProcess" | "unpublished" | "deleted";

export type FlowJob = {
  slot: string;
  app: string;
  defId: string | null;
  defName: string | null;
  version: number | null;
  status: "on" | "off";
  reason: OffReason | null;
  /** Số luật điều kiện (không tính Mặc định). */
  rules: number;
  /** Có luật hay chưa đọc xong (luật đọc riêng từng việc). */
  routingLoaded: boolean;
};

export type FlowGroup = { app: string; jobs: FlowJob[] };

/** Tên việc theo khóa i18n `tenants.flows.job.<key>`; việc chưa có tên ⇒ null (dùng tên quy trình / chữ rút gọn). */
export const JOB_KEY: Readonly<Record<string, string>> = {
  "contracts.approval": "contractsApproval",
  "contracts.intake": "contractsIntake",
  "community.post-moderation": "communityModeration",
  "community.partner-join": "communityJoin",
  "community.report": "communityReport",
};

/** Chữ rút gọn từ phần sau dấu chấm của khóa việc ("bug-fix" ⇒ "Bug Fix") khi chưa có tên nghiệp vụ. */
export function jobFallbackName(slot: string): string {
  const part = slot.includes(".") ? slot.slice(slot.indexOf(".") + 1) : slot;
  return part
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Một việc: trạng thái từ luật (nếu đã đọc) và từ năng lực công ty.
 * Tắt khi: việc tùy chọn chưa bật / chưa có quy trình (noProcess), quy trình mặc định đã bị xoá (deleted) hoặc chưa xuất bản (unpublished).
 */
export function jobOf(
  app: string,
  s: CapabilityApp["slots"][number],
  routing: ProcessRouting | undefined,
): FlowJob {
  const defId = routing ? (routing.current_def_id ?? null) : s.def_id;
  const defName = routing ? (routing.current_def_name ?? null) : s.def_name;
  const version =
    routing && defId
      ? (routing.processes.find((p) => p.def_id === defId)?.rel_version ?? s.version)
      : s.version;
  let reason: OffReason | null = null;
  if (!defId || routing?.active === false) reason = "noProcess";
  else {
    const dflt = routing?.rules.find((r) => r.is_default && r.def_id === defId);
    if (dflt?.unavailable) reason = dflt.unavailable;
  }
  return {
    slot: s.slot,
    app,
    defId,
    defName,
    version,
    status: reason ? "off" : "on",
    reason,
    rules: routing ? routing.rules.filter((r) => !r.is_default).length : 0,
    routingLoaded: !!routing,
  };
}

const APP_ORDER = ["contracts", "community", "chat"];
const rank = (a: string): number => {
  const i = APP_ORDER.indexOf(a);
  return i >= 0 ? i : 100;
};

/** Nhóm theo app (Hợp đồng, Community, … rồi theo tên) → việc theo khóa. */
export function groupJobs(
  apps: readonly CapabilityApp[],
  routings: ReadonlyMap<string, ProcessRouting | undefined>,
): FlowGroup[] {
  return apps
    .filter((a) => a.slots.length > 0)
    .map((a) => ({
      app: a.key,
      jobs: a.slots
        .map((s) => jobOf(a.key, s, routings.get(s.slot)))
        .sort((x, y) => x.slot.localeCompare(y.slot)),
    }))
    .sort((x, y) => rank(x.app) - rank(y.app) || x.app.localeCompare(y.app));
}

/** Dòng tóm tắt đầu trang: "x/y việc có quy trình". */
export function summaryOf(groups: readonly FlowGroup[]): { on: number; total: number } {
  const all = groups.flatMap((g) => g.jobs);
  return { on: all.filter((j) => j.status === "on").length, total: all.length };
}

/**
 * Đặt `defId` làm quy trình MẶC ĐỊNH của việc (luật điều kiện giữ nguyên). Đã có luật mặc định ⇒ đổi quy trình; chưa ⇒ thêm.
 * Dùng cho tenant_admin (đổi trong tập quy trình đã có); platform_admin dùng đường gán riêng.
 */
export function withDefault(routing: Pick<ProcessRouting, "rules">, defId: string): RuleDraft[] {
  const drafts = fromServer(routing.rules);
  if (drafts.some((d) => d.isDefault))
    return drafts.map((d) => {
      if (!d.isDefault) return d;
      const { unavailable: _u, ...rest } = d;
      return { ...rest, defId };
    });
  return [
    ...drafts,
    { key: "default", departmentIds: [], contractKinds: [], defId, isDefault: true },
  ];
}
