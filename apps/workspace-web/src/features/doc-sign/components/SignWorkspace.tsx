// CR-181 · s11b · màn ký TOÀN MÀN HÌNH (đợt 1: chỉ «Từng trang»). Chưa gọi API: dữ liệu vào bằng props, sự kiện ra bằng callback.
import { SIGN_FIELD_ASPECT } from "@ai/contracts/pack-contracts";
import { Button } from "@ai/web-kit/ui/kit/button";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePdfDoc } from "../hooks/use-pdf-doc";
import { useSignItems } from "../hooks/use-sign-items";
import { clampToStage } from "../lib/actions";
import { isPartsError, partsOf } from "../lib/geometry";
import { closeAction } from "../lib/keys";
import { pageAt } from "../lib/layout";
import type { NewItem, SignItem } from "../lib/sign-items";
import type { Seam } from "../lib/snap";
import { FileTabs } from "./FileTabs";
import { LeaveDialog } from "./LeaveDialog";
import { PageRail } from "./PageRail";
import { PageStage, type StageLayout } from "./PageStage";
import { SignTopBar } from "./SignTopBar";
import { StageItems } from "./StageItems";
import type { SignTray, SignWorkspaceProps } from "./types";

const DEFAULT_W_RATIO = 0.22;

export function SignWorkspace(p: SignWorkspaceProps) {
  const { t } = useTranslation();
  const [fileId, setFileId] = useState(p.files[0]?.id ?? "");
  useEffect(() => {
    if (!p.files.some((f) => f.id === fileId)) setFileId(p.files[0]?.id ?? "");
  }, [p.files, fileId]);
  const file = p.files.find((f) => f.id === fileId);
  const pdf = usePdfDoc(file);
  const store = useSignItems(p.items, p.onChange);
  const [sel, setSel] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [seam, setSeam] = useState<Seam | null>(null);
  const [leave, setLeave] = useState(false);
  const [cur, setCur] = useState(0);
  const [goTo, setGoTo] = useState<{ index: number; nonce: number } | null>(null);
  const layoutRef = useRef<StageLayout>({ pages: [], width: 0, height: 0 });
  const [warn, setWarn] = useState(false);
  const [auto, setAuto] = useState<number | null>(null);
  const runAuto = async () => {
    if (pdf.status !== "ready" || !p.autoPlace) return;
    const found = await p.autoPlace(pdf.doc, pdf.sizes);
    if (found.length) store.append(fileId, found);
    setAuto(found.length);
  };
  const items = store.byFile[fileId] ?? [];

  const close = () => (closeAction(p.dirty) === "confirm" ? setLeave(true) : p.onClose());
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSel(null);
      setMenu(null);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const place = useCallback(
    (tray: SignTray, cx: number, cy: number) => {
      const lay = layoutRef.current;
      const pg = pageAt(lay.pages, cy);
      if (!pg) return;
      const aspect = tray.type === "mark" ? tray.aspect : SIGN_FIELD_ASPECT;
      const w = pg.width * DEFAULT_W_RATIO;
      const h = w / aspect;
      const rect = clampToStage({ l: cx - w / 2, t: cy - h / 2, w, h }, lay);
      const spec: NewItem =
        tray.type === "mark"
          ? { kind: "mark", aspect, imageUrl: tray.imageUrl, status: "editable" }
          : { kind: "field", aspect, side: tray.side, person: tray.person, status: "editable" };
      setWarn(isPartsError(partsOf(rect, lay.pages)));
      store.add(fileId, spec, rect, lay.pages);
      setMenu(null);
    },
    [fileId, store],
  );

  const counts = useMemo(
    () => Object.fromEntries(Object.entries(store.byFile).map(([k, v]) => [k, v.length])),
    [store.byFile],
  );
  const dots = useMemo(() => {
    const d: Record<number, ("A" | "B" | "mark")[]> = {};
    for (const i of items) {
      const pg = i.parts[0]?.page;
      if (pg !== undefined) d[pg] = [...(d[pg] ?? []), i.side ?? "mark"];
    }
    return d;
  }, [items]);
  const mineTray = p.trays.find((x) => x.type === "mark");
  const fieldTrays = p.trays.filter((x) => x.type === "field");
  const changePerson = (it: SignItem) => {
    if (fieldTrays.length === 0) return;
    const i = fieldTrays.findIndex((x) => x.type === "field" && x.person === it.person);
    const n = fieldTrays[(i + 1) % fieldTrays.length];
    if (n?.type === "field") store.changeSide(fileId, it.id, n.side, n.person);
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background" data-testid="sign-workspace">
      <SignTopBar
        trays={p.trays}
        kinds={p.signatureKinds}
        kind={p.kind}
        onKind={p.onKindChange}
        saveLabel={p.saveLabel}
        onSave={() => p.onSave(fileId)}
        onClose={close}
      />
      <FileTabs
        files={p.files}
        active={fileId}
        counts={counts}
        onSelect={(id) => {
          setFileId(id);
          setAuto(null);
          setSel(null);
          setCur(0);
        }}
      />
      {p.mode === "prep" && p.autoPlace && (
        <div className="flex items-center gap-3 border-b px-3 py-1">
          <Button size="sm" variant="outline" disabled={pdf.status !== "ready"} onClick={runAuto}>
            {t("contracts.docsign.autoPlace")}
          </Button>
          {auto !== null && (
            <p role="status" className="text-sm text-muted-foreground">
              {auto > 0
                ? t("contracts.docsign.autoDone", { count: auto })
                : t("contracts.docsign.autoNone")}
            </p>
          )}
        </div>
      )}
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
            key={fileId}
            doc={pdf.doc}
            sizes={pdf.sizes}
            scrollTo={goTo}
            onCurrentPage={setCur}
            onBlank={() => {
              setSel(null);
              setMenu(null);
            }}
            onDropTray={(id, x, y) => {
              const tr = p.trays.find((z) => z.id === id);
              if (tr) place(tr, x, y);
            }}
            onMenu={(x, y) => setMenu({ x, y })}
          >
            {(layout) => {
              layoutRef.current = layout;
              return (
                <StageItems
                  layout={layout}
                  items={items}
                  mode={p.mode}
                  sel={sel}
                  seam={seam}
                  menu={menu}
                  menuTrays={p.mode === "sign" ? (mineTray ? [mineTray] : []) : fieldTrays}
                  onSel={setSel}
                  onSeam={setSeam}
                  onMove={(id, r) => store.move(fileId, id, r, layout.pages)}
                  onRemove={(id) => {
                    store.remove(fileId, id);
                    setSel(null);
                  }}
                  onCopyAll={(id) => store.copyToAll(fileId, id, layout.pages)}
                  onChangePerson={changePerson}
                  onFieldClick={(id) => {
                    if (p.signImageUrl) store.fill(fileId, id, p.signImageUrl);
                    p.onFieldClick?.(fileId, id);
                  }}
                  onPick={(tr) => menu && place(tr, menu.x, menu.y)}
                  onCloseMenu={() => setMenu(null)}
                />
              );
            }}
          </PageStage>
        )}
      </div>
      {warn && <p role="alert">{t("contracts.docsign.tooManyPages")}</p>}
      <LeaveDialog open={leave} onStay={() => setLeave(false)} onLeave={p.onClose} />
    </div>
  );
}
