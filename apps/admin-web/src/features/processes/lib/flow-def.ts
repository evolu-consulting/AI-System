// CR-122 · U1 · FLOW2-FR-01/15/16: mapper bản nháp canvas ⇄ FlowDef (thay `slot-canvas.ts` cho flow có trigger) + bảng node theo
// manifest app + câu lỗi theo `flowDefIssues`. Thuần (không React, không API).
import { type AppEventDecl, getAppManifest } from "@ai/contracts/app-manifest";
import {
  type FlowDef,
  type FlowDefIssue,
  type FlowTrigger,
  flowDefIssues,
  type ProcessInputDef,
  parseFlowDef,
} from "@ai/contracts/hub-admin";
import { FE_NODES, type FeNode } from "../nodes/registry";
import type { StageDraft } from "./draft-types";
import { stageToInput } from "./stage-convert";

/** Sự kiện app khai (rỗng khi app chưa có manifest). */
export const eventsOfApp = (app: string): readonly AppEventDecl[] =>
  getAppManifest(app)?.events ?? [];

export const eventOf = (app: string, key: string): AppEventDecl | undefined =>
  eventsOfApp(app).find((e) => e.key === key);

/** Def đã tải có `trigger` ⇒ FlowDef mới (một trình sửa); không có ⇒ def cũ theo khe (chạy nốt tới M1). */
export const hasTrigger = (def: unknown): def is { trigger: FlowTrigger; app: string } =>
  typeof def === "object" &&
  def !== null &&
  "trigger" in def &&
  typeof (def as { trigger?: unknown }).trigger === "object";

/**
 * CR-122 p17 · flow có `trigger`: lượt chạy mang khoá bản ghi của sự kiện (`contract_id`) làm input. Khai input của def phải CÓ khoá đó
 * (bộ chọn nguồn + kiểm "nguồn có thật" đọc từ đây): khoá cũ cùng chính tả `-`/`_` (`contract-id`, dữ liệu trước hub 0112) đổi về khoá
 * bản ghi; thiếu hẳn ⇒ thêm (không bắt buộc). Khoá khác giữ nguyên. Thuần.
 */
export function healFlowInputs(
  inputs: readonly ProcessInputDef[],
  def: { app?: string | null; trigger?: { event: string } | null },
): ProcessInputDef[] {
  const rec = eventOf(def.app ?? "", def.trigger?.event ?? "")?.record;
  if (!rec) return [...inputs];
  const norm = (k: string) => k.replaceAll("-", "_");
  const has = inputs.some((i) => i.key === rec.key);
  let renamed = has;
  const out = inputs.map((i) => {
    if (renamed || i.key === rec.key || norm(i.key) !== rec.key) return i;
    renamed = true;
    return { ...i, key: rec.key };
  });
  if (renamed) return out;
  return [...out, { key: rec.key, label: rec.label.vi, type: "text", required: false }];
}

export type FlowMeta = {
  key: string;
  name: string;
  app: string;
  owner: FlowDef["owner"];
  trigger: FlowTrigger;
  source?: FlowDef["source"];
  version?: number | null;
};

export const isFinish = (s: Pick<StageDraft, "outcome">): boolean => s.outcome !== undefined;

/** Nháp canvas → FlowDef (stage theo định dạng engine, `outcome`/`next_step` kèm theo). */
export function toFlowDef(stages: readonly StageDraft[], meta: FlowMeta): unknown {
  return {
    key: meta.key,
    name: meta.name,
    app: meta.app,
    owner: meta.owner,
    trigger: meta.trigger,
    stages: stages.map(stageToInput),
    source: meta.source ?? null,
    version: meta.version ?? null,
  };
}

/** Mã lỗi → khoá i18n (`process.admin.flow.err.*`); đủ cho mọi `FlowDefRule`. */
export const FLOW_ISSUE_KEY: Record<FlowDefIssue["rule"], string> = {
  FLOW_TOO_MANY_STEPS: "tooManySteps",
  FLOW_NO_FINISH: "noFinish",
  FLOW_FINISH_NEXT: "finishNext",
  FLOW_NEXT_STEP_INVALID: "nextStepInvalid",
  FLOW_SOURCE_OWNER: "sourceOwner",
  FLOW_EVENT_UNKNOWN: "eventUnknown",
  FLOW_OUTCOME_UNKNOWN: "outcomeUnknown",
  FLOW_WHEN_INVALID: "whenInvalid",
};

export type FlowIssue = { path: string; key: string };

/**
 * Kiểm một FlowDef nháp: `parseFlowDef` (hình) + `flowDefIssues(def, manifest.events)` (sự kiện/kết quả/điều kiện đúng manifest).
 * Trả danh sách lỗi theo vị trí để hiện cạnh node; rỗng ⇒ xuất bản được (Hub kiểm lại luật từng node).
 */
export function validateFlowDef(raw: unknown, app: string): FlowIssue[] {
  const p = parseFlowDef(raw);
  if (!p.ok)
    return p.issues.map((i) => ({
      path: i.path,
      key: FLOW_ISSUE_KEY[i.message as FlowDefIssue["rule"]] ?? "invalid",
    }));
  if (p.legacy) return [{ path: "trigger", key: "noTrigger" }];
  return flowDefIssues(p.def, eventsOfApp(app)).map((i) => ({
    path: i.path,
    key: FLOW_ISSUE_KEY[i.rule],
  }));
}

/** Một mục bảng node: nhãn nghiệp vụ (i18n), loại draft khi thêm, có dùng được hôm nay không. */
export type NodeEntry = {
  /** Khoá nhãn `process.admin.flow.node.<id>` + testid `flow-node-<id>`. */
  id: string;
  /** Patch draft khi thêm (executor...). `null` = chưa có loại engine (E2/E3) ⇒ hiện nhưng tắt, kèm lý do. */
  patch: Partial<StageDraft> | null;
  /** Chỉ node app khai: cần app có sự kiện (mọi app có manifest). */
  appNode?: boolean;
  /** Vị trí trên menu (nhóm + thứ tự) — cùng nghĩa với `NodeMenu` của node module. */
  section: "business" | "advanced";
  order: number;
};

// CR-125 · m6b: bảng bước cơ bản ĐỌC từ registry loại node (`FE_NODES[*].menu`), không còn danh sách cứng ở đây.
// CR-123 · FR-14: không còn mục "Chờ ký xong" riêng — chờ ký là nửa sau của node Ký số (một ô, chèn cả cụm).
const nodeTable = (): readonly NodeEntry[] =>
  (Object.values(FE_NODES) as FeNode[])
    .flatMap((n) => n.menu ?? [])
    .map((m): NodeEntry => ({ id: m.id, patch: m.patch, section: m.section, order: m.order }))
    .sort((a, b) => a.order - b.order);

/** Bảng node của một app: không manifest/không sự kiện ⇒ chỉ node nền tảng; node app (Ký số) chỉ khi app khai sự kiện. */
export function nodesForApp(app: string): readonly NodeEntry[] {
  const has = eventsOfApp(app).length > 0;
  return nodeTable().filter((n) => !n.appNode || has);
}

/** Node Kết thúc mới: kết quả đầu tiên của sự kiện (Hub/validate báo nếu sự kiện đổi và kết quả không còn). */
export const finishPatch = (ev: AppEventDecl | undefined): Partial<StageDraft> => ({
  executor: "set",
  outcome: ev?.outcomes[0]?.key ?? "",
});

/** Đổi sự kiện: điều kiện dùng dữ kiện không thuộc sự kiện mới bị bỏ; Kết thúc có kết quả lạ ⇒ về kết quả đầu. */
export function retargetEvent(
  trigger: FlowTrigger,
  stages: readonly StageDraft[],
  next: AppEventDecl,
): { trigger: FlowTrigger; stages: StageDraft[] } {
  const facts = new Set(next.facts.map((f) => f.key));
  type Item = NonNullable<FlowTrigger["when"]>["conds"][number];
  const keep: Item[] = [];
  for (const c of trigger.when?.conds ?? []) {
    if ("fact" in c) {
      if (facts.has(c.fact)) keep.push(c);
    } else {
      const g = c.conds.filter((x) => facts.has(x.fact));
      if (g.length > 0) keep.push({ ...c, conds: g });
    }
  }
  const when = keep.length > 0 && trigger.when ? { ...trigger.when, conds: keep } : undefined;
  const outs = new Set(next.outcomes.map((o) => o.key));
  return {
    trigger: { event: next.key, ...(when ? { when } : {}) },
    stages: stages.map((s) =>
      s.outcome !== undefined && !outs.has(s.outcome)
        ? { ...s, outcome: next.outcomes[0]?.key ?? "" }
        : s,
    ),
  };
}
