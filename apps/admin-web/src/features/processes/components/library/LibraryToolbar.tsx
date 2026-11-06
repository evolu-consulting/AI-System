// CR-105 · thanh trên của editor quy trình thư viện (UX): trạng thái (Nháp / vN), "Xuất bản" là nút chính, "Gán cho tenant",
// "Xem trước đường đi"; Lịch sử · Nhân bản · Đặt mặc định là nút phụ. "Lưu nháp" nằm ở thanh lưu bên dưới — tách khỏi "Xuất bản".
import { Link } from "@tanstack/react-router";
import { Copy, History, Route, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { isDlcSlotKey } from "../../lib/dlc-slot";
import { statusOf } from "../../lib/library-list";
import { canSetDefault, publishState } from "../../lib/library-view";
import { nextVersion } from "../../lib/step-limit";
import type { LibraryDef } from "../../library-api";

export type EditorMode = "canvas" | "form";
export type LibraryAction = "publish" | "releases" | "preview" | "default" | "clone";
type Props = {
  def: LibraryDef;
  mode: EditorMode;
  dirty: boolean;
  busy: boolean;
  onMode: (m: EditorMode) => void;
  onAction: (a: LibraryAction) => void;
};

/** dlc-engine · khe DLC chỉ có Canvas (Form chỉ hiểu bước duyệt của khe hợp đồng). */
const modesOf = (slot: string | null | undefined): readonly EditorMode[] =>
  isDlcSlotKey(slot) ? ["canvas"] : ["canvas", "form"];

/** "X công ty đang dùng vN" (đã xuất bản) · "X công ty đang dùng" (nháp). */
function usedByText(
  def: LibraryDef,
  L: (k: string, o?: Record<string, string | number>) => string,
) {
  const n = def.tenant_count ?? 0;
  return def.published_version == null
    ? L("assignedCount", { n })
    : L("usedByVersion", { n, v: def.published_version });
}

export function LibraryToolbar({ def, mode, dirty, busy, onMode, onAction }: Props) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, string | number>) => t(`process.admin.library.${k}`, o);
  const state = publishState(def);
  const status = statusOf(def);
  const ic = "size-4";
  const secondary = (a: LibraryAction, label: string, icon: React.ReactNode, off = false) => (
    <Button type="button" size="sm" variant="ghost" disabled={off} onClick={() => onAction(a)}>
      {icon}
      {label}
    </Button>
  );
  return (
    <div
      className="sticky top-0 z-20 -mx-4 space-y-2 border-b border-border bg-background/95 px-4 py-3 backdrop-blur"
      data-testid="library-toolbar"
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge
          tone={status.kind === "draft" ? "off" : status.kind === "changed" ? "warn" : "ok"}
        >
          {status.kind === "draft"
            ? L("pubState.draft")
            : status.kind === "changed"
              ? L("status.changed", { n: status.version })
              : L("pubState.published", { n: status.version })}
        </StatusBadge>
        {def.is_default ? (
          <StatusBadge tone="ok">{L("defaultBadge", { slot: def.slot_label ?? "" })}</StatusBadge>
        ) : null}
        <span className="text-caption text-muted-foreground">
          {L("usedFor", { slot: def.slot_label ?? def.slot ?? "" })} · {usedByText(def, L)}
        </span>
        {/* Một chỗ gán duy nhất: Công ty › Quy trình (Luật gốc 2) — thư viện không gán trực tiếp */}
        <span className="text-caption text-muted-foreground" data-testid="assign-where">
          {L("assign.where")}{" "}
          <Link to="/tenants" className="text-primary underline-offset-4 hover:underline">
            {L("assign.openCompanies")}
          </Link>
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            type="button"
            disabled={dirty || busy}
            title={dirty ? L("publish.saveFirst") : undefined}
            onClick={() => onAction("publish")}
          >
            <Upload aria-hidden className={ic} />
            {L("publish.buttonNext", { v: nextVersion(def.published_version) })}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={dirty}
            onClick={() => onAction("preview")}
          >
            <Route aria-hidden className={ic} />
            {L("preview.button")}
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <fieldset className="inline-flex min-w-0 rounded-md border border-border p-0.5">
          <legend className="sr-only">{L("mode.label")}</legend>
          {modesOf(def.slot).map((m) => (
            <Button
              key={m}
              type="button"
              size="sm"
              variant={mode === m ? "default" : "ghost"}
              aria-pressed={mode === m}
              disabled={mode !== m && dirty}
              title={mode !== m && dirty ? L("mode.saveFirst") : undefined}
              onClick={() => onMode(m)}
            >
              {L(`mode.${m}`)}
            </Button>
          ))}
        </fieldset>
        {status.kind === "published" ? null : (
          <span className="text-caption text-muted-foreground">{L("saveHint")}</span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {secondary(
            "releases",
            L("releases.button"),
            <History aria-hidden className={ic} />,
            state !== "published",
          )}
          {secondary("clone", L("clone.button"), <Copy aria-hidden className={ic} />, busy)}
          {canSetDefault(def) ? secondary("default", L("default.button"), null) : null}
        </div>
      </div>
    </div>
  );
}
