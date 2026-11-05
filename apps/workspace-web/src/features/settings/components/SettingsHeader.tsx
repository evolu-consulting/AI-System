// V2-L · nút ở đầu hộp thoại Cài đặt: trạng thái + Khôi phục tất cả · Bỏ thay đổi · Lưu cài đặt (chỉ chủ sở hữu). Khung: shared/ui/settings-layout.
import { useTranslation } from "react-i18next";

const BTN =
  "h-8 rounded-lg border border-rule px-3 text-label text-ink-2 hover:bg-panel disabled:opacity-50";

export type HeaderProps = {
  owner: boolean;
  dirty: boolean;
  isDefault: boolean;
  saving: boolean;
  issue: string | null;
  /** CR-108 · mục chỉ xem (Quy trình duyệt) và không có nháp nào chưa lưu ⇒ thay các nút bằng ghi chú, tránh tưởng phải bấm Lưu. */
  noSave?: boolean;
  onReset: () => void;
  onDiscard: () => void;
  onSave: () => void;
};

export function SettingsActions(p: HeaderProps) {
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
    <>
      {p.noSave ? (
        <span className="text-caption text-dim" data-testid="settings-nosave-note">
          {t("contracts.flow.current.saveNote")}
        </span>
      ) : p.owner ? (
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
    </>
  );
}
