// dlc-step-library · nghiệp vụ thư viện bước DLC (chỉ platform_admin — cổng ở route). Ghi qua `withConfigWrite` (scope system, khoá
// `config_meta` trước ⇒ ghi tuần tự, kiểm khoá trùng không đua) + audit `dlc_step_template` (create/update/delete). Sửa: khoá hàng
// FOR UPDATE + so `version` (lệch ⇒ 409). Bước đã chép vào quy trình KHÔNG đổi theo mẫu.
import type {
  DlcStepTemplate,
  DlcStepTemplateInput,
  DlcStepTemplateListResponse,
  DlcStepTemplateUpdate,
} from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../../lib/auth.middleware";
import { appError } from "../../../lib/errors";
import { dbHubAudit } from "../../../lib/hub-audit";
import { withConfigWrite } from "../../studio/studio-write";
import type { ProcessDeps } from "../core/ports";
import * as repo from "./dlc-steps.repo";
import { dlcStepAudit } from "./dlc-steps.rules";

export class DlcStepsService {
  readonly #w;
  constructor(private readonly d: Pick<ProcessDeps, "db">) {
    this.#w = { db: d.db, audit: dbHubAudit };
  }

  list(): Promise<DlcStepTemplateListResponse> {
    return withHubScope(
      this.d.db,
      { kind: "system" },
      async (tx) => ({ items: await repo.listSteps(tx) }),
      { accessMode: "read only" },
    );
  }

  async #free(tx: Tx, key: string, except: string | null): Promise<void> {
    if (await repo.keyTaken(tx, key, except)) throw appError("KEY_TAKEN", { key });
  }

  async create(u: AuthUser, v: DlcStepTemplateInput): Promise<DlcStepTemplate> {
    const { result } = await withConfigWrite(this.#w, u, async (tx) => {
      await this.#free(tx, v.key, null);
      const row = await repo.insertStep(tx, v);
      return { result: row, audit: dlcStepAudit("create", row, null) };
    });
    return result;
  }

  async update(u: AuthUser, id: string, b: DlcStepTemplateUpdate): Promise<DlcStepTemplate> {
    const { version, ...v } = b;
    const { result } = await withConfigWrite(this.#w, u, async (tx) => {
      const cur = await repo.readStep(tx, id, true);
      if (!cur) throw appError("NOT_FOUND");
      if (cur.version !== version)
        throw appError("VERSION_CONFLICT", { current_version: cur.version });
      await this.#free(tx, v.key, id);
      const row = await repo.updateStep(tx, id, v);
      return { result: row, audit: dlcStepAudit("update", row, cur) };
    });
    return result;
  }

  async remove(u: AuthUser, id: string): Promise<void> {
    await withConfigWrite(this.#w, u, async (tx) => {
      const cur = await repo.readStep(tx, id, true);
      if (!cur) throw appError("NOT_FOUND");
      await repo.deleteStep(tx, id);
      return { result: null, audit: dlcStepAudit("delete", cur, cur) };
    });
  }
}
