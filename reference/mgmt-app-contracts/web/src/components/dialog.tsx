import { useEffect, useRef, useState, type ReactNode } from "react";

/** The app's own confirm / prompt, in a .sheet dialog, instead of the browser's grey window.confirm / window.prompt
 *  (which breaks the look and can't be styled or validated). Both are imperative so a handler reads like the native
 *  call: `if (await confirmDialog({…})) …` / `const name = await promptDialog({…})`. Rendered by <DialogHost/>
 *  (mounted once in App); one request shows at a time, a newer one cancels the one still open. */
const EVT = "dialog:open";

type ConfirmReq = { kind: "confirm"; title: string; body?: ReactNode; confirmLabel?: string; cancelLabel?: string; danger?: boolean };
type PromptReq = {
  kind: "prompt"; title: string; body?: ReactNode; label?: string; placeholder?: string; initial?: string;
  confirmLabel?: string; cancelLabel?: string; required?: boolean; maxLength?: number;
};
type Req = (ConfirmReq | PromptReq) & { resolve: (v: boolean | string | null) => void };

/** Yes/no: resolves true on confirm, false on cancel, Escape or a click on the backdrop. */
export function confirmDialog(o: Omit<ConfirmReq, "kind">): Promise<boolean> {
  return new Promise((resolve) =>
    window.dispatchEvent(new CustomEvent<Req>(EVT, { detail: { ...o, kind: "confirm", resolve: (v) => resolve(v === true) } })));
}
/** One line of text: resolves the trimmed text, or null if cancelled. With `required`, the button stays off until
 *  something is typed. */
export function promptDialog(o: Omit<PromptReq, "kind">): Promise<string | null> {
  return new Promise((resolve) =>
    window.dispatchEvent(new CustomEvent<Req>(EVT, { detail: { ...o, kind: "prompt", resolve: (v) => resolve(typeof v === "string" ? v : null) } })));
}

export function DialogHost() {
  const ref = useRef<HTMLDialogElement>(null);
  const [req, setReq] = useState<Req | null>(null);
  const [text, setText] = useState("");
  const done = useRef(false);     // guards against the double resolve a programmatic close() → onClose would cause

  useEffect(() => {
    const on = (e: Event) => {
      const r = (e as CustomEvent<Req>).detail;
      setReq((prev) => { if (prev && !done.current) prev.resolve(prev.kind === "prompt" ? null : false); return r; });
      setText(r.kind === "prompt" ? (r.initial ?? "") : "");
      done.current = false;
    };
    window.addEventListener(EVT, on);
    return () => window.removeEventListener(EVT, on);
  }, []);

  useEffect(() => { if (req && !ref.current?.open) ref.current?.showModal(); }, [req]);

  if (!req) return null;

  const finish = (value: boolean | string | null) => {
    if (done.current) return;
    done.current = true;
    req.resolve(value);
    ref.current?.close();
    setReq(null);
  };
  const isPrompt = req.kind === "prompt";
  const cancel = () => finish(isPrompt ? null : false);
  const confirmOff = req.kind === "prompt" && req.required ? !text.trim() : false;

  return (
    <dialog ref={ref} className="sheet" aria-label={req.title}
      onClose={cancel} onClick={(e) => { if (e.target === ref.current) cancel(); }}>
      <form className="flex flex-col gap-3 p-5" onSubmit={(e) => { e.preventDefault(); finish(isPrompt ? text.trim() : true); }}>
        <h2 className="text-lg font-semibold">{req.title}</h2>
        {req.body && <div className="text-sm text-ink-2">{req.body}</div>}
        {req.kind === "prompt" && (
          <label className="text-[13px]">{req.label}
            <input autoFocus className="field mt-1" value={text} placeholder={req.placeholder} maxLength={req.maxLength}
              onChange={(e) => setText(e.target.value)} />
          </label>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-quiet" onClick={cancel}>{req.cancelLabel ?? "Huỷ"}</button>
          <button type="submit" disabled={confirmOff}
            className={`btn ${req.kind === "confirm" && req.danger ? "bg-late text-on-act hover:opacity-90" : "btn-primary"}`}>
            {req.confirmLabel ?? (isPrompt ? "Lưu" : "Đồng ý")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
