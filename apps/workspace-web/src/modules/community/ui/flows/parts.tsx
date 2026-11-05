// CR-120 · phần dùng chung của 3 màn luồng Community: khung trang, tải danh sách MỘT yêu cầu (có lỗi + tải lại), hộp thoại nhập lý do.
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../../application/ctx";
import { t } from "../../i18n";
import { IconX } from "../icons";

/** Tải danh sách bằng MỘT lời gọi; đổi dữ liệu chung (`rev`) hoặc `reload()` ⇒ nạp lại. Lỗi giữ lại để hiện cách khắc phục. */
export function useFlowList<T>(load: () => Promise<T[]>) {
  const { rev } = useApp();
  const [items, setItems] = useState<T[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  // biome-ignore lint/correctness/useExhaustiveDependencies: nạp lại theo rev + tick
  useEffect(() => {
    let live = true;
    loadRef.current().then(
      (r) => {
        if (!live) return;
        setItems(r);
        setFailed(false);
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [rev, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { items, failed, reload };
}

export function FlowPage({
  title,
  intro,
  testId,
  children,
}: {
  title: string;
  intro: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <div className="ws">
      <main className="wsmain">
        <div className="wscenter" data-testid={testId}>
          <div className="card pcard">
            <h1>{title}</h1>
            <p className="muted">{intro}</p>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

/** Trạng thái chung của danh sách: đang tải / lỗi (nói cách khắc phục) / trống (nói vì sao + bước kế). */
export function ListState({
  items,
  failed,
  reload,
  emptyKey,
}: {
  items: unknown[] | null;
  failed: boolean;
  reload: () => void;
  emptyKey: string;
}) {
  if (failed)
    return (
      <div className="card empty" role="alert">
        <p>{t("community.flows.common.loadError")}</p>
        <button type="button" className="outline" onClick={reload}>
          {t("community.flows.common.retry")}
        </button>
      </div>
    );
  if (!items) return <div className="card empty" aria-busy="true" />;
  if (items.length === 0) return <div className="card empty">{t(emptyKey)}</div>;
  return null;
}

type DialogProps = {
  title: string;
  intro: string;
  label: string;
  required: boolean;
  submitLabel: string;
  onSubmit: (text: string) => Promise<void>;
  onClose: () => void;
  testId: string;
};

/** Hộp thoại nhập lý do (từ chối bài / từ chối yêu cầu / báo cáo bài). Lỗi hiện ngay trong hộp thoại kèm cách sửa. */
export function ReasonDialog(p: DialogProps) {
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const { onClose } = p;
  useEffect(() => {
    box.current?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  const submit = async () => {
    if (p.required && text.trim() === "") return setErr(t("community.flows.common.reasonNeeded"));
    setBusy(true);
    try {
      await p.onSubmit(text.trim());
    } catch {
      setErr(t("community.flows.common.submitError"));
      setBusy(false);
    }
  };
  return (
    <div className="dlg-scrim">
      <button
        type="button"
        className="dlg-bg"
        tabIndex={-1}
        aria-label={t("community.flows.common.cancel")}
        onClick={onClose}
      />
      <div
        ref={box}
        className="dlg"
        style={{ width: "min(480px, 100%)" }}
        role="dialog"
        aria-modal="true"
        aria-label={p.title}
        tabIndex={-1}
        data-testid={p.testId}
      >
        <header className="dlg-head">
          <h2>{p.title}</h2>
          <button
            type="button"
            className="iconbtn"
            aria-label={t("community.flows.common.cancel")}
            onClick={onClose}
          >
            <IconX size={18} />
          </button>
        </header>
        <div className="dlg-body" style={{ padding: 20 }}>
          <p className="muted">{p.intro}</p>
          <label>
            <b>{p.label}</b>
            <textarea
              className="field"
              rows={4}
              value={text}
              maxLength={1000}
              data-testid="reason-input"
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          {err && (
            <p className="muted" role="alert" data-testid="reason-error">
              {err}
            </p>
          )}
          <div className="cbar">
            <div className="sp" />
            <button type="button" className="ghost" onClick={onClose}>
              {t("community.flows.common.cancel")}
            </button>
            <button
              type="button"
              className="primary sm"
              disabled={busy}
              data-testid="reason-submit"
              onClick={submit}
            >
              {p.submitLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
