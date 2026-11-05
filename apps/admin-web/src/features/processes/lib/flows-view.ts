// CR-120 · "Một trang Quy trình": gộp mọi quy trình công ty đang có thành MỘT danh sách phẳng rồi nhóm theo app.
// Nguồn: (1) quy trình platform gán theo từng khe (GET routing: tập gán + luật + current_def_id), (2) quy trình công ty tự tạo
// (danh sách tenant). Logic THUẦN (không React / không API): dựng dòng, câu "khi nào chạy", lọc chip, nhóm theo app.
import type { TenantCapabilitiesResponse } from "@ai/contracts/capabilities";
import type { ProcessRouting, RoutingContractKind } from "@ai/contracts/hub-admin";
import { routingCurrent } from "@ai/web-kit/routing-current";
import type { LibraryListItem } from "../library-api";

export type FlowSource = "platform" | "company";
export type FlowStatus = "on" | "off";
/** Nhóm cho quy trình công ty tạo không gắn khe (chuỗi agent). */
export const GENERAL_APP = "general";

/** Một luật chọn quy trình của khe, rút gọn cho hiển thị. */
export type RuleWhen = { isDefault: boolean; deptIds: string[]; kinds: RoutingContractKind[] };

/** Khi nào chạy: theo luật (có điều kiện / mặc định), là quy trình đang dùng của khe (không luật), chưa được luật nào chọn, hoặc tự chạy tay. */
export type FlowWhen =
  | { kind: "rules"; rules: RuleWhen[] }
  | { kind: "current" }
  | { kind: "unused" }
  | { kind: "off" }
  | { kind: "manual" };

export type FlowRow = {
  id: string;
  app: string;
  name: string;
  source: FlowSource;
  status: FlowStatus;
  slot: string | null;
  version: number | null;
  when: FlowWhen;
  /** Quy trình đang dùng nằm ngoài tập gán (mặc định khe chưa gán) ⇒ không xem được sơ đồ qua tập gán. */
  outside: boolean;
  /** Có khi là quy trình công ty tạo (đủ hành động Sửa / Chạy / Bật / Xoá như trước). */
  own: LibraryListItem | null;
};

export type SlotRef = { slot: string; app: string };

/** Khe quy trình của mọi app công ty bật (trùng ⇒ một), kèm app chủ; theo tên khe. */
export function slotsOfCaps(c: Pick<TenantCapabilitiesResponse, "apps">): SlotRef[] {
  const m = new Map<string, string>();
  for (const a of c.apps) for (const s of a.slots) if (!m.has(s.slot)) m.set(s.slot, a.key);
  return [...m].map(([slot, app]) => ({ slot, app })).sort((a, b) => a.slot.localeCompare(b.slot));
}

/** Dòng quy trình platform gán của một khe (+ dòng "đang dùng" nằm ngoài tập gán nếu có). */
export function assignedRows(ref: SlotRef, r: ProcessRouting): FlowRow[] {
  const cur = routingCurrent(r);
  const rows: FlowRow[] = r.processes.map((p) => {
    const rules = r.rules
      .filter((x) => x.def_id === p.def_id)
      .map((x) => ({
        isDefault: x.is_default,
        deptIds: x.condition.departmentIds ?? [],
        kinds: x.condition.contractKinds ?? [],
      }));
    const inUse = cur.markId === p.def_id;
    const when: FlowWhen =
      rules.length > 0
        ? { kind: "rules", rules }
        : inUse
          ? { kind: "current" }
          : { kind: "unused" };
    return {
      id: p.def_id,
      app: ref.app,
      name: p.name,
      source: "platform",
      status: rules.length > 0 || inUse ? "on" : "off",
      slot: ref.slot,
      version: p.rel_version,
      when,
      outside: false,
      own: null,
    };
  });
  // Khe opt-in chưa bật: mặc định của thư viện KHÔNG phải "Đang dùng" — hiện một dòng "Đang tắt" kèm cách bật (gán quy trình).
  if (cur.off && r.current_def_id)
    rows.push({
      id: r.current_def_id,
      app: ref.app,
      name: r.current_def_name ?? "",
      source: "platform",
      status: "off",
      slot: ref.slot,
      version: null,
      when: { kind: "off" },
      outside: true,
      own: null,
    });
  if (cur.outside)
    rows.push({
      id: cur.outside.defId,
      app: ref.app,
      name: cur.outside.name,
      source: "platform",
      status: "on",
      slot: ref.slot,
      version: null,
      when: { kind: "current" },
      outside: true,
      own: null,
    });
  return rows;
}

/** App của quy trình công ty tạo: theo tiền tố khe (`contracts.x` ⇒ contracts), không khe ⇒ Chung. */
export const appOfSlot = (slot: string | null | undefined): string =>
  slot?.includes(".") ? (slot.split(".")[0] ?? GENERAL_APP) : GENERAL_APP;

/** Dòng quy trình công ty tạo từ danh sách tenant; bỏ id đã có ở dòng platform gán. */
export function companyRows(
  items: readonly LibraryListItem[],
  skip: ReadonlySet<string>,
): FlowRow[] {
  const seen = new Set<string>();
  const rows: FlowRow[] = [];
  for (const d of items) {
    if (skip.has(d.id) || seen.has(d.id)) continue;
    seen.add(d.id);
    rows.push({
      id: d.id,
      app: appOfSlot(d.slot),
      name: d.name,
      source: "company",
      status: d.enabled ? "on" : "off",
      slot: d.slot ?? null,
      version: d.published_version ?? null,
      when: { kind: "manual" },
      outside: false,
      own: d,
    });
  }
  return rows;
}

export type FlowFilter = { app: string; source: "all" | FlowSource; status: "all" | FlowStatus };
export const NO_FILTER: FlowFilter = { app: "all", source: "all", status: "all" };

export const filterFlows = (rows: readonly FlowRow[], f: FlowFilter): FlowRow[] =>
  rows.filter(
    (r) =>
      (f.app === "all" || r.app === f.app) &&
      (f.source === "all" || r.source === f.source) &&
      (f.status === "all" || r.status === f.status),
  );

const APP_ORDER = ["contracts", "community", "chat"];
const appRank = (a: string): number =>
  a === GENERAL_APP ? 1000 : APP_ORDER.indexOf(a) >= 0 ? APP_ORDER.indexOf(a) : 100;

/** App có mặt trong danh sách (đã sắp: Sổ Hợp Tác, Community, … , Chung cuối). */
export const appsOf = (rows: readonly FlowRow[]): string[] =>
  [...new Set(rows.map((r) => r.app))].sort(
    (a, b) => appRank(a) - appRank(b) || a.localeCompare(b),
  );

export type FlowGroup = { app: string; rows: FlowRow[] };

/** Nhóm theo app; trong nhóm: Đang dùng trước, platform cung cấp trước, rồi theo tên. */
export function groupByApp(rows: readonly FlowRow[]): FlowGroup[] {
  return appsOf(rows).map((app) => ({
    app,
    rows: rows
      .filter((r) => r.app === app)
      .sort(
        (a, b) =>
          Number(b.status === "on") - Number(a.status === "on") ||
          Number(b.source === "platform") - Number(a.source === "platform") ||
          a.name.localeCompare(b.name),
      ),
  }));
}

export type RuleParts = {
  isDefault: boolean;
  kinds: RoutingContractKind[];
  /** Tên phòng ban đã biết; phòng ban chưa tra được tên đếm vào `unknown`. */
  depts: string[];
  unknown: number;
};

/** Luật ⇒ các mảnh để ghép câu "HĐ mua từ Phòng Kinh doanh" (tên phòng ban tra qua `deptName`, rỗng = chưa biết). */
export function ruleParts(r: RuleWhen, deptName: (id: string) => string): RuleParts {
  const names = r.deptIds.map(deptName);
  return {
    isDefault: r.isDefault,
    kinds: r.kinds,
    depts: names.filter((n) => n !== ""),
    unknown: names.filter((n) => n === "").length,
  };
}

/** Khe có tên việc dễ hiểu (i18n `process.admin.flows.purpose.<key>`); khe chưa có tên ⇒ không hiện gì (Luật GỐC 3: không lộ mã khe). */
export const SLOT_PURPOSE: Readonly<Record<string, string>> = {
  "contracts.approval": "contractsApproval",
  "contracts.intake": "contractsIntake",
  "community.post-moderation": "communityModeration",
  "community.partner-join": "communityJoin",
  "community.report": "communityReport",
};
