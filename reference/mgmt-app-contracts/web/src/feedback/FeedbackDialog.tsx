import { useState } from "react";
import { useLocation } from "react-router";
import { api, errText } from "@/api/client";
import { IconClose, IconFeedback } from "@/components/icons";

const MAX_MB = 30;
const KINDS = ["đề xuất", "lỗi", "khen", "khác"] as const;
export const FEEDBACK_OPEN = "feedback:open";

/** Opens the "Góp ý về app" panel from anywhere: the header icon, the assistant (open_form), an old /feedback link.
 *  The Shell listens for this and slides the panel in (docked on wide screens, a sheet on phones). */
export function openFeedback() {
  window.dispatchEvent(new Event(FEEDBACK_OPEN));
}

/** "Góp ý về app" as a right-side panel (same slot as the assistant): a purpose, a description and screenshots,
 *  kept in the app and posted to the team's Trello board. */
export function FeedbackPanel({ onClose }: { onClose?: () => void }) {
  const { pathname, search } = useLocation();
  const [files, setFiles] = useState<File[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  function add(list: FileList | File[] | null) {
    const got = [...(list ?? [])].filter((f) => f.size > 0);
    if (got.some((f) => f.size > MAX_MB * 1024 * 1024)) return setErr(`Mỗi file tối đa ${MAX_MB} MB`);
    setErr(null);
    setFiles((was) => [...was, ...got].slice(0, 20));
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;            // React clears currentTarget once the handler awaits
    const f = new FormData(form);
    const purpose = String(f.get("purpose") ?? "").trim();
    const description = String(f.get("description") ?? "").trim();
    if (!purpose && !description && !files.length) return setErr("Hãy ghi mục đích hoặc mô tả, hoặc đính kèm ảnh");
    const body = new FormData();
    body.append("purpose", purpose);
    body.append("description", description);
    body.append("kind", String(f.get("kind") || "khác"));
    body.append("page", pathname + search);
    files.forEach((x) => body.append("files", x));
    setBusy(true);
    setErr(null);
    try {
      await api("/feedback", { method: "POST", body });
      form.reset();
      setFiles([]);
      setSent(true);
    } catch (x) { setErr(errText(x)); } finally { setBusy(false); }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[58px] shrink-0 items-center gap-2.5 px-4">
        <span aria-hidden className="grid h-8 w-8 place-items-center rounded-xl bg-act-soft text-act"><IconFeedback width={18} height={18} /></span>
        <h2 className="min-w-0 flex-1 text-[14.5px] font-semibold">Góp ý về app</h2>
        {onClose && (
          <button type="button" onClick={onClose} title="Đóng" aria-label="Đóng"
            className="grid h-8 w-8 place-items-center rounded-lg text-dim hover:bg-sunk hover:text-ink"><IconClose width={17} height={17} /></button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {sent ? (
          <div className="flex flex-col gap-3 pt-2">
            <h3 className="text-lg font-semibold">Cảm ơn anh/chị!</h3>
            <p className="text-sm text-ink-2">Góp ý đã được gửi tới nhóm làm app. Có thể gửi thêm bất cứ lúc nào, hoặc nhờ trợ lý AI ghi giúp.</p>
            <div className="flex gap-2">
              <button type="button" className="btn btn-quiet" onClick={() => setSent(false)}>Gửi thêm góp ý</button>
              {onClose && <button type="button" className="btn btn-primary" onClick={onClose}>Đóng</button>}
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3 pt-2"
            onPaste={(e) => { if (e.clipboardData.files.length) add(e.clipboardData.files); }}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files); }}>
            <label className="text-[13px]">Loại
              <select name="kind" defaultValue="đề xuất" className="field mt-1">
                {KINDS.map((k) => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}
              </select>
            </label>
            <label className="text-[13px]">Mục đích
              <input name="purpose" maxLength={200} className="field mt-1" placeholder="Vd: Muốn lọc hợp đồng theo người phụ trách" />
            </label>
            <label className="text-[13px]">Mô tả
              <textarea name="description" rows={5} className="field mt-1 h-auto py-2"
                placeholder="Chuyện gì xảy ra, ở màn hình nào, anh/chị mong app làm gì…" />
            </label>
            <div className="rounded-lg border border-dashed border-rule p-3 text-[13px] text-dim">
              Kéo thả, dán (Ctrl+V) ảnh chụp màn hình vào đây, hoặc{" "}
              <label className="cursor-pointer text-act underline">chọn file
                <input type="file" multiple className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
              </label>
              {files.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="flex items-center gap-1 rounded-full bg-sunk px-2.5 py-0.5 text-ink-2">
                      {f.name}
                      <button type="button" aria-label={`Bỏ ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>✕</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {err && <p role="alert" className="text-sm text-late">{err}</p>}
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Đang gửi…" : "Gửi góp ý"}</button>
          </form>
        )}
      </div>
    </div>
  );
}
