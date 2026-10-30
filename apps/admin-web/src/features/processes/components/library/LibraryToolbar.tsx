// CR-105 · L3: thanh công cụ editor quy trình thư viện — nhãn khe/mặc định/bản xuất bản, Canvas|Form, Xuất bản · Lịch sử · Nhân bản ·
// Gán cho tenant · Xem trước đường đi · Đặt làm mặc định. Chỉ platform_admin thấy (Hub 404/403 với người khác).
import { Copy, History, Route, Upload, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { canAssign, canSetDefault, publishState } from "../../lib/library-view";
import type { LibraryDef } from "../../library-api";

export type EditorMode = "canvas" | "form";
export type LibraryAction = "publish" | "releases" | "assign" | "preview" | "default" | "clone";
type Props = {
  def: LibraryDef;
  mode: EditorMode;
  dirty: boolean;
  busy: boolean;
  onMode: (m: EditorMode) => void;
  onAction: (a: LibraryAction) => void;
};

export function LibraryToolbar({ def, mode, dirty, busy, onMode, onAction }: Props) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, string | number>) => t(`process.admin.library.${k}`, o);
  const state = publishState(def);
  const ic = "size-4";
  return (
    <div className="space-y-2" data-testid="library-toolbar">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone="info">
          {L("usedFor", { slot: def.slot_label ?? def.slot ?? "" })}
        </StatusBadge>
        {def.is_default ? (
          <StatusBadge tone="ok">{L("defaultBadge", { slot: def.slot_label ?? "" })}</StatusBadge>
        ) : null}
        <StatusBadge tone={state === "published" ? "ok" : "off"}>
          {state === "published"
            ? L("pubState.published", { n: def.published_version ?? 0 })
            : L("pubState.draft")}
        </StatusBadge>
        <span className="text-caption text-muted-foreground">
          {L("usage", { n: def.tenant_count ?? 0 })}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <fieldset className="inline-flex min-w-0 rounded-md border border-border p-0.5">
          <legend className="sr-only">{L("mode.label")}</legend>
          {(["canvas", "form"] as const).map((m) => (
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
        <Button
          type="button"
          size="sm"
          disabled={dirty || busy}
          title={dirty ? L("publish.saveFirst") : undefined}
          onClick={() => onAction("publish")}
        >
          <Upload aria-hidden className={ic} />
          {L("publish.button")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={state !== "published"}
          onClick={() => onAction("releases")}
        >
          <History aria-hidden className={ic} />
          {L("releases.button")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => onAction("clone")}
        >
          <Copy aria-hidden className={ic} />
          {L("clone.button")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!canAssign(def)}
          title={canAssign(def) ? undefined : L("assign.needPublish")}
          onClick={() => onAction("assign")}
        >
          <Users aria-hidden className={ic} />
          {L("assign.button")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={dirty}
          onClick={() => onAction("preview")}
        >
          <Route aria-hidden className={ic} />
          {L("preview.button")}
        </Button>
        {canSetDefault(def) ? (
          <Button type="button" size="sm" variant="outline" onClick={() => onAction("default")}>
            {L("default.button")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
