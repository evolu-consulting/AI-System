// CR-181 · tab mỗi tệp + huy hiệu số chỗ ký.
import { Badge } from "@ai/web-kit/ui/kit/badge";
import { ICONS } from "@ai/web-kit/ui/kit/icons";
import { Tabs, TabsList, TabsTrigger } from "@ai/web-kit/ui/kit/tabs";
import { useTranslation } from "react-i18next";
import type { SignFile } from "./types";

export function FileTabs(p: {
  files: SignFile[];
  active: string;
  counts: Record<string, number>;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  if (p.files.length < 2) return null;
  const Sign = ICONS.sign;
  return (
    <Tabs value={p.active} onValueChange={p.onSelect} className="border-b px-2">
      <TabsList className="overflow-x-auto">
        {p.files.map((f) => (
          <TabsTrigger key={f.id} value={f.id} className="gap-2">
            <span className="max-w-48 truncate">{f.name}</span>
            {(p.counts[f.id] ?? 0) > 0 && (
              <Badge status="info" icon={<Sign className="size-3" />}>
                {t("contracts.docsign.tabBadge", { count: p.counts[f.id] })}
              </Badge>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
