// HUB-FR-104…117 · e2e P-a · dữ liệu cố định dùng chung cho `_pa-stack.ts` (bun) và `_pa-support.ts` (Playwright, Node).
// KHÔNG import `@playwright/test` / `bun:test`. Persona e2e (test-plan §2 ánh xạ sang user đăng nhập được của fixture M1 +
// user P-a chèn thêm, mật khẩu `PW`): A = `lan` "Lan Tran" · B = `hoa` "Hoa" (Group Kế toán/PO/Tech lead) · X = `tam` "Tam"
// (không Group kiểm) · T = `cuc` "Thomas" (Kế toán P-a/Tech lead, KHÔNG ở phòng) · H = `q01` "QC Người 01" · S = `q06` "QC Người 06"
// (người lạ) · Adm = `binh` "Binh Le" (tenant_admin acme). Dải id `a5e0…`.
import { TENANT_ID, USER_ID } from "../../tests/acceptance/M1/_data";

const x = (n: number) => `a5e00000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const ACME = TENANT_ID.acme;

export type Persona = { id: string; username: string; name: string };
export const PERSONA = {
  A: { id: USER_ID.lan, username: "lan", name: "Lan Tran" },
  B: { id: x(101), username: "hoa", name: "Hoa" },
  X: { id: x(102), username: "tam", name: "Tam" },
  T: { id: x(103), username: "cuc", name: "Thomas" },
  H: { id: x(104), username: "q01", name: "QC Người 01" },
  S: { id: x(105), username: "q06", name: "QC Người 06" },
  Adm: { id: USER_ID.binh, username: "binh", name: "Binh Le" },
} as const satisfies Record<string, Persona>;
export type Who = keyof typeof PERSONA;
/** User P-a chèn thêm (A, Adm có sẵn trong fixture M1). */
export const EXTRA_USERS: Persona[] = [PERSONA.B, PERSONA.X, PERSONA.T, PERSONA.H, PERSONA.S];

export const PA_E2E = {
  gKeToan: x(11), // "Kế toán P-a" (key `pa-ke-toan`; fixture M3 đã có `ke-toan`): B, T
  gPO: x(12), // "PO": B
  gTech: x(13), // "Tech lead": B, T
  gRun: x(14), // "Chạy hoá đơn": A, B (X không thuộc ⇒ không thấy `hoa-don-t`, E-P1)
  agentRead: x(51), // `hd-read` (stage 1 "Đọc hoá đơn")
  agentPost: x(52), // `hd-post` (stage 2 "Ghi sổ")
  defHoaDonT: x(31), // `hoa-don-t` "Hoá đơn T" (acme)
  defAuto: x(32), // `p-auto` "Tự chạy" (acme, 2 stage auto)
} as const;

export const SECRET_ROOM = "ROOM-SECRET-P1";

// biome-ignore lint/suspicious/noExplicitAny: json fixture theo contract chưa có
type Json = any;

/** Stage def (plan-contract §6) — dùng cho fixture SQL `process_defs.stages` + snapshot run. */
export function stage(o: Json): Json {
  return {
    key: o.key,
    name: o.name,
    executor: o.executor ?? { kind: "agent", agent_id: PA_E2E.agentRead },
    instruction: o.instruction ?? `Thực hiện ${o.name}.`,
    output: {
      filename: o.filename ?? `${o.key}.md`,
      template: (o.sections ?? ["Bảng ý", "Số tiền"]).map((s: string) => `## ${s}\n`).join("\n"),
      required_sections: o.sections ?? ["Bảng ý", "Số tiền"],
      fields: [],
    },
    after: o.after ?? { kind: "auto" },
    real_action: o.real_action ?? false,
    answerer: o.answerer ?? { kind: "starter" },
    timeout_s: 600,
    token_budget: null,
  };
}

/** `hoa-don-t` (e2e): stage 0 "Đọc hoá đơn" kiểm bởi Group Kế toán; stage 1 "Ghi sổ" tự chạy (không real_action: e2e
 * không dựng Dify; real_action phủ ở int P1-60…62 + kịch bản SC-2/E-S1 dùng mẫu seed `hoa-don`). */
export const DEF_HD_T = {
  id: PA_E2E.defHoaDonT,
  key: "hoa-don-t",
  name: "Hoá đơn T",
  stages: [
    stage({
      key: "doc",
      name: "Đọc hoá đơn",
      after: { kind: "review", group_id: PA_E2E.gKeToan },
    }),
    stage({ key: "ghi", name: "Ghi sổ", executor: { kind: "agent", agent_id: PA_E2E.agentPost } }),
  ],
  run_group_ids: [PA_E2E.gRun],
} as const;

export const DEF_AUTO = {
  id: PA_E2E.defAuto,
  key: "p-auto",
  name: "Tự chạy",
  stages: [stage({ key: "s1", name: "Bước một" }), stage({ key: "s2", name: "Bước hai" })],
  run_group_ids: [] as string[],
} as const;

/** Markdown đủ mục bắt buộc của stage (runtime giả mặc định). */
export const fullMd = (sections: string[], tag = ""): string =>
  sections.map((s) => `## ${s}\nNội dung ${s}${tag ? ` ${tag}` : ""}.\n`).join("\n");
