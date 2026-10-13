/// <reference lib="dom" />
// HUB-FR-119 · HUB-FR-128 · HUB-FR-115 · P-c1 · e2e helper (test-plan P-c §4; nhãn NGUYÊN VĂN plan-frontend §3/§5). Dùng lại stack
// P-b2 (Hub thật + Runtime giả P-a + admin-web + chat-web) và seed P-a/P-b2. `StageView.autofix` + nội dung diff/log GIẢ LẬP bằng
// `page.route` (như K1 vá `knowledge`); quyết định `autofix_*` đặt bằng SQL CHỈ khi 0031 có (CHECK `review_tasks_reason_ck` nới) —
// trước code giữ lý do cũ ⇒ ca đỏ ở locator, không đỏ ở dựng dữ liệu. Nút gate/decision dùng NHÃN SẴN CÓ của app (plan-frontend §3
// cuối: khoá sẵn có khác chữ ⇒ giữ khoá sẵn có): chat "Đạt"/"Chưa đạt", "Thêm 1 lần làm lại"/"Huỷ lượt chạy"/"Dùng bản hiện có".
import type { Page } from "@playwright/test";
import { ACME, PA_E2E } from "../P-a/_pa-data";
import { withSql } from "../P-a/_pa-support";

export {
  adminLogin,
  failBtn,
  hub,
  mkRoom,
  passBtn,
  seedRun,
  settle,
  tok,
  users,
  withSql,
} from "../P-a/_pa-support";
export { defByKey, node, openDef, panel, saveDef, seedPb2Run } from "../P-b2/_pb2-support";

// biome-ignore lint/suspicious/noExplicitAny: json theo contract chưa có
type Json = any;

const x = (n: number) => `c0e20000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const PC_E2E = {
  srcRepo: x(1),
  srcLib: x(2),
  defEdit: x(11),
  defBad: x(12),
  defLib: x(13),
  diffAtt: x(21),
  logAtt: x(22),
  bigAtt: x(23),
  libDoc: x(31),
} as const;
export const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

/** 0031 có chưa (bảng `hub.autofix_results`). */
export const pcReady = () =>
  withSql(async (sql) => {
    const [r] = await sql<
      { ok: boolean }[]
    >`select to_regclass('hub.autofix_results') is not null as ok`;
    return r?.ok === true;
  });

// ---------- dữ liệu diff ----------
/** 2 file văn bản (+3 −1) + 1 file nhị phân. */
export const DIFF = [
  "diff --git a/src/tong.ts b/src/tong.ts",
  "--- a/src/tong.ts",
  "+++ b/src/tong.ts",
  "@@ -1,3 +1,4 @@",
  " export function tong(a: number, b: number) {",
  "-  return a - b;",
  "+  return a + b;",
  "+  // PC-E2E-MARK sửa dấu",
  " }",
  "diff --git a/src/tong.test.ts b/src/tong.test.ts",
  "--- a/src/tong.test.ts",
  "+++ b/src/tong.test.ts",
  "@@ -1 +1,2 @@",
  ' import { tong } from "./tong";',
  "+test('cộng', () => expect(tong(1, 2)).toBe(3));",
  "diff --git a/assets/logo.png b/assets/logo.png",
  "Binary files a/assets/logo.png and b/assets/logo.png differ",
  "",
].join("\n");
/** Diff 2.600 dòng (một file) ⇒ cảnh báo "Diff lớn". */
export const BIG_DIFF = [
  "diff --git a/src/big.ts b/src/big.ts",
  "--- a/src/big.ts",
  "+++ b/src/big.ts",
  "@@ -0,0 +1,2596 @@",
  ...Array.from({ length: 2596 }, (_, i) => `+const v${i} = ${i};`),
  "",
].join("\n");
export const LOG = Array.from({ length: 40 }, (_, i) => `log dòng ${i + 1}`).join("\n");

const file = (id: string, name: string) => ({ id, name, mime: "text/plain", size: 1200 });
/** `AutofixStageView` (plan §3.4) — `o` ghi đè. */
export function afView(o: Json = {}): Json {
  return {
    source_key: "pc-repo",
    pin_sha: SHA,
    branch: "ai/9f3c1d2e-0000-4000-8000-000000000001/ra-soat",
    round: 1,
    status: "ok",
    diff_stats: { files: 3, insertions: 3, deletions: 1, bytes: DIFF.length },
    diff_file: file(PC_E2E.diffAtt, "ra-soat-r1.diff.txt"),
    test_log_file: file(PC_E2E.logAtt, "ra-soat-r1-test.log.txt"),
    test: { exit_code: 0, duration_ms: 12_400 },
    failures: [],
    created_at: "2026-10-13T08:00:00.000Z",
    ...o,
  };
}

/** Vá `GET /process-runs/:id` (Hub thật) — gắn `autofix` vào stage `idx`. */
export async function patchStage(
  p: Page,
  runId: string,
  idx: number,
  autofix: Json,
): Promise<void> {
  await p.route(new RegExp(`/process-runs/${runId}(\\?.*)?$`), async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    try {
      const res = await route.fetch();
      const body = (await res.json()) as Json;
      if (Array.isArray(body?.stages) && body.stages[idx]) body.stages[idx].autofix = autofix;
      await route.fulfill({ response: res, json: body });
    } catch {
      // context đóng khi request còn bay (u.close()) — bỏ qua.
    }
  });
}
/** Vá `GET /attachments/:id/content` — trả `text` (text/plain) hoặc mã lỗi. Đếm số lần gọi. */
export async function serveAttachment(
  p: Page,
  id: string,
  body: string | number,
): Promise<{ calls: number }> {
  const n = { calls: 0 };
  await p.route(new RegExp(`/attachments/${id}/content(\\?.*)?$`), (route) => {
    n.calls++;
    if (typeof body === "number")
      return route.fulfill({
        status: body,
        json: { error: { code: "NOT_FOUND", message: "Không tìm thấy" } },
      });
    return route.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", body });
  });
  return n;
}

// ---------- seed editor (SQL, acme) ----------
/** Nguồn `pc-repo` (git_remote) + `pc-lib` (library) + def `pc-edit` (1 stage review, chưa tự-sửa) + `pc-bad` (2 stage tự-sửa,
 * stage 2 tự chạy) + `pc-libsrc` (tự-sửa trên nguồn library) — jsonb nên nạp được trước/sau code. Idempotent. */
export async function seedEditor(): Promise<void> {
  await withSql(async (sql) => {
    await sql`insert into hub.sources (id, tenant_id, key, kind, config, description, version) values
      (${PC_E2E.srcRepo}, ${ACME}, 'pc-repo', 'git_remote',
        ${sql.json({ kind: "git_remote", url: "https://github.com/pc-e2e/app-repo.git", branch: "main" })}, 'Repo ứng dụng', 1),
      (${PC_E2E.srcLib}, ${ACME}, 'pc-lib', 'library', ${sql.json({ kind: "library", document_id: PC_E2E.libDoc })},
        'Tài liệu quy định', 1)
      on conflict do nothing`;
    const st = (key: string, name: string, after: Json, autofix: Json | undefined) => ({
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
      after,
      real_action: false,
      answerer: { kind: "starter" },
      timeout_s: 1800,
      token_budget: null,
      sources: [],
      must_know: [],
      ...(autofix === undefined ? {} : { autofix }),
    });
    const review = { kind: "review", group_id: PA_E2E.gKeToan };
    const af = (src: string) => ({
      source_key: src,
      install_cmd: null,
      test_cmd: "bun test",
      write_allowlist: [],
    });
    const defs = [
      {
        id: PC_E2E.defEdit,
        key: "pc-edit",
        name: "Tự sửa E2E",
        stages: [st("sua", "Sửa lỗi", review, undefined)],
      },
      {
        id: PC_E2E.defBad,
        key: "pc-bad",
        name: "Tự sửa lỗi cấu hình",
        stages: [
          st("sua-a", "Sửa A", review, af("pc-repo")),
          st("sua-b", "Sửa B", { kind: "auto" }, af("pc-repo")),
        ],
      },
      {
        id: PC_E2E.defLib,
        key: "pc-libsrc",
        name: "Tự sửa nguồn tài liệu",
        stages: [st("sua", "Sửa lỗi", review, af("pc-lib"))],
      },
    ];
    for (const d of defs)
      await sql`insert into hub.process_defs (id, tenant_id, key, name, description, input_hint, run_group_ids, stages,
          token_budget, enabled, version, sources, inputs)
        values (${d.id}, ${ACME}, ${d.key}, ${d.name}, ${`Quy trình e2e P-c ${d.name}.`}, 'Mô tả lỗi', '{}'::uuid[],
          ${sql.json(d.stages)}, null, true, 1, ${sql.json(["pc-repo", "pc-lib"])}, ${sql.json([])})
        on conflict (id) do update set stages = excluded.stages, version = hub.process_defs.version + 1`;
    await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
  });
}

/** Run `needs_decision` (seedRun P-a) ⇒ đổi lý do sang `reason` (chỉ khi 0031 có). Trả `ready`. */
export async function setDecision(
  runId: string,
  reason: "autofix_check_failed" | "sandbox_unavailable",
): Promise<boolean> {
  if (!(await pcReady())) return false;
  await withSql(async (sql) => {
    await sql`update hub.review_tasks set reason = ${reason} where process_run_id = ${runId} and kind = 'decision'`;
    await sql`update hub.process_runs set decision = decision || ${sql.json({ reason, options: ["add_attempt", "cancel"] })}
      where id = ${runId}`;
  });
  return true;
}
