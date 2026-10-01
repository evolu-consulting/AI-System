// ADM-FR-22 · AC-A08 · M2-R18 · lưu bị chặn vì đổi input làm hỏng command đang dùng: Alert đỏ + danh sách command (thiếu/không còn biến nào).
import type { SchemaBreaksCommandsDetails } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { DependencyList } from "@/components/shared/DependencyList";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function SchemaBreaksAlert({ commands }: SchemaBreaksCommandsDetails) {
  const { t } = useTranslation();
  return (
    <Alert variant="destructive" className="mt-4">
      <AlertDescription className="space-y-2">
        <p className="font-medium">{t("workflows.schemaBreaks")}</p>
        <DependencyList
          sections={[
            {
              title: t("common.dependency.command"),
              items: commands.map((c) => ({
                id: c.id,
                label: `/${c.name}`,
                mono: true,
                href: `/commands/${c.id}`,
              })),
            },
          ]}
        />
        <ul className="text-caption">
          {commands.map((c) => (
            <li key={c.id}>
              <span className="font-mono">/{c.name}</span>
              {c.missing.length
                ? ` · ${t("workflows.schemaBreaksDetail.missing", { names: c.missing.join(", ") })}`
                : ""}
              {c.unknown.length
                ? ` · ${t("workflows.schemaBreaksDetail.unknown", { names: c.unknown.join(", ") })}`
                : ""}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
