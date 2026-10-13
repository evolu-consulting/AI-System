// HUB-FR-131 · HUB-FR-132 · HUB-FR-133 · CR-073 · plan K1 §7 · trạng thái mock KnowledgeHub (mỗi instance một bản, bộ nhớ):
// cấu hình điều khiển được, hit theo project, vector đã ghi, nhật ký lời gọi (KHÔNG lưu giá trị khoá).
import { z } from "zod";

export const KH_MOCK_SCENARIOS = [
  "ok",
  "key_rejected",
  "server_error",
  "server_error_once",
  "rate_limited",
  "timeout",
  "bad_body",
] as const;
export type KhMockScenario = (typeof KH_MOCK_SCENARIOS)[number];

export type KhMockHit = { score: number; source_text: string };
export type KhMockCall = {
  method: string;
  path: string;
  /** có gửi khoá (`X-KH-Key` hoặc `Bearer`) — không lưu giá trị. */
  sent_key: boolean;
  key_ok: boolean;
  body: unknown;
  status: number;
};
export type KhMockVector = {
  id: string;
  text: string;
  scope: unknown;
  metadata: unknown;
  writes: number;
};

export type KhMockConfig = {
  scenario: KhMockScenario;
  /** false = KH tắt xác thực. */
  auth: boolean;
  version: string;
  model: string;
  projects: string[];
};

export type KhMockState = {
  cfg: KhMockConfig;
  hits: Map<string, KhMockHit[]>;
  vectors: Map<string, KhMockVector>;
  calls: KhMockCall[];
};

export const KH_MOCK_DEFAULT_PROJECTS = ["evolu", "shared"] as const;
export const KH_MOCK_CALLS_MAX = 500;

const ProjectId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/);
export const KhMockConfigPatchSchema = z.strictObject({
  scenario: z.enum(KH_MOCK_SCENARIOS),
  auth: z.boolean().optional(),
  version: z.string().min(1).max(64).optional(),
  model: z.string().min(1).max(200).optional(),
  projects: z.array(ProjectId).max(100).optional(),
});
export const KhMockHitsSchema = z.strictObject({
  hits: z
    .array(z.strictObject({ score: z.number(), source_text: z.string().max(100_000) }))
    .max(100),
});

function defaultHits(projects: readonly string[]): Map<string, KhMockHit[]> {
  return new Map(
    projects.map((p) => [
      p,
      [
        {
          score: 0.82,
          source_text: `[${p}] Quy ước đặt tên module: feature-first, file ≤ 400 dòng.`,
        },
        { score: 0.64, source_text: `[${p}] Mọi query lọc tenant_id và bật RLS.` },
      ],
    ]),
  );
}

export function freshKhState(projects: readonly string[] = KH_MOCK_DEFAULT_PROJECTS): KhMockState {
  return {
    cfg: {
      scenario: "ok",
      auth: true,
      version: "v6.4",
      model: "BAAI/bge-m3",
      projects: [...projects],
    },
    hits: defaultHits(projects),
    vectors: new Map(),
    calls: [],
  };
}

export function recordCall(st: KhMockState, call: KhMockCall): void {
  st.calls.push(call);
  if (st.calls.length > KH_MOCK_CALLS_MAX) st.calls.splice(0, st.calls.length - KH_MOCK_CALLS_MAX);
}
