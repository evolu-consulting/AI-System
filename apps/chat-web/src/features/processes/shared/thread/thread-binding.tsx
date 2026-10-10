// CR-056 · P-a plan-frontend-thread §2/§5: ràng một việc vào composer thread (chế độ Góp ý / Trả lời).
// Thẻ việc gọi `begin({..., submit})` truyền hàm gửi của mình; `ProcessThreadFooter` chỉ gọi `binding.submit(text)` — không import
// hook/thẻ của PF khác. Xử lý `REVIEW_TASK_CLOSED`/toast nằm trong `submit` của thẻ. Ngoài thread = `null` ⇒ thẻ dùng ô inline.
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

export type ThreadBindingKind = "feedback" | "answer";

export type ThreadBindingBegin = {
  kind: ThreadBindingKind;
  taskId: string;
  /** Tên agent/nhóm hiện trên dải "Chưa đạt · góp ý cho {{agent}}". */
  agent: string;
  /** Gửi văn bản của composer; reject ⇒ footer giữ chữ + hiện lỗi. */
  submit(text: string): Promise<void>;
};

export type ActiveThreadBinding = Omit<ThreadBindingBegin, "submit">;

export type ThreadBinding = {
  /** Chế độ đang ràng (`null` = Thường). */
  active: ActiveThreadBinding | null;
  begin(b: ThreadBindingBegin): void;
  cancel(): void;
  /** Chip gõ vào ô (`ask.hintMulti`): điền chữ vào composer đang ở chế độ ràng. */
  fill(text: string): void;
  /** Footer gọi khi gửi; không ràng ⇒ resolve ngay. */
  submit(text: string): Promise<void>;
  /** Footer đăng ký hàm điền chữ vào ô nhập. */
  registerFill(fn: ((text: string) => void) | null): void;
};

const Ctx = createContext<ThreadBinding | null>(null);

/** `null` ngoài thread (inbox, `/runs/:id`, DM) ⇒ thẻ việc tự mở ô nhập inline. */
export const useThreadBinding = (): ThreadBinding | null => useContext(Ctx);

export function ThreadBindingProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveThreadBinding | null>(null);
  const submitRef = useRef<ThreadBindingBegin["submit"] | null>(null);
  const fillRef = useRef<((text: string) => void) | null>(null);
  const begin = useCallback((b: ThreadBindingBegin) => {
    const { submit, ...rest } = b;
    submitRef.current = submit;
    setActive(rest);
  }, []);
  const cancel = useCallback(() => {
    submitRef.current = null;
    setActive(null);
  }, []);
  const submit = useCallback(async (text: string) => {
    const fn = submitRef.current;
    if (!fn) return;
    await fn(text);
    submitRef.current = null;
    setActive(null);
  }, []);
  const fill = useCallback((text: string) => fillRef.current?.(text), []);
  const registerFill = useCallback((fn: ((text: string) => void) | null) => {
    fillRef.current = fn;
  }, []);
  const value = useMemo<ThreadBinding>(
    () => ({ active, begin, cancel, fill, submit, registerFill }),
    [active, begin, cancel, fill, submit, registerFill],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
