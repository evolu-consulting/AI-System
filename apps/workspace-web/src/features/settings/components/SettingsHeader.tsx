// V2-L · nút ở đầu hộp thoại Cài đặt: trạng thái + Khôi phục tất cả · Bỏ thay đổi · Lưu cài đặt (chỉ chủ sở hữu). Khung: shared/ui/settings-layout.
import { useTranslation } from "react-i18next";
import { Btn } from "~/components/ui/Btn";

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
  const lock = p.owner ? undefined : s("readOnly"); // Q7: không có quyền ⇒ nút khoá + lý do khi rê chuột
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
      ) : (
        <>
          <span className="text-caption text-dim">{p.owner ? state : s("readOnly")}</span>
          <Btn size="sm" disabled={!p.owner || p.isDefault} reason={lock} onClick={p.onReset}>
            {s("resetAll")}
          </Btn>
          <Btn size="sm" disabled={!p.owner || !p.dirty} reason={lock} onClick={p.onDiscard}>
            {s("discard")}
          </Btn>
          <Btn
            size="sm"
            variant="primary"
            disabled={!p.owner || !p.dirty || p.issue !== null}
            loading={p.saving}
            reason={lock ?? (p.issue ? s(p.issue) : undefined)}
            onClick={p.onSave}
          >
            {s("save")}
          </Btn>
        </>
      )}
    </>
  );
}
