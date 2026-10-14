/// <reference lib="dom" />
// HUB-FR-129 · HUB-FR-128 · HUB-FR-115 · HUB-FR-68 · P-c2 · e2e helper (test-plan P-c2 §4; nhãn NGUYÊN VĂN plan-frontend §3/§5). Stack P-b2
// (như P-c). `StageView.apply` + `AutofixStageView.apply_mode/apply_base` GIẢ LẬP bằng `page.route` (vá thân Hub thật); lý do quyết định
// `apply_*` đặt bằng SQL CHỈ khi 0032 có (CHECK nới) — trước code giữ lý do cũ ⇒ đỏ ở locator, không ở dựng dữ liệu. Nút gate/quyết
// định giữ nhãn sẵn có (FC14): "Đạt"/"Chưa đạt", "Thêm 1 lần làm lại"/"Huỷ lượt chạy". Nguồn/khoá/def nạp SQL jsonb (được trước code).
import type { Page } from "@playwright/test";
import { ACME, PA_E2E } from "../P-a/_pa-data";
import { withSql } from "../P-a/_pa-support";
import { afView, PC_E2E, SHA } from "../P-c/_pc-support";

export {
  adminLogin,
  defByKey,
  hub,
  mkRoom,
  node,
  openDef,
  panel,
  passBtn,
  saveDef,
  seedPb2Run,
  seedRun,
  serveAttachment,
  settle,
  tok,
  users,
  withSql,
} from "../P-c/_pc-support";
export { afView, PC_E2E, SHA };

// biome-ignore lint/suspicious/noExplicitAny: json theo contract chưa có
type Json = any;

const x = (n: number) => `c2e20000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const PC2_E2E = {
  srcGh: x(1),
  srcLocal: x(2),
  srcUsed: x(3),
  credUsed: x(11),
  defEdit: x(21),
  defBad: x(22),
} as const;
export const SHA2 = "b2c3d4e5f60718293a4b5c6d7e8f901234567890";
export const RUN = "9f3c1d2e-0000-4000-8000-000000000001";
export const BRANCH = `ai/${RUN}/ra-soat`;
export const PR_URL = "https://github.com/pc2-e2e/app-repo/pull/42";
/** Tên file diff của `afView()` (P-c). */
export const DIFF_NAME = "ra-soat-r1.diff.txt";
export const ADD = "Thêm 1 lần làm lại";
export const CANCEL = "Huỷ lượt chạy";
export const USE = "Dùng bản hiện có";

/** 0032 có chưa (bảng `hub.autofix_applies`). */
export const pc2Ready = () =>
  withSql(async (sql) => {
    const [r] = await sql<
      { ok: boolean }[]
    >`select to_regclass('hub.autofix_applies') is not null as ok`;
    return r?.ok === true;
  });

/** `ApplyStageView` (plan §3.6) — `o` ghi đè. */
export function applyView(o: Json = {}): Json {
  return {
    mode: "pr",
    status: "pr_opened",
    branch: BRANCH,
    target_sha: SHA,
    head_sha: SHA2,
    rebased: false,
    provider: "github",
    pr_number: 42,
    pr_url: PR_URL,
    auto_merge: null,
    error_code: null,
    conflict_files: [],
    failures: [],
    test_log_file: null,
    created_at: "2026-10-14T08:00:00.000Z",
    ...o,
  };
}

/** Vá `GET /process-runs/:id` (Hub thật): `patch(stages)` sửa mảng stage tại chỗ. `state.patch` đổi được giữa các lần tải. */
export async function patchRun(
  p: Page,
  runId: string,
  patch: (stages: Json[]) => void,
): Promise<{ patch: (stages: Json[]) => void }> {
  const state = { patch };
  await p.route(new RegExp(`/process-runs/${runId}(\\?.*)?$`), async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    try {
      const res = await route.fetch();
      const body = (await res.json()) as Json;
      if (Array.isArray(body?.stages)) state.patch(body.stages);
      await route.fulfill({ response: res, json: body });
    } catch {
      // context đóng khi request còn bay — bỏ qua.
    }
  });
  return state;
}
/** Gắn `apply` vào stage `idx` (+ `autofix` vào stage `afIdx` nếu cho). */
export const withApply =
  (idx: number, apply: Json, afIdx?: number, autofix?: Json) => (stages: Json[]) => {
    if (stages[idx]) stages[idx].apply = apply;
    if (afIdx !== undefined && stages[afIdx]) stages[afIdx].autofix = autofix;
  };

/** Run `needs_decision` (seedRun P-a) ⇒ lý do `apply_*` (chỉ khi 0032 có). Trả `ready`. */
export async function setApplyDecision(
  runId: string,
  reason: "apply_conflict" | "apply_failed",
): Promise<boolean> {
  if (!(await pc2Ready())) return false;
  await withSql(async (sql) => {
    await sql`update hub.review_tasks set reason = ${reason} where process_run_id = ${runId} and kind = 'decision'`;
    await sql`update hub.process_runs set decision = decision || ${sql.json({ reason, options: ["add_attempt", "cancel"] })}
      where id = ${runId}`;
  });
  return true;
}

// ---------- seed admin (SQL, acme) ----------
const stageOf = (key: string, name: string, o: Json = {}): Json => ({
  key,
  name,
  executor: { kind: "agent", agent_id: PA_E2E.agentRead },
  instruction: `Thực hiện ${name}.`,
  output: {
    filename: `${key}.md`,
    template: "## Kết quả\n",
    required_sections: ["Kết quả"],
    fields: [],
  },
  after: { kind: "review", group_id: PA_E2E.gKeToan },
  real_action: false,
  answerer: { kind: "starter" },
  timeout_s: 1800,
  token_budget: null,
  sources: [],
  must_know: [],
  ...o,
});
const AF = { source_key: "pc2-repo", install_cmd: null, test_cmd: "bun test", write_allowlist: [] };
const APPLY = {
  executor: { kind: "apply" },
  after: { kind: "auto" },
  real_action: true,
  autofix: null,
  output: {
    filename: "apply.md",
    template: "## Kết quả áp\n",
    required_sections: ["Kết quả áp"],
    fields: [],
  },
};

/**
 * Nguồn `pc2-repo` (github, không khoá), `pc2-local` (local_path), `pc2-used` (github + khoá `gh-e2e-used`) + secret metadata
 * `gh-e2e-used` (bản mã giả — chỉ để liệt kê/used_by, không giải) + def `pc2-edit` (tự-sửa + stage thường "Áp thử" review) và
 * `pc2-bad` (tự-sửa + 2 stage Áp nối tiếp). Idempotent. jsonb ⇒ nạp được trước code.
 */
export async function seedPc2Admin(): Promise<void> {
  await withSql(async (sql) => {
    await sql`insert into hub.secrets (id, kind, tenant_id, name, ciphertext, iv, key_version)
      values (${PC2_E2E.credUsed}, 'source_credential', ${ACME}, 'gh-e2e-used', ${Buffer.alloc(32, 1)}, ${Buffer.alloc(12, 2)}, 1)
      on conflict do nothing`;
    const git = (repo: string, cred: string | null) =>
      sql.json({
        kind: "git_remote",
        url: `https://github.com/pc2-e2e/${repo}.git`,
        branch: "main",
        ...(cred ? { credential_secret_id: cred } : {}),
      });
    await sql`insert into hub.sources (id, tenant_id, key, kind, config, description, version) values
      (${PC2_E2E.srcGh}, ${ACME}, 'pc2-repo', 'git_remote', ${git("app-repo", null)}, 'Repo ứng dụng P-c2', 1),
      (${PC2_E2E.srcLocal}, ${ACME}, 'pc2-local', 'local_path', ${sql.json({ kind: "local_path", path: "/srv/pc2-local" })},
        'Thư mục cục bộ P-c2', 1),
      (${PC2_E2E.srcUsed}, ${ACME}, 'pc2-used', 'git_remote', ${git("used-repo", PC2_E2E.credUsed)}, 'Repo riêng P-c2', 1)
      on conflict do nothing`;
    const defs = [
      {
        id: PC2_E2E.defEdit,
        key: "pc2-edit",
        name: "Áp E2E",
        stages: [
          stageOf("sua", "Sửa lỗi", { autofix: AF }),
          stageOf("ap", "Áp thử", { autofix: null }),
        ],
      },
      {
        id: PC2_E2E.defBad,
        key: "pc2-bad",
        name: "Áp lỗi cấu hình",
        stages: [
          stageOf("sua", "Sửa lỗi", { autofix: AF }),
          stageOf("ap-1", "Áp 1", APPLY),
          stageOf("ap-2", "Áp 2", APPLY),
        ],
      },
    ];
    for (const d of defs)
      await sql`insert into hub.process_defs (id, tenant_id, key, name, description, input_hint, run_group_ids, stages,
          token_budget, enabled, version, sources, inputs)
        values (${d.id}, ${ACME}, ${d.key}, ${d.name}, ${`Quy trình e2e P-c2 ${d.name}.`}, 'Mô tả lỗi', '{}'::uuid[],
          ${sql.json(d.stages)}, null, true, 1, ${sql.json(["pc2-repo"])}, ${sql.json([])})
        on conflict (id) do update set stages = excluded.stages, version = hub.process_defs.version + 1`;
    await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
  });
}
