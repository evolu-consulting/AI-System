// CR-182 · giao việc theo vai (Cài đặt › Quy trình duyệt): hàm thuần — chữ trên node, bước dùng chung vai, số vai chưa giao.
import type { DefRoleView } from "@ai/flow-canvas/pure";
import type { CurrentFlow, CurrentGraphStage, StageAssigned } from "./current-flow";

type Tr = (key: string, o?: Record<string, unknown>) => string;
const K = "contracts.flow.current.assign";

/** «Tên nhóm · n người» hoặc tên người; null ⇒ chưa giao. */
export function whoText(a: StageAssigned | null, t: Tr): string | null {
  if (!a) return null;
  const name = a.name ?? t(`${K}.unnamed`);
  return a.kind === "group" ? t(`${K}.groupWho`, { name, count: a.members.length }) : name;
}

/** Dữ liệu node cho bước có vai. */
export function roleView(g: CurrentGraphStage, t: Tr): DefRoleView | null {
  if (!g.role) return null;
  return {
    line: t(`${K}.roleLine`, { label: g.role.label }),
    who: whoText(g.assigned, t),
    warn: t(`${K}.unassignedWarn`),
    kind: g.assigned?.kind ?? null,
  };
}

/** Các bước dùng cùng một vai («một vai, nhiều bước: giao một lần»). */
export function stagesOfRole(flow: CurrentFlow, roleKey: string): CurrentGraphStage[] {
  return flow.graph.filter((g) => g.role?.key === roleKey);
}

/** Số vai (khoá khác nhau) chưa giao người. */
export function unassignedRoles(flow: CurrentFlow): number {
  const keys = new Set(flow.graph.filter((g) => g.role && !g.assigned).map((g) => g.role?.key));
  return keys.size;
}

export type RolePick = { kind: "group" | "user"; id: string; name: string } | null;
const sameId = (a: RolePick, b: RolePick) => (a?.id ?? "") === (b?.id ?? "") && a?.kind === b?.kind;

/** Lựa chọn đang lưu của bước (null ⇒ chưa giao). */
export const savedPick = (g: CurrentGraphStage): RolePick =>
  g.assigned ? { kind: g.assigned.kind, id: g.assigned.id, name: g.assigned.name ?? "" } : null;
/** Có khác bản đang lưu không (nút «Lưu giao việc» chỉ bật khi khác). */
export const isDirty = (saved: RolePick, draft: RolePick): boolean =>
  !(saved === null && draft === null) && !sameId(saved, draft);

/** Thân PUT: chọn nhóm / người, hoặc bỏ giao. */
export function assignBody(flowId: string, roleKey: string, pick: RolePick) {
  return {
    flow_id: flowId,
    role_key: roleKey,
    group_id: pick?.kind === "group" ? pick.id : null,
    user_id: pick?.kind === "user" ? pick.id : null,
  };
}
