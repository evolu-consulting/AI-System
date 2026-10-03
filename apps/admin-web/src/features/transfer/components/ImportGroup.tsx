// ADM-FR-54 · M4-AC09 · một loại thực thể trong bản xem trước (Accordion): mỗi mục có khoá, nhãn Thêm/Sửa, "Xem thay đổi" → DiffTable.
import type { ImportItem, ImportItemType } from "@ai/contracts";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { DiffTable } from "@/components/shared/diff/DiffTable";
import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { diffAll } from "@/lib/diff-fields";

function ItemRow({ item }: { item: ImportItem }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const diff = useMemo(() => diffAll(item.before, item.after), [item]);
  const create = item.op === "add";
  return (
    <li className="space-y-2 py-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-body">{item.key}</span>
        <Badge variant={create ? "ok" : "info"}>{t(`transfer.import.op.${item.op}`)}</Badge>
        <span className="text-label text-muted-foreground">
          {t("transfer.import.fields", { n: diff.changed.length })}
        </span>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="ml-auto h-auto p-0"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {t(open ? "transfer.import.hideDiff" : "transfer.import.showDiff")}
        </Button>
      </div>
      {open ? (
        <DiffTable
          rows={diff.changed}
          unchanged={create ? [] : diff.unchanged}
          mode={create ? "create" : "update"}
          markChanged={!create}
          labels={{
            caption: t("transfer.import.diff.caption", { key: item.key }),
            field: t("transfer.import.diff.field"),
            before: t("transfer.import.diff.before"),
            after: t("transfer.import.diff.after"),
          }}
        />
      ) : null}
    </li>
  );
}

export function ImportGroup({ type, items }: { type: ImportItemType; items: ImportItem[] }) {
  const { t } = useTranslation();
  return (
    <AccordionItem value={type}>
      <AccordionTrigger>
        {t(`transfer.export.type.${type}s`)} ({items.length})
      </AccordionTrigger>
      <AccordionContent>
        <ul className="divide-y divide-border">
          {items.map((it) => (
            <ItemRow key={`${it.type}:${it.key}`} item={it} />
          ))}
        </ul>
      </AccordionContent>
    </AccordionItem>
  );
}
