import { useEffect, useState } from "react";

/** A brief confirmation shown bottom-centre and gone on its own: toast("Đã lưu"). Use it after a save the page
 *  otherwise only reflects by refetching, so a person knows it took. Errors stay inline with role="alert";
 *  kind "late" is for a short failure note. Fired from anywhere, rendered by <Toaster/> (mounted once in App). */
const EVT = "toast:show";
export type ToastKind = "ok" | "late";
type Detail = { message: string; kind: ToastKind };
type Item = Detail & { id: number };

export function toast(message: string, kind: ToastKind = "ok") {
  window.dispatchEvent(new CustomEvent<Detail>(EVT, { detail: { message, kind } }));
}

let seq = 0;
export function Toaster() {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const { message, kind } = (e as CustomEvent<Detail>).detail;
      const id = ++seq;
      setItems((cur) => [...cur, { id, message, kind }]);
      setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), 3200);
    };
    window.addEventListener(EVT, on);
    return () => window.removeEventListener(EVT, on);
  }, []);
  if (!items.length) return null;
  // bottom-centre on desktop; lifted above the phone bottom bar so it never hides under it
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex flex-col items-center gap-2 px-4 max-md:bottom-20">
      {items.map((t) => (
        <div key={t.id} role="status"
          className={`rise pointer-events-auto flex max-w-[min(92vw,420px)] items-center gap-2 rounded-xl border px-4 py-2.5 text-[13.5px] font-medium shadow-lg ${
            t.kind === "late" ? "border-late-line bg-late-bg text-late" : "border-ok-bg bg-ok-bg text-ok"}`}>
          <span aria-hidden>{t.kind === "late" ? "⚠" : "✓"}</span>
          <span className="min-w-0">{t.message}</span>
        </div>
      ))}
    </div>
  );
}
