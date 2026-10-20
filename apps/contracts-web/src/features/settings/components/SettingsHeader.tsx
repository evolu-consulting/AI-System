// V2-L · đầu hộp thoại Cài đặt: tiêu đề + trạng thái + Khôi phục tất cả · Bỏ thay đổi · Lưu cài đặt (chỉ chủ sở hữu).
import { useTranslation } from "react-i18next";
import { DialogDescription, DialogTitle } from "~/components/ui/dialog";

const BTN =
  "h-8 rounded-lg border border-rule px-3 text-label text-ink-2 hover:bg-panel disabled:opacity-50";

export type HeaderProps = {
  owner: boolean;
  dirty: boolean;
  isDefault: boolean;
  saving: boolean;
  issue: string | null;
  onReset: () => void;
  onDiscard: () => void;
  onSave: () => void;
};

export function SettingsHeader(p: HeaderProps) {
  const { t } = useTranslation();
  const s = (k: string) => t(`contracts.settings.${k}`);
  const state = p.dirty ? (
    <b className="text-soon">{s("unsaved")}</b>
  ) : p.isDefault ? (
    s("isDefault")
  ) : (
    s("customised")
  );
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-rule bg-sunk py-3 pr-14 pl-5">
      <DialogTitle className="text-card-title">{s("title")}</DialogTitle>
      <DialogDescription className="text-caption text-dim">{s("scope")}</DialogDescription>
      <div className="ml-auto flex items-center gap-2">
        {p.owner ? (
          <>
            <span className="text-caption text-dim">{state}</span>
            <button type="button" disabled={p.isDefault} onClick={p.onReset} className={BTN}>
              {s("resetAll")}
            </button>
            <button type="button" disabled={!p.dirty} onClick={p.onDiscard} className={BTN}>
              {s("discard")}
            </button>
            <button
              type="button"
              disabled={!p.dirty || p.saving || p.issue !== null}
              title={p.issue ? s(p.issue) : undefined}
              onClick={p.onSave}
              className="h-8 rounded-lg bg-act px-4 text-label font-semibold text-on-act disabled:opacity-50"
            >
              {s("save")}
            </button>
          </>
        ) : (
          <span className="text-caption text-dim">{s("readOnly")}</span>
        )}
      </div>
    </header>
  );
}
