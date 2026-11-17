// CR-181 · s14 · thân màn «Xem bản đã ký» (chỉ đọc): cột trang + PageStage + khung phải (sheet trên điện thoại).
import type {
  SignFieldOut,
  SignPart,
  SignSide,
  SignVersionItemOut,
  SignVersionsOut,
} from "@ai/contracts/pack-contracts";
import { Button } from "@ai/web-kit/ui/kit/button";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@ai/web-kit/ui/kit/sheet";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useIsMobile } from "~/shared/ui/use-is-mobile";
import { usePdfDoc } from "../hooks/use-pdf-doc";
import { loadPdfAt } from "../hooks/use-signed-view";
import type { StagePage } from "../lib/geometry";
import { contentPath, dotsOf, partRect, type RailDot, versionKey } from "../lib/viewer-model";
import { PageRail } from "./PageRail";
import { PageStage } from "./PageStage";
import type { SignFile } from "./types";
import { type ViewerJump, ViewerPanel } from "./ViewerPanel";

const FLASH_MS = 2000;
const noop = () => undefined;

function PartBoxes(p: { pages: StagePage[]; fields: SignFieldOut[]; flash: SignPart[] }) {
  const { t } = useTranslation();
  return (
    <>
      {p.fields.flatMap((f) =>
        f.parts.map((part) => {
          const pg = p.pages[part.page];
          if (!pg) return null;
          return (
            <div
              key={`${f.id}-${part.page}`}
              data-testid="viewer-pending-box"
              className="pointer-events-none absolute flex items-center justify-center border border-dashed border-muted-foreground bg-muted/60 p-1 text-center text-xs text-muted-foreground"
              style={partRect(part, pg)}
            >
              {t("contracts.docsign.waiting", { name: f.label })}
            </div>
          );
        }),
      )}
      {p.flash.map((part) => {
        const pg = p.pages[part.page];
        return pg ? (
          <div
            key={`flash-${part.page}`}
            data-testid="viewer-flash"
            className="pointer-events-none absolute animate-pulse border-4 border-warning"
            style={partRect(part, pg)}
          />
        ) : null;
      })}
    </>
  );
}

export function SignedViewer(p: {
  id: string;
  fileId: string;
  data: SignVersionsOut;
  v: SignVersionItemOut | undefined;
  sideByField: Record<string, SignSide>;
  atOf: (iso: string | null) => string;
  isLatest: boolean;
}) {
  const { t } = useTranslation();
  const mobile = useIsMobile();
  const v = p.v;
  const [cur, setCur] = useState(0);
  const [goTo, setGoTo] = useState<{ index: number; nonce: number } | null>(null);
  const [flash, setFlash] = useState<SignPart[]>([]);
  const [sheet, setSheet] = useState(false);
  const file: SignFile | undefined = useMemo(
    () =>
      v
        ? {
            id: `${p.fileId}:${versionKey(v)}`,
            name: p.data.name,
            pageCount: p.data.pages ?? 0,
            load: () => loadPdfAt(contentPath(v)),
          }
        : undefined,
    [p.fileId, p.data.name, p.data.pages, v],
  );
  const pdf = usePdfDoc(file);
  useEffect(() => {
    if (flash.length === 0) return;
    const h = window.setTimeout(() => setFlash([]), FLASH_MS);
    return () => window.clearTimeout(h);
  }, [flash]);
  const dots = useMemo(
    () => dotsOf(v, p.sideByField) as Record<number, RailDot[]>,
    [v, p.sideByField],
  );
  const pending = p.isLatest ? p.data.pending_fields : [];
  const jump = (j: ViewerJump) => {
    setGoTo({ index: j.page, nonce: Date.now() });
    setFlash(j.parts);
    setSheet(false);
  };
  const panel = (
    <ViewerPanel
      marks={v?.marks ?? []}
      kind={v?.kind === "internal" || v?.kind === "digital" ? v.kind : null}
      pending={pending}
      atOf={() => p.atOf(v?.signed_at ?? null)}
      onJump={jump}
    />
  );
  return (
    <div className="flex min-h-0 flex-1">
      {pdf.status === "ready" && (
        <PageRail
          doc={pdf.doc}
          pageCount={pdf.sizes.length}
          dots={dots}
          current={cur}
          onGo={(i) => setGoTo({ index: i, nonce: Date.now() })}
        />
      )}
      {pdf.status === "loading" && (
        <p className="m-auto text-sm text-muted-foreground">{t("contracts.docsign.loading")}</p>
      )}
      {pdf.status === "error" && (
        <p role="alert" className="m-auto text-sm text-destructive">
          {t("contracts.docsign.loadFail")}
        </p>
      )}
      {pdf.status === "ready" && (
        <PageStage
          key={file?.id}
          doc={pdf.doc}
          sizes={pdf.sizes}
          scrollTo={goTo}
          onCurrentPage={setCur}
          onBlank={noop}
          onDropTray={noop}
          onMenu={noop}
        >
          {(layout) => <PartBoxes pages={layout.pages} fields={pending} flash={flash} />}
        </PageStage>
      )}
      {mobile ? (
        <>
          <Button
            className="fixed right-3 bottom-3 z-30"
            data-testid="viewer-open-list"
            onClick={() => setSheet(true)}
          >
            {t("contracts.docsign.viewer.openList")}
          </Button>
          <Sheet open={sheet} onOpenChange={setSheet}>
            <SheetContent side="bottom" closeLabel={t("contracts.docsign.close")}>
              <SheetHeader>
                <SheetTitle>{t("contracts.docsign.viewer.panelTitle")}</SheetTitle>
              </SheetHeader>
              <SheetBody>{panel}</SheetBody>
            </SheetContent>
          </Sheet>
        </>
      ) : (
        <aside className="hidden w-72 shrink-0 overflow-y-auto border-l bg-card sm:block">
          {panel}
        </aside>
      )}
    </div>
  );
}
