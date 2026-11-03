// CR-114 hub-eval · định dạng bộ eval chất lượng agent Hub (một nguồn kiểu cho grade/runner/live/test).
//
// Bố cục `eval/hub/`:
//   cases.json            — danh sách ca (EvalCase[]): đầu vào + kỳ vọng. Dữ liệu demo, KHÔNG có dữ liệu khách thật.
//   fixtures.json         — tenant demo (tri thức/hợp đồng riêng từng tenant) + registry agent/tool + canary bí mật.
//   recorded.replay.json  — câu trả lời đã ghi (replay): `bun run eval:hub --mode live --record <file>` sinh lại.
//   baseline.replay.json  — điểm chuẩn của replay (so sánh hồi quy, `--baseline`).
// Chấm theo luật trước (route, facts, forbidden, token, độ trễ); LLM judge chỉ cho `expect.judge` (sự kiện văn tự do)
// và chỉ khi mọi luật đã đạt (tiết kiệm tiền). Judge: temperature 0, prompt trong `judge.ts`.

export type Action = "answer" | "delegate" | "tool" | "refuse";

export type RouteExpect = {
  /** Một hoặc nhiều hành động chấp nhận được. */
  action: Action | Action[];
  /** Agent được giao (delegate) hoặc tool được gọi (tool). */
  target?: string;
  /** Tool phải đi qua bước xác nhận của người dùng. */
  confirm?: boolean;
};

export type Expect = {
  route?: RouteExpect;
  /** Mỗi phần tử là một sự kiện bắt buộc; `a|b` = một trong các cách viết. So khớp không dấu, không phân biệt hoa/thường. */
  facts?: string[];
  /** Không phần nào được xuất hiện trong text/args (dữ liệu tenant khác, bí mật). Cùng cách so khớp. */
  forbidden?: string[];
  /** Rubric cho LLM judge (sự kiện không bắt được bằng từ khoá); chỉ chạy khi luật đã đạt. */
  judge?: string;
  /** Trần token output. */
  maxTokens?: number;
  /** Trần độ trễ (ms). */
  maxLatencyMs?: number;
};

export type EvalCase = {
  id: string;
  /** Agent được đánh giá: `orchestrator` hoặc id agent chuyên trách. */
  agent: string;
  tags?: string[];
  /** Khoá tenant trong `fixtures.json`. */
  tenant: string;
  input: string;
  expect: Expect;
};

/** Một lượt đáp của agent (đã ghi hoặc chạy live). */
export type AgentResponse = {
  action: Action;
  target?: string;
  confirm?: boolean;
  args?: Record<string, unknown>;
  text: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  /** Kết quả judge đã ghi (chỉ replay). */
  judge?: JudgeVerdict;
};

export type JudgeVerdict = { pass: boolean; note?: string };

export type Check = { name: string; ok: boolean; detail?: string };

export type CaseResult = {
  id: string;
  agent: string;
  pass: boolean;
  /** Tỉ lệ check đạt (0..1). */
  score: number;
  checks: Check[];
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
};

export type Fixtures = {
  canaries: string[];
  tenants: Record<string, { name: string; context: string[] }>;
  agents: Record<
    string,
    {
      role: string;
      delegates?: string[];
      tools?: { name: string; confirm?: boolean; desc: string }[];
    }
  >;
};

export type Recorded = {
  model: string;
  source: string;
  responses: Record<string, AgentResponse>;
};

export type Baseline = {
  version: 1;
  overall: number;
  agents: Record<string, number>;
  cases: Record<string, { score: number; pass: boolean }>;
};

export type Report = {
  mode: "replay" | "live";
  overall: number;
  agents: Record<string, number>;
  results: CaseResult[];
};
