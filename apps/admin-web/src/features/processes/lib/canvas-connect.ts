// CR-122 · p22 · kéo mũi tên trên canvas để đặt đích: cổng ra → trường đích đúng, cùng luật với các ô chọn bước.
//  - bước thường → "Sau đó đi tiếp" (`nextStep`; đích là bước ngay sau ⇒ xoá, vì đó là mặc định)
//  - node Nếu: cổng Đúng → `ifx.yes`, cổng Sai → `ifx.no` (đích Nếu không được là bước có `real_action` — như `targetOk` của contracts)
//  - CR-123 · FLOW3-FR-14: ô node module nhiều stage (Ký số = gửi + chờ): cổng ra `exit:<khoá>:<on,…>` đặt nhánh của stage CHỜ
//    (`wait.branches[on]` — Từ chối ⇒ declined+voided, Hết hạn ⇒ timeout); `exit:done` (hoặc cạnh tiến thường ra khỏi ô) ⇒ `nextStep` của stage chờ.
//    Luật đích như trên (chỉ bước SAU stage chờ); luật real_action của Nếu không áp cho đầu ra.
//  - đích phải ở bước SAU nguồn; sai ⇒ không đổi gì, trả mã lỗi (canvas báo bằng câu tiếng Việt).
// Thuần (không React) để test nhanh. Cổng "back" (Từ chối của bước DLC) không thuộc hàm này.
export type ConnectStage = {
  uid: string;
  step: number;
  executor: string;
  real: boolean;
  outcome?: string | undefined;
  ifx: { yes: number | null; no: number | null };
  /** CR-123 · khoá node module (`stage.node`) và khối chờ (cần `branches` + phần còn lại để ghi trả nguyên vẹn). */
  node?: string | undefined;
  wait?: ({ branches?: { on: string; step: number | null }[] | undefined } & object) | undefined;
};
export type ConnectError = "notLater" | "ifReal" | "noNext" | "noPort";
export type ConnectResult =
  | {
      ok: true;
      index: number;
      field: "yes" | "no" | "next" | "exit";
      patch: Record<string, unknown>;
    }
  | { ok: false; error: ConnectError; uid: string };

/** Tiền tố cổng ra của ô module: `exit:<khoá>` (đi tiếp: `exit:done`) hoặc `exit:<khoá>:<on1>,<on2>`. */
export const EXIT_PREFIX = "exit:";
export const exitHandle = (key: string, on?: readonly string[]): string =>
  on?.length ? `${EXIT_PREFIX}${key}:${on.join(",")}` : `${EXIT_PREFIX}${key}`;

/** Stage CHỜ của cụm node module bắt đầu ở `index` (các stage liền sau cùng `node`); không phải cụm ⇒ -1. */
function waitIndexOf(stages: readonly ConnectStage[], index: number): number {
  const node = stages[index]?.node;
  if (!node || stages[index]?.executor === "wait_event") return -1;
  for (let j = index + 1; stages[j]?.node === node; j++)
    if (stages[j]?.executor === "wait_event") return j;
  return -1;
}

function connectExit(
  stages: readonly ConnectStage[],
  head: ConnectStage,
  wi: number,
  dst: ConnectStage,
  handle: string | null | undefined,
): ConnectResult {
  const w = stages[wi] as ConnectStage;
  const fail = (error: ConnectError): ConnectResult => ({ ok: false, error, uid: head.uid });
  if (dst.step <= w.step) return fail("notLater");
  const on = handle?.startsWith(EXIT_PREFIX) ? (handle.split(":")[2]?.split(",") ?? []) : [];
  if (on.length === 0) {
    const sequential = dst.step === w.step + 1;
    return {
      ok: true,
      index: wi,
      field: "next",
      patch: { nextStep: sequential ? undefined : dst.step },
    };
  }
  const old = w.wait?.branches ?? [];
  const keep = old.filter((b) => !on.includes(b.on));
  const branches = [...keep, ...on.map((o) => ({ on: o, step: dst.step }))];
  return { ok: true, index: wi, field: "exit", patch: { wait: { ...w.wait, branches } } };
}

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
  const wi = waitIndexOf(stages, index);
  if (wi >= 0) return connectExit(stages, src, wi, dst, c.sourceHandle);
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
