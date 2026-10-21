// feedback · khung "Góp ý về app" dùng chung 4 web: gửi (loại, nội dung, ảnh/tệp; trang + app + phiên bản tự gắn) và xem góp ý đã gửi
// kèm trạng thái + phản hồi của admin. Không phụ thuộc Tailwind: style nội tuyến + biến màu của app (có giá trị dự phòng).
import type { FeedbackItem, FeedbackKind } from "@ai/contracts";
import {
  type CSSProperties,
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  defaultTransport,
  type FeedbackTransport,
  fetchMine,
  fileUrl,
  saveBlob,
  sendFeedback,
  toBase64,
} from "../feedback/api";
import { type FeedbackLabels, feedbackLabels } from "../feedback/labels";
import { canAdd, MAX_FILES, pageOf, statusColor } from "../feedback/rules";

export type FeedbackPanelProps = {
  /** Khoá app trong catalog: `chat` | `contracts` | `studio` | `admin`. */
  app: string;
  version?: string;
  /** `vi` | `en` (mặc định vi). */
  lang?: string;
  onClose?: () => void;
  /** Client HTTP của web (admin/studio có bản riêng); vắng ⇒ `http.ts` của web-kit. */
  transport?: FeedbackTransport;
};

const FG = "var(--foreground, var(--ink, #111))";
const MUTED = "var(--muted-foreground, var(--dim, #6b7280))";
const BORDER = "var(--border, var(--rule, #e5e5e5))";
const ACT = "var(--primary, var(--act, #2563eb))";
const FIELD: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: `1px solid ${BORDER}`,
  borderRadius: 8,
  padding: "8px 10px",
  font: "inherit",
  background: "var(--background, var(--card, #fff))",
  color: FG,
};
const BTN: CSSProperties = {
  border: 0,
  borderRadius: 8,
  padding: "8px 14px",
  font: "inherit",
  fontWeight: 600,
  cursor: "pointer",
  background: ACT,
  color: "var(--primary-foreground, #fff)",
};
const KINDS: FeedbackKind[] = ["bug", "idea", "other"];

function Attachment({
  tr,
  fb,
  f,
}: {
  tr: FeedbackTransport;
  fb: string;
  f: FeedbackItem["files"][number];
}): ReactElement {
  const blob = tr.blob;
  if (!blob) return <span style={{ fontSize: 13, color: MUTED }}>{f.name}</span>;
  const get = async () => saveBlob(await blob(fileUrl(fb, f.id)), f.name);
  return (
    <button
      type="button"
      onClick={() => void get()}
      style={{ ...BTN, background: "transparent", color: ACT, padding: "2px 6px" }}
    >
      {f.name}
    </button>
  );
}

function Mine({
  t,
  tr,
  items,
}: {
  t: FeedbackLabels;
  tr: FeedbackTransport;
  items: FeedbackItem[] | null;
}): ReactElement {
  if (!items) return <p style={{ color: MUTED }}>{t.loading}</p>;
  if (items.length === 0) return <p style={{ color: MUTED }}>{t.empty}</p>;
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
      {items.map((x) => (
        <li key={x.id} style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: 10 }}>
          <div style={{ display: "flex", gap: 8, fontSize: 12, color: MUTED }}>
            <span>{t[`kind_${x.kind}` as const]}</span>
            <span style={{ color: statusColor(x.status), fontWeight: 600 }}>
              {t[`status_${x.status}` as const]}
            </span>
            <span style={{ marginLeft: "auto" }}>{x.created_at.slice(0, 10)}</span>
          </div>
          <p style={{ margin: "6px 0", whiteSpace: "pre-wrap" }}>{x.message}</p>
          {x.files.map((f) => (
            <Attachment key={f.id} tr={tr} fb={x.id} f={f} />
          ))}
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 13,
              color: x.reply ? FG : MUTED,
              whiteSpace: "pre-wrap",
            }}
          >
            <strong>{t.reply}:</strong> {x.reply ?? t.noReply}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function FeedbackPanel(p: FeedbackPanelProps): ReactElement {
  const t = feedbackLabels(p.lang);
  const tr = useRef(p.transport ?? defaultTransport).current; // ổn định: tránh nạp lại vô hạn khi cha truyền object mới mỗi lần vẽ
  const [tab, setTab] = useState<"new" | "mine">("new");
  const [kind, setKind] = useState<FeedbackKind>("idea");
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [mine, setMine] = useState<FeedbackItem[] | null>(null);

  const reload = useCallback(() => {
    fetchMine(tr)
      .then((r) => setMine(r.items))
      .catch(() => setMine([]));
  }, [tr]);
  useEffect(() => {
    if (tab === "mine") reload();
  }, [tab, reload]);

  const add = (list: FileList | null) => {
    let next = files;
    for (const f of list ?? []) {
      if (!canAdd(next.length, f)) return setErr(t.errFile);
      next = [...next, f];
    }
    setErr(null);
    setFiles(next);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return setErr(t.errEmpty);
    setBusy(true);
    setErr(null);
    try {
      await sendFeedback(tr, {
        kind,
        message: message.trim(),
        app: p.app,
        page_url: pageOf(window.location),
        app_version: p.version ?? import.meta.env?.PUBLIC_APP_VERSION ?? "",
        files: await Promise.all(
          files.map(async (f) => ({
            name: f.name,
            mime: f.type as "image/png",
            data_base64: await toBase64(f),
          })),
        ),
      });
      setMessage("");
      setFiles([]);
      setSent(true);
    } catch {
      setErr(t.errSend);
    } finally {
      setBusy(false);
    }
  };

  const tabBtn = (id: "new" | "mine", label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      aria-pressed={tab === id}
      style={{
        ...BTN,
        background: tab === id ? ACT : "transparent",
        color: tab === id ? "var(--primary-foreground, #fff)" : FG,
        padding: "5px 12px",
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{ display: "flex", flexDirection: "column", height: "100%", color: FG, fontSize: 14 }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 16px",
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 15, flex: 1 }}>{t.title}</h2>
        {p.onClose && (
          <button
            type="button"
            onClick={p.onClose}
            aria-label={t.close}
            style={{ ...BTN, background: "transparent", color: MUTED }}
          >
            ✕
          </button>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, padding: "10px 16px 0" }}>
        {tabBtn("new", t.tabNew)}
        {tabBtn("mine", t.tabMine)}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {tab === "mine" ? (
          <Mine t={t} tr={tr} items={mine} />
        ) : sent ? (
          <div style={{ display: "grid", gap: 12 }}>
            <p role="status">{t.thanks}</p>
            <button
              type="button"
              style={{ ...BTN, justifySelf: "start" }}
              onClick={() => setSent(false)}
            >
              {t.sendMore}
            </button>
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
            <label>
              {t.kind}
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as FeedbackKind)}
                style={FIELD}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t[`kind_${k}` as const]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t.message}
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={6}
                maxLength={4000}
                placeholder={t.messagePh}
                style={FIELD}
              />
            </label>
            <div>
              <label style={{ color: ACT, cursor: "pointer", textDecoration: "underline" }}>
                {t.attach}
                <input
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain"
                  style={{ display: "none" }}
                  disabled={files.length >= MAX_FILES}
                  onChange={(e) => {
                    add(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
              {files.map((f) => (
                <div
                  key={`${f.name}-${f.size}-${f.lastModified}`}
                  style={{ fontSize: 13, color: MUTED }}
                >
                  {f.name}{" "}
                  <button
                    type="button"
                    aria-label={`${t.remove} ${f.name}`}
                    onClick={() => setFiles(files.filter((x) => x !== f))}
                    style={{ border: 0, background: "none", cursor: "pointer", color: MUTED }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <p style={{ margin: 0, fontSize: 12, color: MUTED }}>{t.context}</p>
            {err && (
              <p role="alert" style={{ margin: 0, color: "#b91c1c" }}>
                {err}
              </p>
            )}
            <button type="submit" disabled={busy} style={{ ...BTN, opacity: busy ? 0.6 : 1 }}>
              {busy ? t.sending : t.send}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
