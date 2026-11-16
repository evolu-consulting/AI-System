// CR-178 · M3 · «Ảnh & tệp» của một cuộc: Sheet bên phải (điện thoại: toàn màn), tab «Ảnh» (lưới 3 cột chia theo tháng) và «Tệp» (danh sách + lọc tên),
// tải dần. Mỗi mục: «Xem trước» (ảnh, PDF) · «Tải về» · «Đến tin nhắn».
import type { MsgAttachKind, MsgAttachment } from "@ai/contracts/pack-contracts";
import { EmptyState } from "@ai/web-kit/ui/EmptyState";
import { Input } from "@ai/web-kit/ui/kit/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@ai/web-kit/ui/kit/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@ai/web-kit/ui/kit/tabs";
import { toast } from "@ai/web-kit/ui/toast";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchFileLink } from "../api";
import { useAttachments } from "../hooks/use-find";
import { errorKey } from "../lib/errors";
import { sizeLabel } from "../lib/files";
import { filterByName, groupByMonth, midTruncate, previewKind } from "../lib/find";
import { Skeleton } from "../ui";
import { FilePreview } from "./FilePreview";
import { LoadSentinel } from "./LoadSentinel";
import { saveFrom } from "./MessageFiles";

type Q = ReturnType<typeof useAttachments>;

function Thumb({ conv, it, onOpen }: { conv: string; it: MsgAttachment; onOpen: () => void }) {
  const { t } = useTranslation();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetchFileLink(conv, it.file.id)
      .then((u) => alive && setSrc(u))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [conv, it.file.id]);
  return (
    <button
      type="button"
      data-testid="attach-thumb"
      onClick={onOpen}
      aria-label={t("contracts.messages.openImage", { name: it.file.name })}
      className="aspect-square overflow-hidden rounded-md bg-sunk focus-visible:ring-2 focus-visible:ring-act"
    >
      {src && <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />}
    </button>
  );
}

/** Trạng thái chung của một danh sách tải dần: tải · lỗi (Thử lại) · trống · nội dung + «Xem thêm». */
function Paged({ q, empty, children }: { q: Q; empty: string; children: ReactNode }) {
  const { t } = useTranslation();
  if (q.isPending)
    return (
      <div className="space-y-3 p-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  if (q.isError)
    return (
      <EmptyState
        kind="error"
        title={t("contracts.messages.loadError")}
        action={
          <button type="button" className="btn btn-sm" onClick={() => void q.refetch()}>
            {t("contracts.messages.retry")}
          </button>
        }
      />
    );
  if (q.items.length === 0) return <EmptyState kind="empty" title={empty} />;
  return (
    <>
      {children}
      {q.hasNextPage && (
        <LoadSentinel loading={q.isFetchingNextPage} onMore={() => void q.fetchNextPage()} />
      )}
    </>
  );
}

function Images({ conv, q, onOpen }: { conv: string; q: Q; onOpen: (i: number) => void }) {
  const { t } = useTranslation();
  const groups = useMemo(() => groupByMonth(q.items), [q.items]);
  const at = useMemo(() => new Map(q.items.map((a, i) => [`${a.file.id}:${a.seq}`, i])), [q.items]);
  return (
    <Paged q={q} empty={t("contracts.messages.find.noImages")}>
      {groups.map((g) => {
        const [y, m] = g.month.split("-");
        return (
          <section key={g.month} className="mb-3" data-testid="attach-month">
            <h3 className="m-0 mb-1.5 text-micro font-semibold text-dim">
              {t("contracts.messages.find.month", { m: Number(m), y })}
            </h3>
            <div className="grid grid-cols-3 gap-1">
              {g.items.map((a) => (
                <Thumb
                  key={`${a.file.id}:${a.seq}`}
                  conv={conv}
                  it={a}
                  onOpen={() => onOpen(at.get(`${a.file.id}:${a.seq}`) ?? 0)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </Paged>
  );
}

function FileRow({
  conv,
  it,
  onPreview,
  onGoto,
}: {
  conv: string;
  it: MsgAttachment;
  onPreview: () => void;
  onGoto: () => void;
}) {
  const { t } = useTranslation();
  const download = () =>
    fetchFileLink(conv, it.file.id)
      .then((u) => saveFrom(u, it.file.name))
      .catch((e: unknown) => toast(t(errorKey(e)), "late"));
  return (
    <li data-testid="attach-file" className="flex flex-col gap-1 border-b border-rule-soft py-2.5">
      <span className="truncate text-[13.5px] font-semibold" title={it.file.name}>
        {midTruncate(it.file.name)}
      </span>
      <span className="truncate text-micro text-dim">
        {sizeLabel(it.file.size)} · {it.sender_name} · {new Date(it.at).toLocaleDateString()}
      </span>
      <span className="flex flex-wrap gap-2">
        {previewKind(it.file.mime) !== "none" && (
          <button
            type="button"
            className="btn btn-sm"
            data-testid="attach-preview"
            onClick={onPreview}
          >
            {t("contracts.messages.attachUi.view")}
          </button>
        )}
        <button
          type="button"
          className="btn btn-sm"
          data-testid="attach-download"
          onClick={() => void download()}
        >
          {t("contracts.messages.attachUi.download")}
        </button>
        <button type="button" className="btn btn-sm" data-testid="attach-goto" onClick={onGoto}>
          {t("contracts.messages.find.goto")}
        </button>
      </span>
    </li>
  );
}

function Files({
  conv,
  q,
  onOpen,
  onGoto,
}: {
  conv: string;
  q: Q;
  onOpen: (list: MsgAttachment[], i: number) => void;
  onGoto: (seq: number) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const shown = useMemo(() => filterByName(q.items, name), [q.items, name]);
  return (
    <>
      <Input
        type="search"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("contracts.messages.find.filterFiles")}
        aria-label={t("contracts.messages.find.filterFiles")}
        data-testid="attach-filter"
        className="mb-2"
      />
      <Paged q={q} empty={t("contracts.messages.find.noFiles")}>
        {shown.length === 0 ? (
          <EmptyState kind="search" title={t("contracts.messages.find.none", { q: name.trim() })} />
        ) : (
          <ul className="m-0 list-none p-0" data-testid="attach-files">
            {shown.map((a, i) => (
              <FileRow
                key={`${a.file.id}:${a.seq}`}
                conv={conv}
                it={a}
                onPreview={() => onOpen(shown, i)}
                onGoto={() => onGoto(a.seq)}
              />
            ))}
          </ul>
        )}
      </Paged>
    </>
  );
}

export function AttachSheet({
  conv,
  open,
  onClose,
  onGoto,
}: {
  conv: string;
  open: boolean;
  onClose: () => void;
  onGoto: (seq: number) => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<MsgAttachKind>("image");
  const images = useAttachments(conv, "image", open);
  const files = useAttachments(conv, "file", open && tab === "file");
  const [view, setView] = useState<{ list: MsgAttachment[]; index: number } | null>(null);
  const goto = (seq: number) => {
    setView(null);
    onClose();
    onGoto(seq);
  };
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        closeLabel={t("contracts.messages.attachUi.close")}
        data-testid="attach-sheet"
        aria-describedby={undefined}
        className="w-full max-w-none sm:w-[420px] sm:max-w-[420px]"
      >
        <SheetHeader>
          <SheetTitle>{t("contracts.messages.find.attachTitle")}</SheetTitle>
        </SheetHeader>
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as MsgAttachKind)}
          className="min-h-0 flex-1"
        >
          <TabsList className="w-full">
            <TabsTrigger value="image" className="flex-1" data-testid="attach-tab-image">
              {t("contracts.messages.find.tabImages")}
            </TabsTrigger>
            <TabsTrigger value="file" className="flex-1" data-testid="attach-tab-file">
              {t("contracts.messages.find.tabFiles")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="image" className="min-h-0 flex-1 overflow-y-auto">
            <Images
              conv={conv}
              q={images}
              onOpen={(i) => setView({ list: images.items, index: i })}
            />
          </TabsContent>
          <TabsContent value="file" className="min-h-0 flex-1 overflow-y-auto">
            <Files
              conv={conv}
              q={files}
              onOpen={(list, i) => setView({ list, index: i })}
              onGoto={goto}
            />
          </TabsContent>
        </Tabs>
        {view && (
          <FilePreview
            conv={conv}
            items={view.list}
            index={view.index}
            onIndex={(i) => setView({ list: view.list, index: i })}
            onGoto={goto}
            onClose={() => setView(null)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
