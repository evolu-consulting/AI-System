// DLC-R14 · DLC-R15 · workflow loại DLC (CRUD, mỗi process một mặc định) + danh mục engine (bước, agent, process, hook).
// Không biết HTTP. Đọc engine ngoài transaction; engine lỗi ⇒ `engine` ≠ `ok`, mảng rỗng (trang vẫn mở).
import type {
  DlcCatalogResponse,
  DlcHook,
  DlcWorkflow,
  DlcWorkflowCreate,
  DlcWorkflowListResponse,
  DlcWorkflowPatch,
} from "@ai/contracts/hub-admin";
import { DlcCatalogResponseSchema } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../lib/db";
import { appError } from "../../lib/errors";
import type { DlcEngine, DlcJson } from "./dlc.engine";
import * as repo from "./dlc-admin.repo";

const EMPTY = { default_model: "", steps: [], agents: [], processes: [], hooks: [] };

function hooksOf(body: DlcJson): DlcHook[] {
  const list = Array.isArray(body.hooks) ? body.hooks : [];
  return list.flatMap((h) => {
    if (!h || typeof h !== "object") return [];
    const o = h as Record<string, unknown>;
    if (typeof o.id !== "number") return [];
    return [
      {
        id: o.id,
        name: String(o.name ?? "").slice(0, 200),
        event: String(o.event ?? "").slice(0, 40),
        mode: String(o.mode ?? "").slice(0, 20),
        enabled: o.enabled !== false,
      },
    ];
  });
}

async function catalogOf(engine?: DlcEngine): Promise<DlcCatalogResponse> {
  if (!engine) return { engine: "not_configured", ...EMPTY };
  let body: DlcJson;
  try {
    body = await engine.get("/api/catalog");
  } catch {
    return { engine: "unreachable", ...EMPTY };
  }
  // Hook cần quyền admin của engine; không đọc được ⇒ danh sách rỗng, phần còn lại vẫn trả.
  const hooks = await engine.get("/api/admin/hooks").then(hooksOf, () => []);
  const models = (body.models ?? {}) as Record<string, unknown>;
  const parsed = DlcCatalogResponseSchema.safeParse({
    engine: "ok",
    default_model: String(models.default ?? ""),
    steps: body.steps ?? [],
    agents: body.agents ?? [],
    processes: body.processes ?? [],
    hooks,
  });
  return parsed.success ? parsed.data : { engine: "unreachable", ...EMPTY };
}

export function dlcAdminService(db: Db, engine?: DlcEngine) {
  const sys = <T>(fn: (tx: Tx) => Promise<T>) => withHubScope(db, { kind: "system" }, fn);
  const catalog = (): Promise<DlcCatalogResponse> => catalogOf(engine);

  const list = (): Promise<DlcWorkflowListResponse> =>
    sys(async (tx) => ({ items: await repo.listWorkflows(tx) }));

  const create = (w: DlcWorkflowCreate): Promise<DlcWorkflow> =>
    sys(async (tx) => {
      if (await repo.keyExists(tx, w.key)) throw appError("KEY_TAKEN");
      if (w.is_default) await repo.clearDefault(tx, w.process);
      return repo.insertWorkflow(tx, w);
    });

  const update = (id: string, p: DlcWorkflowPatch): Promise<DlcWorkflow> =>
    sys(async (tx) => {
      const cur = await repo.findWorkflow(tx, id);
      if (!cur) throw appError("NOT_FOUND");
      if (cur.version !== p.version) throw appError("VERSION_CONFLICT");
      if (p.is_default) await repo.clearDefault(tx, p.process ?? cur.process, id);
      const row = await repo.updateWorkflow(tx, id, p);
      if (!row) throw appError("VERSION_CONFLICT");
      return row;
    });

  const remove = (id: string): Promise<void> =>
    sys(async (tx) => {
      if (!(await repo.deleteWorkflow(tx, id))) throw appError("NOT_FOUND");
    });

  return { catalog, list, create, update, remove };
}
