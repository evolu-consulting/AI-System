// N2-FR-03 · N2-D02 · plan N2 §4: registry tool của gói (một bản mỗi app, dựng ở `app.ts`, gói đăng ký lúc mount). Gói bật
// cho tenant = entitlement `<k'>-read` còn hiệu lực ∧ feature không `off` (cùng nguồn `PackAccessView` với guard N1, làm mới
// qua NOTIFY `config_changed` — 0 SQL khi nóng). Lỗi `run` ⇒ `failed` (`sent` = side_effect: không tự gọi lại, D2-13).
import { PROCESS_KEY_RE } from "@ai/contracts/chat";
import type {
  PackToolCallResult,
  PackToolCatalog,
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
  params: t.params,
});

export class PackToolRegistry implements PackToolCatalog {
  readonly #tools = new Map<string, PackToolDef>();
  #view: PackAccessView | undefined;

  constructor(view?: PackAccessView) {
    this.#view = view;
  }

  /** Gắn cổng quyền (ConfigCache) khi app có DB; vắng ⇒ mọi gói coi như chưa bật (fail-closed). */
  bindView(view: PackAccessView): void {
    this.#view = view;
  }

  /** Khoá `<pack>-<tên>` khớp `PROCESS_KEY_RE`; gói có `_` không đăng ký tool được (N2-D02); trùng ⇒ ném lúc mount. */
  register(t: PackToolDef): void {
    if (!t.name.startsWith(`${t.pack}-`) || !PROCESS_KEY_RE.test(t.name))
      throw new Error(`pack tool key invalid: ${t.name}`);
    if (this.#tools.has(t.name)) throw new Error(`pack tool duplicated: ${t.name}`);
    this.#tools.set(t.name, t);
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
    return t !== undefined && this.#view !== undefined && packEnabled(this.#view, t.pack, tenantId);
  }

  async available(tenantId: string, keys?: readonly string[]): Promise<PackToolInfo[]> {
    const want = keys
      ? [...this.#tools.values()].filter((t) => keys.includes(t.name))
      : [...this.#tools.values()];
    const on = await Promise.all(want.map((t) => this.enabled(tenantId, t.name)));
    return want.filter((_, i) => on[i]).map(infoOf);
  }

  async canUse(who: { tenantId: string; userId: string }, key: string): Promise<boolean> {
    const t = this.#tools.get(key);
    if (!t || !this.#view) return false;
    const i = await packAccessInput(this.#view, t.pack, who);
    return checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction.read }) === "ok";
  }

  async call(
    key: string,
    ctx: Parameters<PackToolDef["run"]>[0],
    args: Parameters<PackToolDef["run"]>[1],
  ): Promise<PackToolCallResult> {
    const t = this.#tools.get(key);
    if (!t)
      return {
        kind: "failed",
        code: "NOT_CONFIGURED",
        httpStatus: null,
        sent: false,
        reason: null,
      };
    try {
      return { kind: "ok", text: JSON.stringify(await t.run(ctx, args)) };
    } catch {
      return {
        kind: "failed",
        code: "UPSTREAM_ERROR",
        httpStatus: null,
        sent: t.side_effect,
        reason: null,
      };
    }
  }
}
