// CR-120 · phần dùng chung của 3 màn luồng Community: khung trang, tải danh sách MỘT yêu cầu (có lỗi + tải lại), hộp thoại nhập lý do.
import { Button } from "@ai/web-kit/ui/kit/button";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { useFlowEnv } from "../../application/flow-env";
import { t } from "../../i18n";

type Page<T> = { items: T[]; nextOffset: number | null };

/** CR-151 · tải danh sách dần: trang đầu + `loadMore()` nối trang kế theo `nextOffset` (một lời gọi mỗi trang). */
export function usePagedFlowList<T>(load: (offset: number) => Promise<Page<T>>) {
  const { rev } = useFlowEnv();
  const [items, setItems] = useState<T[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  // biome-ignore lint/correctness/useExhaustiveDependencies: nạp lại (về trang đầu) theo rev + tick
  useEffect(() => {
    let live = true;
    loadRef.current(0).then(
      (r) => {
        if (!live) return;
        setItems(r.items);
        setNext(r.nextOffset);
        setFailed(false);
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [rev, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  const loadMore = useCallback(async () => {
    if (next === null || busy) return;
    setBusy(true);
    try {
      const r = await loadRef.current(next);
      setItems((cur) => [...(cur ?? []), ...r.items]);
      setNext(r.nextOffset);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [next, busy]);
  return { items, failed, reload, more: next !== null, busy, loadMore };
}

/** Nút «Xem thêm» cuối danh sách tải dần (chỉ hiện khi còn trang sau). */
export function LoadMore({
  more,
  busy,
  onMore,
}: {
  more: boolean;
  busy: boolean;
  onMore: () => void;
}) {
  if (!more) return null;
  return (
    <div className="cbar">
      <div className="sp" />
      <Button variant="outline" disabled={busy} data-testid="flow-more" onClick={onMore}>
        {t("community.flows.common.more")}
      </Button>
      <div className="sp" />
    </div>
  );
}

export function FlowPage({
  title,
  intro,
  testId,
  bare = false,
  children,
}: {
  title: string;
  intro?: string;
  testId: string;
  /** CR-137b: tiêu đề trần (không thẻ) cho màn bảng toàn chiều ngang. */
  bare?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="ws">
      <main className="wsmain">
        <div className="wscenter" data-testid={testId}>
          {bare ? (
            // CR-147: tab/menu đã nói tên màn ⇒ không lặp tiêu đề; chỉ hiện đoạn dẫn nếu có.
            intro ? (
              <div className="adminlist-head">
                <p className="muted">{intro}</p>
              </div>
            ) : null
          ) : (
            <div className="card pcard">
              <h1>{title}</h1>
              {intro ? <p className="muted">{intro}</p> : null}
            </div>
          )}
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
        <Button variant="outline" onClick={reload}>
          {t("community.flows.common.retry")}
        </Button>
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
  const { brandAccent } = useFlowEnv();
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
    <Dialog open onOpenChange={(o) => !o && p.onClose()}>
      <DialogContent
        aria-label={p.title}
        aria-describedby={undefined}
        data-testid={p.testId}
        className="sm:max-w-[480px]"
      >
        <div data-mod="community" data-accent={brandAccent} className="flex min-h-0 flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{p.title}</DialogTitle>
          </DialogHeader>
          <DialogBody>
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
          </DialogBody>
          <DialogFooter className="flex-row justify-end">
            <Button variant="quiet" onClick={p.onClose}>
              {t("community.flows.common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={busy}
              data-testid="reason-submit"
              onClick={submit}
            >
              {p.submitLabel}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
