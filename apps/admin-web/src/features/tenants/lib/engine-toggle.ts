// CR-120 · công tắc "Duyệt theo quy trình" của app Sổ Hợp Tác = feature `contracts-approval-engine`, nằm trong khối "Quy trình"
// của thẻ app (không còn trong "Tính năng thêm" ⇒ một khái niệm, một công tắc). Vẫn ghi qua đường lưu feature sẵn có.
export const ENGINE_KEY = "contracts-approval-engine";

export type EngineToggle = { on: boolean; disabled: boolean; onChange: (on: boolean) => void };

/** Công tắc cho khối Quy trình khi thẻ app có feature đó (null = thẻ không có ⇒ giữ như cũ). */
export function engineOf(
  addons: readonly { key: string }[],
  draft: ReadonlySet<string>,
  locked: boolean,
  onSet: (on: boolean) => void,
): EngineToggle | null {
  return addons.some((f) => f.key === ENGINE_KEY)
    ? { on: draft.has(ENGINE_KEY), disabled: locked, onChange: onSet }
    : null;
}
