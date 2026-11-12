// CR-120 · thẻ duyệt đi FlowRuntime: backend giả của khe `contracts.approval` cho e2e contracts-web dùng `page.route`.
//   GET  /pack/contracts/flow/contracts.approval/:id                    → FlowView chiếu từ thẻ hiện tại (CÙNG phép chiếu của hub)
//   POST /pack/contracts/flow/contracts.approval/:id/tasks/:t/actions/:a → `onAct(thân cũ {action, feedback?, products?}, task)`
//   POST /pack/contracts/flow/contracts.approval/summary                → không huy hiệu
// Ghi hành động theo THÂN CŨ (extension ⇒ products) để kịch bản cũ giữ nguyên khẳng định; kèm `task` để kiểm task đang mở.
import type { ContractApproval } from "@ai/contracts/pack-contracts";
import type { Page, Route } from "@playwright/test";
import { flowViewOfCard } from "../../apps/hub-api/src/modules/packs/contracts/domain/approval-flow-view.rules";

const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

export type FlowActReply = { status: number; body: unknown } | ContractApproval | undefined;
const ACT = /\/flow\/contracts\.approval\/([^/]+)\/tasks\/([^/]*)\/actions\/([^/]+)$/;

const ID = "c1000000-0000-4000-8000-000000000001";
/** `/pack/me` giả (web preview không có hub): cờ `flow.runtime` quyết web đi FlowRuntime (bật) hay endpoint cũ (tắt = rollback). */
export const packMeAsHub = (flowRuntime: boolean) => ({
  versions: { admin: 1, hub: 1 },
  user: { id: ID, tenant_id: ID, role: "member", kind: "internal" },
  packs: { contracts: { enabled: true, level: "write", actions: ["read", "write"] } },
  addons: [],
  flags: {
    contracts: true,
    "contracts.read": true,
    "contracts.write": true,
    "flow.runtime": flowRuntime,
  },
  brand: null,
  home: "contracts",
  apps: ["contracts"],
});

type Opts = {
  /** Cờ `flow.runtime` của `/pack/me` (mặc định bật = CR-120). */
  runtime?: boolean;
  card: () => ContractApproval;
  /** Thẻ sau hành động, hoặc `{status, body}` (lỗi); vắng ⇒ thẻ hiện tại chuyển `done`. */
  onAct?: (
    body: Record<string, unknown>,
    task: string,
    raw: { path: string; body: unknown },
  ) => FlowActReply;
};

const isReply = (x: FlowActReply): x is { status: number; body: unknown } =>
  !!x && typeof (x as { status?: unknown }).status === "number" && "body" in x;

/** Hành động ⇒ ghi thân cũ qua `onAct`, trả `{view}` của thẻ sau hành động (hoặc lỗi). */
function onAction(r: Route, o: Opts, path: string, m: RegExpExecArray) {
  const [ref, task, action] = [m[1] ?? "", decodeURIComponent(m[2] ?? ""), m[3]];
  const b = (r.request().postDataJSON() ?? {}) as { feedback?: string; extension?: unknown };
  const legacy = {
    action,
    ...(b.feedback !== undefined ? { feedback: b.feedback } : {}),
    ...(b.extension !== undefined ? { products: b.extension } : {}),
  };
  const out = o.onAct?.(legacy, task, { path, body: b });
  if (isReply(out) && out.status !== 200) return json(r, out.status, out.body);
  const next = isReply(out)
    ? (out.body as ContractApproval)
    : (out ?? { ...o.card(), step: "done", can_act: false, task_id: null });
  return json(r, 200, { view: flowViewOfCard(next, ref, null) });
}

export async function mockApprovalFlow(page: Page, o: Opts): Promise<void> {
  await page.route(
    (u) => u.pathname === "/pack/me",
    (r) => json(r, 200, packMeAsHub(o.runtime !== false)),
  );
  await page.route("**/pack/contracts/flow/contracts.approval/**", (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith("/summary")) return json(r, 200, { slot: "contracts.approval", items: [] });
    const m = ACT.exec(path);
    if (m && r.request().method() === "POST") return onAction(r, o, path, m);
    const ref = decodeURIComponent(path.split("/").pop() ?? "");
    return json(r, 200, flowViewOfCard(o.card(), ref, null));
  });
}

/** CR-133 · `GET …/contracts/:id/files` (khối «Tài liệu kèm») — kịch bản có catch-all trả HĐ cho mọi đường con ⇒ `files.length` vỡ; gọi SAU catch-all. */
export async function mockContractFiles(page: Page): Promise<void> {
  await page.route("**/pack/contracts/contracts/*/files", (r) =>
    json(r, 200, { files: [], steps: [], can_add: false }),
  );
}
