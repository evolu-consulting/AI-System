// HUB-FR-10, HUB-FR-11, HUB-FR-12, HUB-FR-14, HUB-FR-76 · H2a-R01–R08 · menu `/` và chuẩn bị lệnh từ cache catalog
// (plan §4, §5.1; §8: 0 query khi cache nóng). Kiểm quyền mỗi lần gọi trên ảnh catalog hiện hành (R03). `prepare` ném
// `CMD_NOT_FOUND`/`CMD_MISSING_ARG` **trước** khi tạo run (R07) — không ghi gì.
import type { CommandMenuResponse, MessageContext } from "@ai/contracts/chat";
import type { AuthUser } from "../../lib/auth.middleware";
import { appError } from "../../lib/errors";
import type { CatalogSnapshot, UsableCatalogCommand } from "../config/catalog.rules";
import { tenantKeyOf, usableCatalogCommands } from "../config/catalog.rules";
import type { ConfigCache } from "../config/config.service";
import type { CatalogCommand, CatalogWorkflow, WorkflowInputValue } from "./catalog.types";
import { appNeedsQuery, buildInputs, QUERY_INPUT } from "./command-input.rules";
import { bindArgs } from "./command-parse.rules";
import { toMenuItem } from "./menu.rules";
import { suggestCommands } from "./suggest.rules";

export type CommandCatalog = Pick<ConfigCache, "catalog" | "tenant" | "user" | "poll">;

/** Ảnh catalog + lệnh user dùng được, chụp một lần cho một request (HUB-BR-06). */
export type UsableView = { catalog: CatalogSnapshot; usable: UsableCatalogCommand[] };

/** Lệnh đã qua quyền + parse + input map — snapshot chốt lúc tạo run (R08). */
export type PreparedCommand = {
  command: CatalogCommand;
  workflow: CatalogWorkflow;
  featureId: string;
  inputs: Record<string, WorkflowInputValue>;
  query: string | null;
  sideEffect: boolean;
  /** `<tenant_key>:<user_id>` (R15) — tenant thiếu key trong cache ⇒ dùng tenant id. */
  tenantKey: string;
  /** Số token thừa bị bỏ (R05, ghi trace). */
  extraTokens: number;
};

export type CommandRequest = { name: string; rest: string; ctx: MessageContext };

const notFound = (suggestions: string[]) => appError("CMD_NOT_FOUND", { suggestions });
const missingArg = (missing: string[], invalid: string[]) =>
  appError("CMD_MISSING_ARG", { missing, invalid });

/** Tên báo thiếu khi app `chat`/`agent` không có `query`: tham số map vào input `query`, không thì `query`. */
function queryLabel(inputMap: CatalogCommand["inputMap"]): string {
  const e = inputMap[QUERY_INPUT];
  return e?.source === "arg" ? e.value : QUERY_INPUT;
}

/** Đầu vào gán tham số + dựng `inputs` (E12 `prepare` và test-run nháp B10 dùng chung). */
export type BindCommandInput = {
  command: Pick<CatalogCommand, "args" | "inputMap">;
  workflow: Pick<CatalogWorkflow, "inputSchema" | "appType">;
  rest: string;
  ctx: MessageContext;
  userId: string;
  tenantId: string;
};
export type BoundCommand = {
  inputs: Record<string, WorkflowInputValue>;
  query: string | null;
  extraTokens: number;
};

/** R05–R06: `bindArgs` → `buildInputs` → app `chat`/`agent` cần `query`; thiếu/sai → ném `CMD_MISSING_ARG`. */
export function bindCommandInputs(i: BindCommandInput): BoundCommand {
  const { command, workflow } = i;
  const bound = bindArgs(command.args, i.rest, i.ctx);
  const built = buildInputs({
    inputMap: command.inputMap,
    inputSchema: workflow.inputSchema,
    args: command.args,
    values: bound.values,
    ctx: i.ctx,
    userId: i.userId,
    tenantId: i.tenantId,
  });
  if (!built.ok) throw missingArg(built.missing, built.invalid);
  if (appNeedsQuery(workflow.appType) && built.query === null)
    throw missingArg([queryLabel(command.inputMap)], []);
  return { inputs: built.inputs, query: built.query, extraTokens: bound.extra };
}

function findUsable(v: UsableView, name: string): UsableCatalogCommand | undefined {
  const id = name === "" ? undefined : v.catalog.names.get(name);
  return id === undefined ? undefined : v.usable.find((x) => x.command.id === id);
}

export class CommandService {
  constructor(protected readonly config: CommandCatalog) {}

  async usable(u: AuthUser): Promise<UsableView> {
    const [catalog, tenant, user] = await Promise.all([
      this.config.catalog(),
      this.config.tenant(u.tenantId),
      this.config.user(u.userId),
    ]);
    return { catalog, usable: user ? usableCatalogCommands(catalog, tenant, user) : [] };
  }

  /** GET `/commands` · sắp `name` (thứ tự của `usableCatalogCommands`). */
  async menu(u: AuthUser): Promise<CommandMenuResponse> {
    const { usable } = await this.usable(u);
    return { items: usable.map((x) => toMenuItem(x.command, x.workflow)) };
  }

  /** §5.1 bước 2 · không tồn tại / không quyền / tắt → cùng `CMD_NOT_FOUND` (R03); thiếu/sai tham số → `CMD_MISSING_ARG`. */
  async prepare(u: AuthUser, req: CommandRequest): Promise<PreparedCommand> {
    let view = await this.usable(u);
    let hit = findUsable(view, req.name);
    if (!hit && req.name !== "") {
      // Trượt: so phiên bản cấu hình (1 query) — Admin vừa đổi mà NOTIFY chưa tới thì nạp lại rồi tra lần nữa.
      await this.config.poll();
      view = await this.usable(u);
      hit = findUsable(view, req.name);
    }
    if (!hit) {
      const cands = view.usable.map((x) => ({ name: x.command.name, aliases: x.command.aliases }));
      throw notFound(suggestCommands(req.name, cands));
    }
    const { catalog } = view;
    const { command, workflow } = hit;
    const bound = bindCommandInputs({
      command,
      workflow,
      rest: req.rest,
      ctx: req.ctx,
      userId: u.userId,
      tenantId: u.tenantId,
    });
    return {
      command,
      workflow,
      featureId: hit.featureId,
      inputs: bound.inputs,
      query: bound.query,
      sideEffect: workflow.sideEffect,
      tenantKey: tenantKeyOf(catalog, u.tenantId),
      extraTokens: bound.extraTokens,
    };
  }
}
