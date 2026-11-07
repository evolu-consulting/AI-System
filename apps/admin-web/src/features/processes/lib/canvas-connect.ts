// CR-122 · p22 · kéo mũi tên trên canvas để đặt đích: cổng ra → trường đích đúng, cùng luật với các ô chọn bước.
//  - bước thường → "Sau đó đi tiếp" (`nextStep`; đích là bước ngay sau ⇒ xoá, vì đó là mặc định)
//  - node Nếu: cổng Đúng → `ifx.yes`, cổng Sai → `ifx.no` (đích Nếu không được là bước có `real_action` — như `targetOk` của contracts)
//  - đích phải ở bước SAU nguồn; sai ⇒ không đổi gì, trả mã lỗi (canvas báo bằng câu tiếng Việt).
// Thuần (không React) để test nhanh. Cổng "back" (Từ chối) không thuộc hàm này.
export type ConnectStage = {
  uid: string;
  step: number;
  executor: string;
  real: boolean;
  outcome?: string | undefined;
  ifx: { yes: number | null; no: number | null };
};
export type ConnectError = "notLater" | "ifReal" | "noNext" | "noPort";
export type ConnectResult =
  | { ok: true; index: number; field: "yes" | "no" | "next"; patch: Record<string, unknown> }
  | { ok: false; error: ConnectError; uid: string };

export function connectPatch(
  stages: readonly ConnectStage[],
  c: { source: string; target: string; sourceHandle?: string | null },
): ConnectResult | null {
  if (c.sourceHandle === "back") return null;
  const index = stages.findIndex((s) => s.uid === c.source);
  const src = stages[index];
  const dst = stages.find((s) => s.uid === c.target);
  if (!src || !dst) return null;
  const fail = (error: ConnectError): ConnectResult => ({ ok: false, error, uid: src.uid });
  if (dst.step <= src.step) return fail("notLater");
  if (src.executor === "if") {
    const port = c.sourceHandle;
    if (port !== "yes" && port !== "no") return fail("noPort");
    if (stages.some((s) => s.step === dst.step && s.real)) return fail("ifReal");
    // `ifx.yes/no` đếm từ 1 (như ô chọn); StageView/contract 0-based.
    return { ok: true, index, field: port, patch: { ifx: { ...src.ifx, [port]: dst.step + 1 } } };
  }
  if (src.outcome !== undefined || src.executor === "wait_event") return fail("noNext");
  const sequential = dst.step === src.step + 1;
  return { ok: true, index, field: "next", patch: { nextStep: sequential ? undefined : dst.step } };
}
