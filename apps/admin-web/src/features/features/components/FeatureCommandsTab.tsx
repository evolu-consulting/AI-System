// ADM-FR-30 · ADM-BR-10 · M2-R19 · tab "Commands": bảng command của feature (nháp), "Thêm command", cảnh báo command sẽ mồ côi.
import type { FeatureDetail } from "@ai/contracts";
import { X } from "lucide-react";
import { useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { RefPicker } from "@/components/shared/RefPicker";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { pickLocalized } from "@/lib/localized";
import { useCommandOptions } from "../hooks/use-feature-queries";
import { type FeatureFormValues, removedOrphans } from "../lib/schemas";

type Row = { id: string; name: string; description: string; others: number };

export function FeatureCommandsTab({ feature }: { feature: FeatureDetail | undefined }) {
  const { t, i18n } = useTranslation();
  const [q, setQ] = useState("");
  const { control, setValue } = useFormContext<FeatureFormValues>();
  const ids = useWatch({ control, name: "command_ids" });
  const options = useCommandOptions(q);
  const lang = i18n.language;
  const initial = feature?.commands ?? [];
  const byId = new Map<string, Row>();
  for (const c of options.data ?? []) {
    byId.set(c.id, {
      id: c.id,
      name: c.name,
      description: pickLocalized(c.description, lang),
      others: c.featureCount,
    });
  }
  for (const c of initial) {
    byId.set(c.id, {
      id: c.id,
      name: c.name,
      description: pickLocalized(c.description, lang),
      others: c.feature_count - 1,
    });
  }
  const rows = ids.map((id) => byId.get(id)).filter((r): r is Row => !!r);
  const orphans = removedOrphans(initial, ids);
  const change = (next: string[]) => setValue("command_ids", next, { shouldDirty: true });

  return (
    <div className="space-y-4">
      <RefPicker
        label={t("features.commands.add")}
        placeholder={t("features.commands.addPlaceholder")}
        options={(options.data ?? []).map((c) => ({
          id: c.id,
          label: `/${c.name}`,
          hint: pickLocalized(c.description, lang),
        }))}
        selectedIds={ids}
        isLoading={options.isPending}
        onSearch={setQ}
        onPick={(id) => change([...ids, id])}
      />
      {rows.length === 0 ? (
        <p className="text-body text-muted-foreground">{t("features.commands.empty")}</p>
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <caption className="sr-only">{t("features.tab.commands")}</caption>
            <TableHeader>
              <TableRow>
                <TableHead>{t("features.commands.col.name")}</TableHead>
                <TableHead>{t("features.commands.col.description")}</TableHead>
                <TableHead>{t("features.commands.col.others")}</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">{t("common.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono">/{r.name}</TableCell>
                  <TableCell>{r.description}</TableCell>
                  <TableCell>{r.others > 0 ? r.others : ""}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("features.commands.remove.aria", { name: r.name })}
                      onClick={() => change(ids.filter((x) => x !== r.id))}
                    >
                      <X aria-hidden />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {orphans.length > 0 ? (
        <ul className="space-y-1">
          {orphans.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-body"
            >
              <StatusBadge tone="warn">{t("features.commands.orphanBadge")}</StatusBadge>
              {t("features.commands.orphan", { name: c.name })}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
