// N3-FR-04 · N3-FR-09 · tùy chọn kênh nhận thông báo của chính người dùng (in-app luôn có): email, thông báo đẩy.
import type { NotifyPrefs } from "@ai/contracts";
import { useId } from "react";
import { useTranslation } from "react-i18next";

export function NotifyPrefsForm({
  prefs,
  onChange,
}: {
  prefs: NotifyPrefs;
  onChange: (p: NotifyPrefs) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const row = (key: keyof NotifyPrefs, label: string) => (
    <label key={key} htmlFor={`${id}-${key}`} className="flex items-center gap-2 text-body">
      <input
        id={`${id}-${key}`}
        type="checkbox"
        checked={prefs[key]}
        onChange={(e) => onChange({ ...prefs, [key]: e.target.checked })}
      />
      {label}
    </label>
  );
  return (
    <fieldset className="grid gap-1.5 border-t border-rule px-4 py-3">
      <legend className="sr-only">{t("contracts.shell.notificationsChannels")}</legend>
      <p className="text-micro text-dim">{t("contracts.shell.notificationsChannels")}</p>
      {row("email", t("contracts.shell.channelEmail"))}
      {row("push", t("contracts.shell.channelPush"))}
    </fieldset>
  );
}
