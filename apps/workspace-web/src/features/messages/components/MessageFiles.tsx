// CR-132 · W3 · tệp trong tin: ảnh ⇒ ảnh thu nhỏ (tải qua Bearer ⇒ object URL, chỉ khi hiện), bấm mở ảnh đầy đủ ở tab mới; tệp khác ⇒ thẻ tên + cỡ, bấm để tải.
import type { FileRef } from "@ai/contracts/pack-contracts";
import { toast } from "@ai/web-kit/ui/toast";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconAttach } from "~/components/icons";
import { fetchFileLink } from "../api";
import { errorKey } from "../lib/errors";
import { isImageMime, sizeLabel } from "../lib/files";

/** Mở tệp: xin link ngắn hạn (Bearer) rồi mở ở tab đã mở sẵn (tránh chặn popup); ảnh xem tại chỗ, tệp khác tải về. */
async function openFile(conv: string, f: FileRef, t: (k: string) => string): Promise<void> {
  const tab = f.mime.startsWith("image/") ? window.open("", "_blank") : null;
  try {
    const url = await fetchFileLink(conv, f.id);
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else window.location.assign(url);
  } catch (e) {
    tab?.close();
    toast(t(errorKey(e)), "late");
  }
}

/** Ảnh thu nhỏ: chỉ xin link khi ô hiện ra (lazy), dùng `<img src>` trực tiếp (không object URL ⇒ không cần thu hồi). */
function Thumb({ conv, f }: { conv: string; f: FileRef }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ac = new AbortController();
    const load = () =>
      fetchFileLink(conv, f.id, ac.signal)
        .then(setUrl)
        .catch(() => !ac.signal.aborted && setFailed(true));
    if (typeof IntersectionObserver === "undefined") {
      void load();
      return () => ac.abort();
    }
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        io.disconnect();
        void load();
      }
    });
    io.observe(el);
    return () => {
      io.disconnect();
      ac.abort();
    };
  }, [conv, f.id]);
  if (failed) return <FileCard conv={conv} f={f} />;
  return (
    <button
      ref={box}
      type="button"
      onClick={() => void openFile(conv, f, t)}
      aria-label={t("contracts.messages.openImage", { name: f.name })}
      data-testid="msg-image"
      className="block h-32 w-40 overflow-hidden rounded-lg bg-sunk"
    >
      {url && (
        <img
          src={url}
          alt={f.name}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      )}
    </button>
  );
}

function FileCard({ conv, f }: { conv: string; f: FileRef }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={() => void openFile(conv, f, t)}
      aria-label={t("contracts.messages.download", { name: f.name })}
      data-testid="msg-file"
      className="flex max-w-full items-center gap-2 rounded-lg border border-rule bg-panel px-3 py-2 text-left text-ink hover:bg-sunk"
    >
      <IconAttach width={16} height={16} />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium">{f.name}</span>
        <span className="block text-micro text-dim">{sizeLabel(f.size)}</span>
      </span>
    </button>
  );
}

export function MessageFiles({ conv, files }: { conv: string; files: readonly FileRef[] }) {
  if (files.length === 0) return null;
  return (
    <div className="mt-1 flex flex-col items-start gap-1.5" data-testid="msg-files">
      {files.map((f) =>
        isImageMime(f.mime) ? (
          <Thumb key={f.id} conv={conv} f={f} />
        ) : (
          <FileCard key={f.id} conv={conv} f={f} />
        ),
      )}
    </div>
  );
}
