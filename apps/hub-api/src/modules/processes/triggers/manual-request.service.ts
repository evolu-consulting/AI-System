// CR-125 · cr125-manual-start-ui · `GET /processes/requests/:run_id` — trang «yêu cầu» của workspace: trạng thái lượt (cùng quyền xem với
// `GET /process-runs/:id`: người bắt đầu, người được giao việc, quản trị) + giá trị phiếu đã điền (nhãn theo phiếu của bản flow đã chạy).
// Quyền xem do `ViewService.get` quyết (404 nếu không thấy); đọc input/snapshot ở scope system CHỈ SAU khi kiểm quyền qua.

import { type StartRequestView, startFormOf } from "@ai/contracts/hub-admin";
import type { StartFormConfig } from "@ai/contracts/modules";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../lib/auth.middleware";
import { processError } from "../core/errors";
import type { ProcessDeps } from "../core/ports";
import { requestSteps, rootRunId } from "../runs/request-steps";
import { ViewService } from "../runs/view.service";

type RunInput = { key?: string; type?: string; text?: string; value?: string };
type Row = { inputs: unknown; stage0: unknown };

/** Ô phiếu + giá trị đã ghi (theo thứ tự ô; ô không có giá trị bị bỏ). Thuần. */
export function requestFields(cfg: StartFormConfig, inputs: unknown): StartRequestView["fields"] {
  const list = (Array.isArray(inputs) ? inputs : []) as RunInput[];
  return cfg.fields.flatMap((f) => {
    const i = list.find((x) => x.key === f.key);
    const v = i?.type === "number" ? i.value : i?.text;
    return v === undefined || v === ""
      ? []
      : [{ key: f.key, label: f.label, type: f.type, value: v }];
  });
}

export class ManualRequestService {
  readonly #view: ViewService;
  constructor(private readonly d: ProcessDeps) {
    this.#view = new ViewService(d);
  }

  async get(u: AuthUser, runId: string): Promise<StartRequestView> {
    const run = await this.#view.get(u, runId);
    const row = await withHubScope(this.d.db, { kind: "system" }, async (tx) => {
      const [r] = await tx.execute<Row>(sql`select inputs, snapshot -> 'stages' -> 0 as stage0
        from hub.process_runs where id = ${runId}::uuid and tenant_id = ${u.tenantId}::uuid`);
      return r;
    });
    if (!row) throw processError("PROCESS_NOT_FOUND", { suggestions: [] });
    const cfg = startFormOf(row.stage0);
    const inputs = (Array.isArray(row.inputs) ? row.inputs : []) as RunInput[];
    const title = inputs.find((x) => x.key === "request_title")?.text ?? run.process.name;
    const [steps, root_run_id] = await Promise.all([
      requestSteps(this.d, u, { id: runId, name: run.process.name }),
      rootRunId(this.d, u, runId),
    ]);
    return { run, title, fields: cfg ? requestFields(cfg, row.inputs) : [], steps, root_run_id };
  }
}
