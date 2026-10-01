// ADM-FR-20, ADM-FR-30 · M2 · một ô văn bản có tablist "Ngôn ngữ" VI/EN; đổi tab đổi giá trị đang sửa; badge "EN thiếu" khi EN trống.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "./form/FormField";
import { StatusBadge } from "./StatusBadge";

export type LocalizedValue = { vi: string; en: string };
type Lang = keyof LocalizedValue;

type Props = {
  id: string;
  label: string;
  value: LocalizedValue;
  onChange: (next: LocalizedValue) => void;
  multiline?: boolean;
  maxLength?: number;
  description?: string;
  /** Câu lỗi đã dịch. */
  error?: string;
};

export function LocalizedInput({
  id,
  label,
  value,
  onChange,
  multiline,
  maxLength,
  description,
  error,
}: Props) {
  const { t } = useTranslation();
  const [lang, setLang] = useState<Lang>("vi");
  const Control = multiline ? Textarea : Input;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Tabs value={lang} onValueChange={(v) => setLang(v as Lang)}>
          <TabsList aria-label={t("auth.lang.group")}>
            <TabsTrigger value="vi">VI</TabsTrigger>
            <TabsTrigger value="en">EN</TabsTrigger>
          </TabsList>
        </Tabs>
        {value.en.trim() === "" ? (
          <StatusBadge tone="warn">{t("common.localized.enMissing")}</StatusBadge>
        ) : null}
      </div>
      <FormField id={id} label={label} description={description} error={error}>
        {(field) => (
          <Control
            {...field}
            lang={lang}
            maxLength={maxLength}
            value={value[lang]}
            onChange={(e) => onChange({ ...value, [lang]: e.target.value })}
          />
        )}
      </FormField>
    </div>
  );
}
