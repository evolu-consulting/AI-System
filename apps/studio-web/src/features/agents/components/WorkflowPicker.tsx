// HUB-FR-64 · H4a-R04 · Dialog chọn workflow từ catalog (chỉ workflow bật — server đã lọc): tìm theo key/tên;
// `dify-workflow`/`dify-agent` chọn đúng 1 (radio), runtime khác chọn nhiều (checkbox). [Gắn] ghi vào nháp.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { RadioGroup, RadioGroupItem } from "#/components/ui/radio-group";
import type { WorkflowItem } from "../hooks/use-editor-catalogs";

type Props = {
  items: WorkflowItem[];
  single: boolean;
  selected: string[];
  onAttach: (ids: string[]) => void;
  onClose: () => void;
};

const matches = (w: WorkflowItem, q: string) =>
  `${w.key} ${w.name}`.toLowerCase().includes(q.trim().toLowerCase());

type RowProps = { w: WorkflowItem; single: boolean; picked: boolean; toggle: () => void };

function Row({ w, single, picked, toggle }: RowProps) {
  const id = `wf-${w.id}`;
  return (
    <li className="flex items-start gap-3 py-2">
      {single ? (
        <RadioGroupItem id={id} value={w.id} aria-describedby={`${id}-d`} />
      ) : (
        <Checkbox id={id} checked={picked} onCheckedChange={toggle} aria-describedby={`${id}-d`} />
      )}
      <div className="min-w-0">
        <Label htmlFor={id} className="font-mono">
          {w.key}
        </Label>
        <p id={`${id}-d`} className="text-label text-muted-foreground">
          {w.name} · {w.app_type}
          {w.description ? ` — ${w.description}` : ""}
        </p>
      </div>
    </li>
  );
}

export function WorkflowPicker({ items, single, selected, onAttach, onClose }: Props) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>(selected);
  const toggle = (id: string) =>
    setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  const rows = items
    .filter((w) => matches(w, q))
    .map((w) => (
      <Row
        key={w.id}
        w={w}
        single={single}
        picked={picked.includes(w.id)}
        toggle={() => toggle(w.id)}
      />
    ));
  const list = <ul className="max-h-72 divide-y divide-border overflow-auto">{rows}</ul>;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("editor.wf.pickerTitle")}</DialogTitle>
          <DialogDescription className="sr-only">{t("editor.wf.hint")}</DialogDescription>
        </DialogHeader>
        <Input
          type="search"
          aria-label={t("editor.wf.pickerSearch")}
          placeholder={t("editor.wf.pickerSearch")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {items.length === 0 ? (
          <p className="text-body text-muted-foreground">{t("editor.wf.pickerEmpty")}</p>
        ) : single ? (
          <RadioGroup value={picked[0] ?? ""} onValueChange={(v) => setPicked([v])}>
            {list}
          </RadioGroup>
        ) : (
          list
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("editor.cancel")}
          </Button>
          <Button type="button" onClick={() => onAttach(picked)}>
            {t("editor.wf.attach")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
