// HUB-FR-105…117 · CR-056 · fixture mock quy trình P-a (plan-step0 §3, N5): id cố định `PA_FIX` cho FE/e2e, persona,
// quy trình `sdlc` + `hoa-don`. Id dạng `00000000-0000-4000-8000-0000000a0NNN` (plan ghi `pa<NNN>` — không phải hex).
import type { ExecutorRef, UserRef } from "@ai/contracts/chat";
import { MOCK_USERS, type MockUser } from "../users";

const fx = (n: number) => `00000000-0000-4000-8000-0000000a0${String(n).padStart(3, "0")}`;

function mockUser(username: string): MockUser {
  const u = MOCK_USERS.find((x) => x.username === username && x.tenant.key === "acme");
  if (!u) throw new Error(`mock user ${username} missing`);
  return u;
}

/** Persona plan-step0 §3: A bắt đầu · B kiểm trong phòng · X thành viên thường · T kiểm ngoài phòng · H/H2 được nhờ · Adm. */
export const PERSONA = {
  A: mockUser("lan"),
  B: mockUser("hoa"),
  X: mockUser("tam"),
  T: mockUser("cuc"),
  H: mockUser("q01"),
  H2: mockUser("q02"),
  Adm: mockUser("tadmin"),
} as const;
export type PersonaKey = keyof typeof PERSONA;
export const ref = (u: MockUser): UserRef => ({ id: u.id, display_name: u.display_name });

export const PA_FIX = {
  room: fx(1),
  gKeToan: fx(11),
  defSdlc: fx(21),
  defHoaDon: fx(22),
  runRunning: fx(101),
  runReview: fx(102),
  runAsk: fx(103),
  runDecision: fx(104),
  runDone: fx(105),
  runCancelled: fx(106),
  /** flow (thread) của run i = fx(200 + i). */
  flow: (runId: string) => fx(200 + Number(runId.slice(-3)) - 100),
  taskReview: fx(301),
  taskAsk: fx(302),
  taskDecision: fx(303),
  taskRunningPass: fx(304),
  taskDecisionFail: fx(305),
  taskDonePass: fx(306),
  persona: Object.fromEntries(Object.entries(PERSONA).map(([k, u]) => [k, u.id])) as Record<
    PersonaKey,
    string
  >,
  /** Persona `lan-left`: `POST /__mock/process {action:"leave"}` ⇒ A rời phòng R (U5). */
  lanLeft: "lan-left",
} as const;
/** Id sinh khi chạy (output, tin, task mới): dải `…0b0000000000+` (không đụng `PA_FIX`). */
let next = 0;
export const genId = () => `00000000-0000-4000-8000-0b${String(next++).padStart(10, "0")}`;
export const resetGenId = () => {
  next = 0;
};

export const ROOM_MEMBERS: readonly string[] = [PERSONA.A.id, PERSONA.B.id, PERSONA.X.id];
export const GROUPS = {
  [PA_FIX.gKeToan]: { id: PA_FIX.gKeToan, name: "Kế toán", members: [PERSONA.B.id, PERSONA.T.id] },
} as const;

export type StageMeta = {
  key: string;
  name: string;
  executor: ExecutorRef;
  after: "review" | "auto";
  real_action: boolean;
};
export type ProcessMeta = {
  id: string;
  key: string;
  name: string;
  description: string;
  input_hint: string;
  stages: StageMeta[];
};

const agent = (key: string, vi: string, en: string): ExecutorRef => ({
  kind: "agent",
  key,
  name: { vi, en },
});
const team = (key: string, vi: string, en: string): ExecutorRef => ({
  kind: "team",
  key,
  name: { vi, en },
});
const st = (
  key: string,
  name: string,
  executor: ExecutorRef,
  after: "review" | "auto" = "review",
) => ({ key, name, executor, after, real_action: false }) satisfies StageMeta;

export const PROCESSES: readonly ProcessMeta[] = [
  {
    id: PA_FIX.defHoaDon,
    key: "hoa-don",
    name: "Hoá đơn",
    description: "Đọc hoá đơn rồi ghi sổ kế toán.",
    input_hint: "Số hoá đơn, vd HD-12",
    stages: [
      st("doc", "Đọc hoá đơn", agent("hd-read", "Đọc hoá đơn", "Invoice reader")),
      {
        ...st("ghi-so", "Ghi sổ", team("ke-toan-team", "Nhóm kế toán", "Accounting team"), "auto"),
        real_action: true,
      },
    ],
  },
  {
    id: PA_FIX.defSdlc,
    key: "sdlc",
    name: "Phát triển phần mềm",
    description: "8 giai đoạn từ phân tích tới kiểm thử.",
    input_hint: "Mô tả yêu cầu",
    stages: [
      st("intake", "Phân tích", agent("intake-analyst", "Phân tích", "Intake")),
      st("build", "Xây dựng", team("dev-team", "Nhóm phát triển", "Dev team")),
      st("docs", "Tài liệu", agent("docs-architect", "Tài liệu", "Docs")),
      st("backend", "Backend", agent("backend-lead", "Backend", "Backend")),
      st("frontend", "Frontend", agent("frontend-lead", "Frontend", "Frontend")),
      st("qc", "Kiểm thử", team("test-team", "Nhóm kiểm thử", "Test team")),
      st("uat", "UAT", agent("qc-uat", "UAT", "UAT")),
      st("review", "Rà soát", agent("reviewer", "Rà soát", "Reviewer"), "auto"),
    ],
  },
];
export const processByKey = (key: string) => PROCESSES.find((p) => p.key === key);
export const processById = (id: string) => PROCESSES.find((p) => p.id === id);

/** Mốc thời gian cố định (fixture tất định). */
export const at = (min: number) => new Date(Date.UTC(2026, 9, 10, 1, min)).toISOString();
