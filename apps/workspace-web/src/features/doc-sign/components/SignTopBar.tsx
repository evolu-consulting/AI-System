// CR-181 · thanh trên: Đóng · «Ký bằng» (ToggleGroup, chữ ký số khoá kèm lý do — Q12) · khay kéo · nút Lưu.
import type { SignatureKind } from "@ai/contracts/pack-contracts";
import { Button } from "@ai/web-kit/ui/kit/button";
import { ICONS } from "@ai/web-kit/ui/kit/icons";
import { ToggleGroup, ToggleGroupItem } from "@ai/web-kit/ui/kit/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ai/web-kit/ui/kit/tooltip";
import { useTranslation } from "react-i18next";
import type { StageView } from "../lib/fan";
import type { SignKindOption, SignTray } from "./types";
import { ViewBar } from "./ViewBar";

export function TrayChip({ tray }: { tray: SignTray }) {
  const { t } = useTranslation();
  const tone =
    tray.type === "mark"
      ? "border-primary"
      : tray.side === "B"
        ? "border-orange-500 bg-orange-500/10"
        : "border-violet-500 bg-violet-500/10";
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: nguồn kéo thả; thay thế bằng menu chuột phải/chạm giữ
    <div
      draggable
      data-testid="sign-tray"
      onDragStart={(e) => e.dataTransfer.setData("text/plain", tray.id)}
      className={`flex h-[var(--control-md)] cursor-grab max-w-full shrink-0 items-center gap-2 rounded-md border-2 bg-background px-2 text-sm max-sm:min-h-11 ${tone}`}
    >
      {tray.type === "mark" ? (
        <>
          <img
            src={tray.imageUrl}
            alt=""
            draggable={false}
            className="h-6 max-w-24 shrink-0 rounded-sm bg-white object-contain"
          />
          <span className="whitespace-nowrap max-sm:sr-only">
            {t("contracts.docsign.tray.mine")}
          </span>
          <span aria-hidden="true" className="whitespace-nowrap sm:hidden">
            {t("contracts.docsign.tray.mineShort")}
          </span>
        </>
      ) : (
        <span className="max-w-40 truncate max-sm:max-w-28">
          {t("contracts.docsign.tray.field", { name: tray.person })}
        </span>
      )}
    </div>
  );
}

export function SignTopBar(p: {
  trays: SignTray[];
  kinds: SignKindOption[];
  kind: SignatureKind;
  onKind: (k: SignatureKind) => void;
  saveLabel: string;
  /** Nhãn gọn cho điện thoại (≤ 640px), vd «Lưu · còn 1»; tên truy cập vẫn là `saveLabel`. */
  saveShort?: string;
  onSave: () => void;
  /** Không có gì để lưu ⇒ khoá nút, không gửi request. */
  saveDisabled?: boolean;
  onClose: () => void;
  /** CR-182 · kiểu xem khi ký; không truyền ⇒ không hiện (chế độ chuẩn bị). */
  view?: { value: StageView; pageCount: number; onChange: (v: StageView) => void };
  /** CR-184 · người vắng mà mình ký thay. */
  behalf?: readonly string[] | undefined;
}) {
  const { t } = useTranslation();
  const Close = ICONS.close;
  const Locked = ICONS.locked;
  return (
    <header className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
      <Button
        size="icon"
        variant="quiet"
        aria-label={t("contracts.docsign.close")}
        onClick={p.onClose}
      >
        <Close className="size-4" />
      </Button>
      {p.kinds.length > 1 && (
        <>
          <span className="text-sm text-muted-foreground">{t("contracts.docsign.kindLabel")}</span>
          <ToggleGroup
            type="single"
            value={p.kind}
            onValueChange={(v) => {
              const o = p.kinds.find((k) => k.kind === v);
              if (o && !o.disabledReason) p.onKind(o.kind);
            }}
          >
            {p.kinds.map((o) => {
              const item = (
                <ToggleGroupItem
                  key={o.kind}
                  value={o.kind}
                  aria-disabled={o.disabledReason ? "true" : undefined}
                  className={o.disabledReason ? "opacity-50" : undefined}
                >
                  {o.disabledReason && <Locked className="mr-1 size-3" />}
                  {t(`contracts.docsign.kind.${o.kind}`)}
                  {o.disabledReason && <span className="sr-only">{o.disabledReason}</span>}
                </ToggleGroupItem>
              );
              return o.disabledReason ? (
                <Tooltip key={o.kind}>
                  <TooltipTrigger asChild>{item}</TooltipTrigger>
                  <TooltipContent>{o.disabledReason}</TooltipContent>
                </Tooltip>
              ) : (
                item
              );
            })}
          </ToggleGroup>
        </>
      )}
      {p.view && (
        <ViewBar view={p.view.value} pageCount={p.view.pageCount} onChange={p.view.onChange} />
      )}
      {p.behalf && p.behalf.length > 0 && (
        <p
          role="status"
          data-testid="sign-behalf"
          className="m-0 basis-full rounded-md bg-sunk px-3 py-1.5 text-sm font-semibold"
        >
          {t("contracts.docsign.behalfBar", { name: p.behalf.join(", ") })}
        </p>
      )}
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {p.trays.map((tr) => (
          <TrayChip key={tr.id} tray={tr} />
        ))}
      </div>
      <Button
        disabled={p.saveDisabled}
        onClick={p.onSave}
        aria-label={p.saveShort ? p.saveLabel : undefined}
        className="max-sm:px-3"
      >
        {p.saveShort ? (
          <>
            <span className="max-sm:hidden">{p.saveLabel}</span>
            <span aria-hidden="true" className="sm:hidden">
              {p.saveShort}
            </span>
          </>
        ) : (
          p.saveLabel
        )}
      </Button>
    </header>
  );
}
