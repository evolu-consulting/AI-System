// HUB-FR-104 · HUB-FR-118 · ADM-FR-71 · CHAT-AC-59/60 · e2e P-b2 (test-plan §4) · dữ liệu cố định cho `_pb2-stack.ts` (bun) và
// `_pb2-support.ts` (Playwright). KHÔNG import `@playwright/test`. Persona = P-a (`_pa-data.ts`): A lan · B hoa (Kế toán P-a) ·
// T cuc (Kế toán P-a + "Kiểm thử P-b2", KHÔNG ở phòng) · H q01 (ngoài phòng) · Adm binh. Dải id `b2e2…`.
import { ACME, PA_E2E, PERSONA, stage } from "../P-a/_pa-data";

export { ACME, PA_E2E, PERSONA };

const x = (n: number) => `b2e20000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// biome-ignore lint/suspicious/noExplicitAny: json fixture theo contract chưa có
type Json = any;

export const PB2_E2E = {
  gTest: x(1), // "Kiểm thử P-b2": CHỈ T
  defCanvas: x(31),
  defFull: x(32),
  defPar: x(33),
  defPar2: x(34),
} as const;

const KT = PA_E2E.gKeToan;
/** Stage (`stage()` P-a) + `step` + `after.back_to_steps`. `review` = group id (vắng ⇒ auto). */
export function st2(o: {
  key: string;
  name: string;
  step: number;
  review?: string;
  back?: number[];
  agent?: string;
  real?: boolean;
}): Json {
  const after = o.review
    ? { kind: "review", group_id: o.review, ...(o.back ? { back_to_steps: o.back } : {}) }
    : undefined;
  return {
    ...stage({
      key: o.key,
      name: o.name,
      after,
      real_action: o.real,
      executor: o.agent ? { kind: "agent", agent_id: o.agent } : undefined,
    }),
    step: o.step,
  };
}

/** Admin canvas (E-PB2-01…11): Test hồi quy = tự chạy (E-PB2-07/08), không `back_to_steps` (E-PB2-06 tự đặt). */
export const DEF_CANVAS = {
  id: PB2_E2E.defCanvas,
  key: "pb2-canvas",
  name: "Canvas thử",
  stages: [
    st2({ key: "phan-tich", name: "Phân tích", step: 0, review: KT }),
    st2({ key: "ra-soat", name: "Rà soát code", step: 1, review: KT }),
    st2({ key: "hoi-quy", name: "Test hồi quy", step: 1 }),
    st2({ key: "tong-hop", name: "Tổng hợp", step: 2, review: KT, agent: PA_E2E.agentPost }),
  ],
} as const;
/** Admin (E-PB2-05): bước 1 (UI 2) đã đủ 3 stage. */
export const DEF_FULL = {
  id: PB2_E2E.defFull,
  key: "pb2-full",
  name: "Đủ ba",
  stages: [
    st2({ key: "mo-dau", name: "Mở đầu", step: 0, review: KT }),
    st2({ key: "nhanh-1", name: "Nhánh 1", step: 1, review: KT }),
    st2({ key: "nhanh-2", name: "Nhánh 2", step: 1, review: KT }),
    st2({ key: "nhanh-3", name: "Nhánh 3", step: 1, review: KT }),
    st2({ key: "ket", name: "Kết", step: 2 }),
  ],
} as const;
/** Chat (seed a, b, c, d): như int `pb2-par` — cả hai stage bước 1 do Group Kế toán P-a kiểm (B thấy 2 thẻ, Q7). */
export const DEF_PAR = {
  id: PB2_E2E.defPar,
  key: "pb2-par",
  name: "Song song",
  stages: [
    st2({ key: "phan-tich", name: "Phân tích", step: 0, review: KT }),
    st2({ key: "ra-soat", name: "Rà soát code", step: 1, review: KT }),
    st2({ key: "hoi-quy", name: "Test hồi quy", step: 1, review: KT, back: [0] }),
    st2({
      key: "tong-hop",
      name: "Tổng hợp",
      step: 2,
      review: KT,
      back: [0, 1],
      agent: PA_E2E.agentPost,
    }),
  ],
} as const;
/** Chat (seed a'): P1a do Kế toán P-a (B), P1b do "Kiểm thử P-b2" (T); cùng đích bước 0 (E-PB2-24). */
export const DEF_PAR2 = {
  id: PB2_E2E.defPar2,
  key: "pb2-par2",
  name: "Cùng đích",
  stages: [
    st2({ key: "p0", name: "P0", step: 0, review: KT }),
    st2({ key: "p1a", name: "P1a", step: 1, review: KT, back: [0] }),
    st2({ key: "p1b", name: "P1b", step: 1, review: PB2_E2E.gTest, back: [0] }),
  ],
} as const;
export const PB2_DEFS = [DEF_CANVAS, DEF_FULL, DEF_PAR, DEF_PAR2] as const;
