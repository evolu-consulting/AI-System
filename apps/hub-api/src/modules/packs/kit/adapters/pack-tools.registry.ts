// N2-FR-03 · N2-D02 · plan N2 §4: registry tool của gói (một bản mỗi app, dựng ở `app.ts`, gói đăng ký lúc mount). Gói bật
// cho tenant = entitlement `<k'>-read` còn hiệu lực ∧ feature không `off` (cùng nguồn `PackAccessView` với guard N1, làm mới
// qua NOTIFY `config_changed` — 0 SQL khi nóng). Lỗi/hết hạn `run` ⇒ `failed` (`sent` = side_effect: không tự gọi lại,
// D2-13). Review fix: hạn `timeoutS` + `signal` (Trung #1), quyền gói theo `action` (security M2), trùng khoá workflow
// catalog bị từ chối (security L1).
import { type ContextEntityKind, PROCESS_KEY_RE } from "@ai/contracts/chat";
import type { ContextSource } from "../application/context.ports";
import type {
  PackToolArgs,
  PackToolCallOpts,
  PackToolCallResult,
  PackToolCatalog,
  PackToolCtx,
  PackToolDef,
  PackToolInfo,
} from "../application/pack-tools.ports";
import { checkPackAccess } from "../domain/pack-access.rules";
import { type PackAccessView, packAccessInput, packEnabled } from "./pack-guard.middleware";

const infoOf = (t: PackToolDef): PackToolInfo => ({
  key: t.name,
  name: t.name,
  description: t.description,
  sideEffect: t.side_effect,
  action: t.action ?? "write",
  ...(t.open === true ? { open: true } : {}),
  params: t.params,
});
const failed = (code: string, sent: boolean): PackToolCallResult => ({
  kind: "failed",
  code,
  httpStatus: null,
  sent,
  reason: null,
});
type Warn = (msg: string, meta: Record<string, unknown>) => void;

/** Chạy `run` với hạn: hết `timeoutS` hoặc `signal` huỷ ⇒ `TIMEOUT` (tool vẫn được báo huỷ qua `ctx.signal`). */
async function runBounded(
  t: PackToolDef,
  ctx: PackToolCtx,
  args: PackToolArgs,
  o: PackToolCallOpts,
): Promise<PackToolCallResult> {
  const ac = new AbortController();
  const outer = o.signal;
  const onAbort = () => ac.abort();
  outer?.addEventListener("abort", onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = new Promise<PackToolCallResult>((res) => {
    ac.signal.addEventListener("abort", () => res(failed("TIMEOUT", t.side_effect)), {
      once: true,
    });
    if (o.timeoutS !== undefined && o.timeoutS > 0)
      timer = setTimeout(() => ac.abort(), o.timeoutS * 1000); // lưới hạn của tool, không phải cơ chế chờ
  });
  try {
    const work = t
      .run({ ...ctx, signal: ac.signal }, args)
      .then((out): PackToolCallResult => ({ kind: "ok", text: JSON.stringify(out) }));
    return await Promise.race([work, stop]);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onAbort);
    ac.abort();
  }
}

export class PackToolRegistry implements PackToolCatalog {
  readonly #tools = new Map<string, PackToolDef>();
  readonly #contexts = new Map<ContextEntityKind, ContextSource>();
  #view: PackAccessView | undefined;
  #warn: Warn = () => {};

  constructor(view?: PackAccessView) {
    this.#view = view;
  }

  /** Gắn cổng quyền (ConfigCache) khi app có DB; vắng ⇒ mọi gói coi như chưa bật (fail-closed). */
  bindView(view: PackAccessView, warn?: Warn): void {
    this.#view = view;
    if (warn) this.#warn = warn;
  }

  /** Khoá `<pack>-<tên>` khớp `PROCESS_KEY_RE`; gói có `_` không đăng ký tool được (N2-D02); trùng ⇒ ném lúc mount. */
  register(t: PackToolDef): void {
    if (!t.name.startsWith(`${t.pack}-`) || !PROCESS_KEY_RE.test(t.name))
      throw new Error(`pack tool key invalid: ${t.name}`);
    if (this.#tools.has(t.name)) throw new Error(`pack tool duplicated: ${t.name}`);
    this.#tools.set(t.name, t);
  }

  /**
   * Security L1 · lúc mount (sau khi mọi gói đăng ký): tool trùng khoá workflow catalog bị gỡ khỏi registry (không che
   * workflow admin đã gắn agent) + log `pack-tool-key-collision`. Trả các khoá bị gỡ.
   */
  rejectCatalogCollisions(workflowKeys: ReadonlySet<string>): string[] {
    const out = [...this.#tools.keys()].filter((k) => workflowKeys.has(k));
    for (const k of out) {
      this.#tools.delete(k);
      this.#warn("pack-tool-key-collision", { tool_key: k });
    }
    return out;
  }

  /** one-agent · nguồn nhãn ngữ cảnh của gói (một nguồn mỗi loại bản ghi; trùng ⇒ ném lúc mount). */
  registerContext(src: ContextSource): void {
    for (const k of src.kinds) {
      if (this.#contexts.has(k)) throw new Error(`context source duplicated: ${k}`);
      this.#contexts.set(k, src);
    }
  }

  /** Nhãn bản ghi người gọi thấy: gói bật ∧ quyền đọc gói ∧ RLS gói; lỗi/không thấy ⇒ null (fail-closed). */
  async contextLabel(
    who: { tenantId: string; userId: string },
    kind: ContextEntityKind,
    id: string,
  ): Promise<string | null> {
    const src = this.#contexts.get(kind);
    if (!src || !this.#view) return null;
    try {
      const i = await packAccessInput(this.#view, src.pack, who);
      if (checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction.read }) !== "ok") return null;
      return await src.label(who, kind, id);
    } catch (err) {
      this.#warn("context-label-failed", {
        kind,
        error_name: err instanceof Error ? err.name : "unknown",
      });
      return null;
    }
  }

  has(key: string): boolean {
    return this.#tools.has(key);
  }

  info(key: string): PackToolInfo | undefined {
    const t = this.#tools.get(key);
    return t ? infoOf(t) : undefined;
  }

  async enabled(tenantId: string, key: string): Promise<boolean> {
    const t = this.#tools.get(key);
    if (t?.open === true && t.action === "read") return true; // tool lõi: không gói/entitlement
    return t !== undefined && this.#view !== undefined && packEnabled(this.#view, t.pack, tenantId);
  }

  async available(tenantId: string, keys?: readonly string[]): Promise<PackToolInfo[]> {
    const want = keys
      ? [...this.#tools.values()].filter((t) => keys.includes(t.name))
      : [...this.#tools.values()];
    const on = await Promise.all(want.map((t) => this.enabled(tenantId, t.name)));
    return want.filter((_, i) => on[i]).map(infoOf);
  }

  /** Security M2 · user có quyền gói đúng `action` của tool (mặc định `write`). */
  async canUse(who: { tenantId: string; userId: string }, key: string): Promise<boolean> {
    const t = this.#tools.get(key);
    if (t?.open === true && t.action === "read") return true;
    if (!t || !this.#view) return false;
    const i = await packAccessInput(this.#view, t.pack, who);
    const granted = i.grantedByAction[t.action ?? "write"];
    return checkPackAccess({ ...i, grantedGroupIds: granted }) === "ok";
  }

  async call(
    key: string,
    ctx: PackToolCtx,
    args: PackToolArgs,
    o: PackToolCallOpts = {},
  ): Promise<PackToolCallResult> {
    const t = this.#tools.get(key);
    if (!t) return failed("NOT_CONFIGURED", false);
    try {
      const r = await runBounded(t, ctx, args, o);
      if (r.kind === "failed")
        this.#warn("pack-tool-timeout", { tool_key: key, run_id: ctx.runId });
      return r;
    } catch (err) {
      this.#warn("pack-tool-failed", {
        tool_key: key,
        run_id: ctx.runId,
        error_name: err instanceof Error ? err.name : "unknown",
      });
      return failed("UPSTREAM_ERROR", t.side_effect);
    }
  }
}
