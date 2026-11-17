// CR-181 · s14 · tab tệp cần ký, mỗi tab kèm trạng thái «Đã ký đủ / 1/2 / Chưa ký».
import type { SignFileOut } from "@ai/contracts/pack-contracts";
import { Badge } from "@ai/web-kit/ui/kit/badge";
import { ICONS } from "@ai/web-kit/ui/kit/icons";
import { Tabs, TabsList, TabsTrigger } from "@ai/web-kit/ui/kit/tabs";
import { useTranslation } from "react-i18next";
import { fileStatus } from "../lib/viewer-model";

export function ViewerTabs(p: {
  files: SignFileOut[];
  active: string;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const Sign = ICONS.sign;
  return (
    <Tabs value={p.active} onValueChange={p.onSelect} className="border-b px-2">
      <TabsList className="overflow-x-auto">
        {p.files.map((f) => {
          const s = fileStatus(f);
          return (
            <TabsTrigger key={f.file_id} value={f.file_id} className="gap-2">
              <span className="max-w-48 truncate">{f.name}</span>
              <Badge
                status={s.kind === "full" ? "ok" : s.kind === "partial" ? "info" : "idle"}
                icon={<Sign className="size-3" aria-hidden />}
              >
                {s.kind === "full"
                  ? t("contracts.docsign.viewer.statusFull")
                  : s.kind === "partial"
                    ? t("contracts.docsign.viewer.statusPartial", { done: s.done, total: s.total })
                    : t("contracts.docsign.viewer.statusNone")}
              </Badge>
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
