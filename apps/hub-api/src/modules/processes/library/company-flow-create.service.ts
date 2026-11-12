// CR-127 · E8 · BR-10/11 · M1 · `POST /tenants/:tid/company-flows` thể "tạo": quản trị nền tảng chọn công ty TRƯỚC, rồi tên + ứng dụng →
// sơ đồ TRỐNG (CR-127 Z3c: không còn "từ mẫu Thư viện" — Thư viện không còn mẫu Sổ Hợp Tác). Def công ty chưa có "Bắt đầu khi" ⇒ chưa vào
// danh sách tới khi Áp dụng. MỘT tx (`withConfigWrite`: khoá config + audit); số câu SQL cố định.
import { APP_MANIFESTS } from "@ai/contracts/app-manifest";
import type { Db, Tx } from "@ai/db";
import type { AuthUser } from "../../../lib/auth.middleware";
import { AppError, appError } from "../../../lib/errors";
import { dbHubAudit } from "../../../lib/hub-audit";
import * as r from "./company-flows.repo";
import { finish, norm } from "./flow-templates.def";
import { assertPlatformWrite } from "./library-company.service";
import { withConfigWrite } from "./routing.service";

export type CreateFlowBody = {
  name: string;
  app?: string | undefined;
  from: "blank";
};

const unprocessable = (code: string, msg: string) => new AppError(code, 422, msg);

/** Mã quy trình từ tên: chữ thường không dấu, gạch nối, ≤ 26 ký tự (chừa chỗ hậu tố `-cty`/`-n`). */
export function keyFromName(name: string): string {
  const k = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 26)
    .replace(/-+$/g, "");
  return k.length >= 2 && /^[a-z]/.test(k) ? k : `flow-${k}`.replace(/-+$/g, "").slice(0, 26);
}

/** Quy trình trống: chỉ MỘT Kết thúc (đủ hình bước như mẫu Thư viện — màn soạn đọc được); các bước người dùng tự thêm. */
export const blankStages = (app = "contracts"): unknown[] => {
  // Kết thúc mặc định = kết quả ĐẦU của sự kiện đầu của app (app Community không có «approved» ⇒ nếu cứng thì «Áp dụng» bị khoá)
  const first = APP_MANIFESTS[app]?.events[0]?.outcomes[0];
  return norm([finish(0, first?.key ?? "approved", first?.label ?? "Đã duyệt")]);
};

type Deps = { db: Db };
type Made = { flowId: string; rowId: string | null; created: boolean };

async function fromBlank(
  tx: Tx,
  u: AuthUser,
  tid: string,
  name: string,
  app: string,
): Promise<Made> {
  const key = await r.freeKey(tx, tid, keyFromName(name));
  const flowId = await r.insertBlankDef(tx, {
    tid,
    key,
    name,
    app,
    stages: blankStages(app),
    // "Bắt đầu khi" mặc định = sự kiện đầu của app (người dùng đổi ở màn soạn) — có trigger thì màn soạn mở được ở chế độ quy trình theo sự kiện
    trigger: { event: APP_MANIFESTS[app]?.events[0]?.key ?? "" },
    actor: u.userId,
  });
  // dòng công ty ở trạng thái Nháp (chưa áp dụng) ⇒ hiện trong danh sách «Theo công ty»
  const rowId = await r.insertCompanyFlow(tx, {
    tid,
    flowId,
    enabled: false,
    offReason: "not_published",
    actor: u.userId,
  });
  return { flowId, rowId, created: true };
}

export async function createCompanyFlow(deps: Deps, u: AuthUser, tid: string, b: CreateFlowBody) {
  assertPlatformWrite(u, tid);
  const name = b.name.trim();
  if (!name) throw unprocessable("FLOW_NAME_REQUIRED", "Nhập tên quy trình.");
  if (b.app !== undefined && !Object.hasOwn(APP_MANIFESTS, b.app))
    throw unprocessable("FLOW_APP_UNKNOWN", "Ứng dụng này không có — chọn lại ứng dụng.");
  if (!b.app) throw unprocessable("FLOW_APP_REQUIRED", "Chọn ứng dụng cho quy trình trống.");
  const { result } = await withConfigWrite({ db: deps.db, audit: dbHubAudit }, u, async (tx) => {
    if (!(await r.tenantExists(tx, tid))) throw appError("NOT_FOUND");
    const m = await fromBlank(tx, u, tid, name, b.app as string);
    return {
      result: {
        flow_id: m.flowId,
        id: m.rowId,
        created: m.created,
      },
      audit: m.created
        ? {
            tenantId: tid,
            action: "create" as const,
            entity: "process_def" as const,
            entityId: m.flowId,
            entityName: "company_flow.create",
            before: null,
            after: { from: "blank", name },
            summary: { op: "company_flow.create", tenant_id: tid, flow_id: m.flowId },
          }
        : null,
    };
  });
  return result;
}
