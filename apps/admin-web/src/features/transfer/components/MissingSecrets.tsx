// ADM-FR-54 · ADM-BR-04 · M4-AC10 · "Cần tạo secret": mỗi secret thiếu một ô password; giá trị chỉ ở state (D11), không lưu đâu khác.
import { type MissingSecret, SECRET_VALUE_MAX } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";

type Props = {
  secrets: MissingSecret[];
  values: Record<string, string>;
  isValid: (v: string | undefined) => boolean;
  onChange: (name: string, value: string) => void;
};

export function MissingSecrets({ secrets, values, isValid, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="import-secrets-title" className="space-y-3 rounded-lg border p-4">
      <h3 id="import-secrets-title" className="text-body font-semibold">
        {t("transfer.import.secretsNeeded")}
      </h3>
      <ul className="space-y-4">
        {secrets.map((s) => {
          const v = values[s.name] ?? "";
          const bad = v !== "" && !isValid(v);
          const errId = `import-secret-err-${s.name}`;
          return (
            <li key={s.name} className="grid gap-1.5 sm:grid-cols-[16rem_1fr] sm:items-start">
              <div>
                <span className="font-mono text-body">{s.name}</span>
                <p className="text-label text-muted-foreground">
                  {t("transfer.import.secretUsedBy", { key: s.used_by.join(", ") })}
                </p>
              </div>
              <div className="space-y-1">
                <Input
                  type="password"
                  autoComplete="new-password"
                  maxLength={SECRET_VALUE_MAX}
                  placeholder={t("transfer.import.value")}
                  aria-label={t("transfer.import.valueLabel", { name: s.name })}
                  aria-invalid={bad || undefined}
                  aria-describedby={bad ? errId : undefined}
                  value={v}
                  onChange={(e) => onChange(s.name, e.target.value)}
                />
                {bad ? (
                  <p id={errId} className="text-label text-destructive">
                    {t("secrets.error.valueLength")}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
