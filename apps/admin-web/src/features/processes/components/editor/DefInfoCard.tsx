// ADM-FR-66 · CR-056 · P-a F5: thẻ "Thông tin" của editor — tên, ký hiệu `!`, mô tả, gợi ý, Group được chạy, ngân sách, Bật.
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Panel } from "@/components/shared/panel/Panel";
import { RefPicker } from "@/components/shared/RefPicker";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { EditorRefs } from "../../hooks/use-editor-refs";
import type { DefDraft, DraftErrors } from "../../lib/def-form";
import { TextField } from "./Fields";

type Props = {
  draft: DefDraft;
  errors: DraftErrors;
  readOnly: boolean;
  refs: EditorRefs;
  patch: (p: Partial<DefDraft>) => void;
};

export function DefInfoCard({ draft, errors, readOnly, refs, patch }: Props) {
  const { t } = useTranslation();
  const e = (f: string): string | undefined => (errors[f] ? t(errors[f] as string) : undefined);
  const gname = (id: string) =>
    refs.groups.find((g) => g.value === id)?.label ?? t("process.admin.editor.gone");
  return (
    <Panel title={t("process.admin.editor.info")}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          id="pd-name"
          label={t("process.admin.editor.name")}
          value={draft.name}
          error={e("name")}
          readOnly={readOnly}
          onChange={(v) => patch({ name: v })}
        />
        <TextField
          id="pd-key"
          label={t("process.admin.editor.key")}
          value={draft.key}
          prefix="!"
          mono
          error={e("key")}
          readOnly={readOnly}
          onChange={(v) => patch({ key: v.replace(/^!/, "") })}
        />
      </div>
      <TextField
        id="pd-desc"
        label={t("process.admin.editor.desc")}
        value={draft.description}
        error={e("description")}
        readOnly={readOnly}
        multiline
        rows={2}
        onChange={(v) => patch({ description: v })}
      />
      <TextField
        id="pd-hint"
        label={t("process.admin.editor.hint")}
        value={draft.hint}
        error={e("input_hint")}
        readOnly={readOnly}
        onChange={(v) => patch({ hint: v })}
      />
      <div className="space-y-1.5">
        <p className="text-label font-medium">{t("process.admin.editor.groups")}</p>
        <ul className="flex flex-wrap gap-1.5">
          {draft.groupIds.map((id) => (
            <li
              key={id}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-0.5 text-label"
            >
              {gname(id)}
              {readOnly ? null : (
                <button
                  type="button"
                  aria-label={t("process.admin.editor.removeGroup", { name: gname(id) })}
                  onClick={() => patch({ groupIds: draft.groupIds.filter((x) => x !== id) })}
                  className="rounded-full p-0.5 hover:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <X aria-hidden className="size-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
        {readOnly ? null : (
          <RefPicker
            label={t("process.admin.editor.addGroup")}
            options={refs.groups.map((g) => ({ id: g.value, label: g.label }))}
            selectedIds={draft.groupIds}
            isLoading={refs.loading}
            onPick={(id) => patch({ groupIds: [...draft.groupIds, id] })}
          />
        )}
        {e("run_group_ids") ? (
          <p className="text-caption text-destructive">{e("run_group_ids")}</p>
        ) : null}
      </div>
      <TextField
        id="pd-budget"
        label={t("process.admin.editor.budget")}
        type="number"
        value={draft.budget}
        error={e("token_budget")}
        readOnly={readOnly}
        onChange={(v) => patch({ budget: v })}
      />
      <div className="flex items-center gap-2">
        <Switch
          id="pd-enabled"
          checked={draft.enabled}
          disabled={readOnly}
          onCheckedChange={(v) => patch({ enabled: v })}
        />
        <Label htmlFor="pd-enabled">{t("process.admin.editor.enabled")}</Label>
      </div>
    </Panel>
  );
}
