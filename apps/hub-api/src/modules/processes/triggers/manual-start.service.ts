// CR-125 · cr125-manual-start-engine · bắt đầu quy trình bằng phiếu yêu cầu (vd «Tạo đề xuất mua hàng»). Thứ tự kiểm: flow có (404) →
// flow bật + cờ FLOW_TRIGGERS của công ty (409 START_FLOW_OFF) → người gọi được bắt đầu (403 START_NOT_ALLOWED) → phiếu hợp lệ theo zod
// của cấu hình node (422 START_FORM_INVALID, lỗi theo ô). Mở lượt qua ĐÚNG đường của sự kiện (`flowLaunchOf`: cổng tính năng node, mẫu
// Thư viện, `process_runs_flow_event_uq`); băm (người × flow × `request_id`) ⇒ `flow_events.event_id` ⇒ chỉ CÙNG người gửi lại cùng
// flow + mã mới trả lượt cũ.
import { createHash } from "node:crypto";
import {
  PROCESS_START_ERRORS,
  type ProcessStartErrorCode,
  type StartableFlow,
  type StartProcessRequest,
  type StartProcessResponse,
  startFormOf,
} from "@ai/contracts/hub-admin";
import {
  renderStartTitle,
  START_FORM_EVENT,
  type StartFormConfig,
  startFormRunInputs,
  startFormValuesSchema,
} from "@ai/contracts/modules";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../../lib/auth.middleware";
import { AppError } from "../../../lib/errors";
import { processError } from "../core/errors";
import type { ProcessDeps } from "../core/ports";
import { FlowLaunchRefused } from "./dispatcher";
import type { CandidateRow } from "./dispatcher.repo";
import { flowTriggersOn } from "./flags";
import { type FlowLaunchX, flowLaunchOf } from "./flow-launch";
import {
  groupIdsByKey,
  runOfEvent,
  type StartFlowRow,
  startFlows,
  upsertStartEvent,
} from "./manual-start.repo";
import { startFormFileIds } from "./start-files.rules";

const MESSAGES: Record<ProcessStartErrorCode, string> = {
  START_NOT_ALLOWED: "You are not allowed to start this process",
  START_FORM_INVALID: "The request form is invalid",
  START_FLOW_OFF: "This process is not switched on for the company",
  START_REQUEST_REUSED: "This request id belongs to another request",
};
export const startError = (code: ProcessStartErrorCode, details?: unknown): AppError =>
  new AppError(code, PROCESS_START_ERRORS[code], MESSAGES[code], details);

/** Khoá chống trùng = băm (người gọi × flow công ty × request_id): mã trùng của người khác / flow khác là yêu cầu KHÁC. */
export const startEventId = (actorId: string, companyFlowId: string, requestId: string): string =>
  `start:${createHash("sha256").update(`${actorId}|${companyFlowId}|${requestId}`).digest("hex")}`;

type Loaded = { row: StartFlowRow; cfg: StartFormConfig | null; allowed: boolean };

/** Người gọi thuộc «ai được bắt đầu»: mọi người, hoặc giao với nhóm (id + id của mã). */
function canStart(
  cfg: StartFormConfig,
  mine: ReadonlySet<string>,
  byKey: ReadonlyMap<string, string>,
): boolean {
  const s = cfg.starters;
  if (s.kind === "everyone") return true;
  const ids = [...s.group_ids, ...(s.group_keys ?? []).flatMap((k) => byKey.get(k) ?? [])];
  return ids.some((g) => mine.has(g));
}

/** Lỗi theo ô: khoá ô → mã lỗi zod đầu tiên (ô lạ ⇒ `unrecognized`). */
function fieldErrors(issues: readonly { path: PropertyKey[]; code: string; keys?: string[] }[]) {
  const fields: Record<string, string> = {};
  for (const i of issues) {
    if (i.code === "unrecognized_keys") {
      for (const k of i.keys ?? []) fields[k] ??= "unrecognized";
      continue;
    }
    const k = String(i.path[0] ?? "");
    fields[k] ??= i.code === "invalid_type" && i.path.length === 1 ? "required_or_type" : i.code;
  }
  return { fields };
}

export class ManualStartService {
  readonly #launch: FlowLaunchX;
  constructor(private readonly d: ProcessDeps) {
    this.#launch = flowLaunchOf(d);
  }

  /** Flow bắt đầu bằng phiếu, đọc + quyền MỘT tx system (3 câu cố định), lọc công ty của người gọi. */
  async #load(u: AuthUser, key: string | null): Promise<{ on: boolean; flows: Loaded[] }> {
    const mine = (await this.d.config.user(u.userId))?.groupIds ?? new Set<string>();
    return withHubScope(this.d.db, { kind: "system" }, async (tx) => {
      const rows = await startFlows(tx, u.tenantId, key);
      const cfgs = rows.map((r) => startFormOf(r.first_stage));
      const keys = cfgs.flatMap((c) =>
        c?.starters.kind === "groups" ? (c.starters.group_keys ?? []) : [],
      );
      const byKey = await groupIdsByKey(tx, u.tenantId, [...new Set(keys)]);
      const on = await flowTriggersOn(tx, u.tenantId);
      const flows = rows.map((row, i) => {
        const cfg = cfgs[i] ?? null;
        return { row, cfg, allowed: cfg !== null && canStart(cfg, mine, byKey) };
      });
      return { on, flows };
    });
  }

  /** `GET /processes/startable`: flow đang bật mà người xem được bắt đầu (cờ công ty tắt ⇒ rỗng). */
  async startable(u: AuthUser): Promise<StartableFlow[]> {
    const { on, flows } = await this.#load(u, null);
    if (!on) return [];
    return flows
      .filter((f) => f.row.enabled && f.allowed && f.cfg)
      .map((f) => ({
        flow_key: f.row.key,
        name: f.row.name,
        company_flow_id: f.row.company_flow_id,
        description: f.row.description ?? "",
        form: { fields: f.cfg?.fields ?? [], title_template: f.cfg?.title_template ?? "" },
      }));
  }

  /** `POST /processes/start`. */
  async start(u: AuthUser, req: StartProcessRequest): Promise<StartProcessResponse> {
    const { on, flows } = await this.#load(u, req.flow_key);
    const f = flows.find((x) => x.row.enabled) ?? flows[0];
    if (!f) throw processError("PROCESS_NOT_FOUND", { suggestions: [] });
    if (!on || !f.row.enabled || !f.cfg) throw startError("START_FLOW_OFF");
    if (!f.allowed) throw startError("START_NOT_ALLOWED");
    const parsed = startFormValuesSchema(f.cfg).safeParse(req.values);
    if (!parsed.success)
      throw startError("START_FORM_INVALID", fieldErrors(parsed.error.issues as never));
    const values = parsed.data as Record<string, unknown>;
    const title = renderStartTitle(f.cfg.title_template, values);
    const ref = `start:${req.request_id}`;
    const cf = f.row.company_flow_id;
    const ev = await withHubScope(
      this.d.db,
      { kind: "user", tenantId: u.tenantId, userId: u.userId },
      (tx) =>
        upsertStartEvent(tx, {
          tenantId: u.tenantId,
          eventId: startEventId(u.userId, cf, req.request_id),
          ref,
          facts: values,
          actorId: u.userId,
          companyFlowId: cf,
        }),
    );
    // Lưới an toàn (khoá đã gồm người × flow): sự kiện không phải của người gọi / mã này ⇒ 409, KHÔNG trả lượt của người khác.
    if (ev.actor_id !== u.userId || ev.ref !== ref) throw startError("START_REQUEST_REUSED");
    if (ev.run_id) return { run_id: ev.run_id, created: false, title };
    const run = await this.#open(u, f, { id: ev.id, ref }, values, title);
    return { run_id: run.id, created: run.created, title };
  }

  async #open(
    u: AuthUser,
    f: Loaded,
    ev: { id: string; ref: string },
    values: Record<string, unknown>,
    title: string,
  ): Promise<{ id: string; created: boolean }> {
    const cfg = f.cfg as StartFormConfig;
    const c: CandidateRow = {
      companyFlowId: f.row.company_flow_id,
      flowId: f.row.flow_id,
      defKey: f.row.key,
      position: f.row.position,
      when: null,
      tenantId: u.tenantId,
      event: START_FORM_EVENT,
      defTenantId: f.row.def_tenant_id,
      nodes: f.row.nodes ?? [],
    };
    const e = {
      id: ev.id,
      tenant_id: u.tenantId,
      event: START_FORM_EVENT,
      ref: ev.ref,
      facts: {},
      actor_id: u.userId,
      attempts: 1,
    };
    const inputs = [
      ...startFormRunInputs(cfg, values),
      { key: "request_title", type: "text", text: title },
    ];
    try {
      // CR-125 · tệp ô «Tệp đính kèm» liên kết vào lượt CÙNG tx tạo lượt (người xem lượt mở được tệp).
      const r = await this.#launch(e, c, "core", {
        inputs,
        fileIds: startFormFileIds(cfg, values),
      });
      if (r !== "duplicate" && r !== "superseded") return { id: r.runId, created: true };
    } catch (err) {
      throw refusedToError(err);
    }
    const id = await withHubScope(
      this.d.db,
      { kind: "user", tenantId: u.tenantId, userId: u.userId },
      (tx) => runOfEvent(tx, ev.id, f.row.company_flow_id),
    );
    if (!id) throw startError("START_FLOW_OFF", { reason: "not_launched" });
    return { id, created: false };
  }
}

/** Từ chối của đường mở lượt ⇒ mã của API: không được chạy ⇒ 403; quá trần run ⇒ 429 như cũ; còn lại (tính năng node tắt, mẫu chưa
 *  xuất bản, thiếu nhóm…) ⇒ 409 START_FLOW_OFF kèm `reason`. */
function refusedToError(err: unknown): unknown {
  if (!(err instanceof FlowLaunchRefused)) return err;
  if (err.message === "PROCESS_NOT_FOUND" || err.message === "no_actor")
    return startError("START_NOT_ALLOWED");
  if (err.message === "TOO_MANY_PROCESS_RUNS") return processError("TOO_MANY_PROCESS_RUNS");
  return startError("START_FLOW_OFF", { reason: err.message });
}
