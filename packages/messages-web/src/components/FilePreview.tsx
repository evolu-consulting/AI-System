// CR-178 · M3 · «Xem trước tệp»: hộp lớn nền tối. Ảnh (png/jpg/gif/webp) và PDF xem trong trang; Word/Excel/ZIP… chỉ «Tải về».
// AN TOÀN: tải byte về bằng link ngắn hạn, gắn đúng `mime` đã lưu, xem qua `blob:` (ảnh `<img>`, PDF `<iframe sandbox>`), thu hồi khi đổi tệp/đóng; svg/html không bao giờ render.
import type { MsgAttachment } from "@ai/contracts/pack-contracts";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@ai/web-kit/ui/kit/dialog";
import { toast } from "@ai/web-kit/ui/toast";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchFileBlob, fetchFileLink } from "../api";
import { IconChevronLeft, IconChevronRight, IconClose } from "../icons";
import { errorKey } from "../lib/errors";
import { sizeLabel } from "../lib/files";
import { previewKind, stepIndex } from "../lib/find";
import { saveFrom } from "./MessageFiles";

type Blobbed = { url: string | null; failed: boolean };

/** Blob URL của tệp (chỉ khi xem trước được); đổi tệp/đóng ⇒ thu hồi. */
function useBlobUrl(conv: string, it: MsgAttachment | undefined): Blobbed {
  const [st, setSt] = useState<Blobbed>({ url: null, failed: false });
  const fileId = it?.file.id;
  const mime = it?.file.mime ?? "";
  useEffect(() => {
    setSt({ url: null, failed: false });
    if (!fileId || previewKind(mime) === "none") return;
    const ac = new AbortController();
    let made: string | null = null;
    fetchFileBlob(conv, fileId, mime, ac.signal)
      .then((b) => {
        if (ac.signal.aborted) return;
        made = URL.createObjectURL(b);
        setSt({ url: made, failed: false });
      })
      .catch(() => !ac.signal.aborted && setSt({ url: null, failed: true }));
    return () => {
      ac.abort();
      if (made) URL.revokeObjectURL(made);
    };
  }, [conv, fileId, mime]);
  return st;
}

const navBtn =
  "grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-30";
const barBtn = "btn btn-sm border-white/30 bg-transparent text-white hover:bg-white/10";

function Stage({ it, blob }: { it: MsgAttachment; blob: Blobbed }) {
  const { t } = useTranslation();
  const kind = previewKind(it.file.mime);
  if (kind === "none")
    return <p className="m-0 text-sm text-white/80">{t("contracts.messages.find.noPreview")}</p>;
  if (blob.failed)
    return <p className="m-0 text-sm text-white/80">{t("contracts.messages.attachUi.failed")}</p>;
  if (!blob.url)
    return <p className="m-0 text-sm text-white/60">{t("contracts.messages.loadingMore")}</p>;
  return kind === "image" ? (
    <img
      src={blob.url}
      alt={it.file.name}
      data-testid="preview-image"
      className="max-h-full max-w-full object-contain"
    />
  ) : (
    <iframe
      src={blob.url}
      title={it.file.name}
      sandbox=""
      data-testid="preview-pdf"
      className="h-full w-full rounded bg-white"
    />
  );
}

export function FilePreview({
  conv,
  items,
  index,
  onIndex,
  onGoto,
  onClose,
}: {
  conv: string;
  items: readonly MsgAttachment[];
  index: number;
  onIndex: (i: number) => void;
  onGoto: (seq: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const it = items[index];
  const blob = useBlobUrl(conv, it);
  const prev = stepIndex(index, items.length, -1);
  const next = stepIndex(index, items.length, 1);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && prev !== null) onIndex(prev);
      else if (e.key === "ArrowRight" && next !== null) onIndex(next);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [prev, next, onIndex]);
  if (!it) return null;
  const download = () =>
    fetchFileLink(conv, it.file.id)
      .then((url) => saveFrom(url, it.file.name))
      .catch((e: unknown) => toast(t(errorKey(e)), "late"));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        closeLabel={t("contracts.messages.attachUi.close")}
        aria-describedby={undefined}
        data-testid="file-preview"
        className="top-0 left-0 h-full max-h-none w-full max-w-none translate-x-0 translate-y-0 gap-3 rounded-none border-0 bg-black/90 p-3 text-white sm:max-w-none sm:p-5"
      >
        <header className="flex shrink-0 items-center gap-2">
          <div className="min-w-0 flex-1">
            <DialogTitle className="m-0 truncate text-[14px] font-semibold">
              {it.file.name}
            </DialogTitle>
            <p className="m-0 truncate text-micro text-white/70">
              {sizeLabel(it.file.size)} · {it.sender_name} · {new Date(it.at).toLocaleDateString()}
            </p>
          </div>
          <button
            type="button"
            className={barBtn}
            data-testid="preview-goto"
            onClick={() => onGoto(it.seq)}
          >
            {t("contracts.messages.find.goto")}
          </button>
          <button
            type="button"
            className={barBtn}
            data-testid="preview-download"
            onClick={() => void download()}
          >
            {t("contracts.messages.attachUi.download")}
          </button>
          <DialogClose
            aria-label={t("contracts.messages.attachUi.close")}
            title={t("contracts.messages.attachUi.close")}
            data-testid="preview-close"
            className={navBtn}
          >
            <IconClose width={18} height={18} />
          </DialogClose>
        </header>
        <div className="flex min-h-0 flex-1 items-center gap-2">
          <button
            type="button"
            disabled={prev === null}
            onClick={() => prev !== null && onIndex(prev)}
            aria-label={t("contracts.messages.find.prevFile")}
            title={t("contracts.messages.find.prevFile")}
            data-testid="preview-prev"
            className={navBtn}
          >
            <IconChevronLeft width={20} height={20} />
          </button>
          <div className="grid h-full min-w-0 flex-1 place-items-center overflow-hidden">
            <Stage it={it} blob={blob} />
          </div>
          <button
            type="button"
            disabled={next === null}
            onClick={() => next !== null && onIndex(next)}
            aria-label={t("contracts.messages.find.nextFile")}
            title={t("contracts.messages.find.nextFile")}
            data-testid="preview-next"
            className={navBtn}
          >
            <IconChevronRight width={20} height={20} />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
