// ADM-FR-66 · CR-056 · P-a F5: thẻ "Thông tin" của editor — tên, mô tả, thời hạn; trường kỹ thuật (ký hiệu, nhóm, ngân sách, Bật) theo `variant`.
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Panel } from "@/components/shared/panel/Panel";
import { RefPicker } from "@/components/shared/RefPicker";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { EditorRefs } from "../../hooks/use-editor-refs";
import type { DefDraft, DraftErrors } from "../../lib/def-form";
import { DefTtlField } from "./DefTtlField";
import { TextField } from "./Fields";

/**
 * `full` = quy trình thường (tạo mới / mẫu): đủ trường. `library` / `copy` (CR-121 f18): chỉ trường nghiệp vụ (Tên, Mô tả, Thời hạn)
 * + khối "Nâng cao" thu gọn. Bản riêng (`copy`) chạy qua khe/luật: ký hiệu, nhóm được chạy (Hub dựng lại `run_group_ids` rỗng từ khe),
 * gợi ý nhập và công tắc "Bật" (bản riêng enabled=false vẫn chạy) KHÔNG có tác dụng ⇒ ẩn; chỉ còn giới hạn chi phí AI.
 */
export type InfoVariant = "full" | "library" | "copy";
type Props = {
  draft: DefDraft;
  errors: DraftErrors;
  readOnly: boolean;
  refs: EditorRefs;
  patch: (p: Partial<DefDraft>) => void;
  variant?: InfoVariant;
};

function GroupsField({
  draft,
  readOnly,
  refs,
  patch,
  error,
}: Omit<Props, "errors" | "variant"> & { error?: string | undefined }) {
  const { t } = useTranslation();
  const gname = (id: string) =>
    refs.groups.find((g) => g.value === id)?.label ?? t("process.admin.editor.gone");
  return (
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
      {error ? <p className="text-caption text-destructive">{error}</p> : null}
    </div>
  );
}

export function DefInfoCard({ draft, errors, readOnly, refs, patch, variant = "full" }: Props) {
  const { t } = useTranslation();
  const e = (f: string): string | undefined => (errors[f] ? t(errors[f] as string) : undefined);
  const full = variant === "full";
  const budget = (
    <TextField
      id="pd-budget"
      label={t(full ? "process.admin.editor.budget" : "process.admin.editor.budgetAi")}
      type="number"
      value={draft.budget}
      error={e("token_budget")}
      readOnly={readOnly}
      onChange={(v) => patch({ budget: v })}
    />
  );
  const enabled = (label: string) => (
    <div className="flex items-center gap-2">
      <Switch
        id="pd-enabled"
        checked={draft.enabled}
        disabled={readOnly}
        onCheckedChange={(v) => patch({ enabled: v })}
      />
      <Label htmlFor="pd-enabled">{label}</Label>
    </div>
  );
  return (
    <Panel title={t("process.admin.editor.info")}>
      <div className={full ? "grid gap-3 sm:grid-cols-2" : undefined}>
        <TextField
          id="pd-name"
          label={t("process.admin.editor.name")}
          value={draft.name}
          error={e("name")}
          readOnly={readOnly}
          onChange={(v) => patch({ name: v })}
        />
        {full ? (
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
        ) : null}
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
      <DefTtlField draft={draft} error={e("ttl_days")} readOnly={readOnly} patch={patch} />
      {full ? (
        <>
          <TextField
            id="pd-hint"
            label={t("process.admin.editor.hint")}
            value={draft.hint}
            error={e("input_hint")}
            readOnly={readOnly}
            onChange={(v) => patch({ hint: v })}
          />
          <GroupsField
            draft={draft}
            readOnly={readOnly}
            refs={refs}
            patch={patch}
            error={e("run_group_ids")}
          />
          {budget}
          {enabled(t("process.admin.editor.enabled"))}
        </>
      ) : (
        <details className="rounded-md border border-border px-3 py-2" data-testid="def-advanced">
          <summary className="cursor-pointer text-label font-medium">
            {t("process.admin.editor.advanced")}
          </summary>
          <div className="mt-3 space-y-3">
            {variant === "library" ? (
              <TextField
                id="pd-key"
                label={t("process.admin.editor.keyInternal")}
                value={draft.key}
                mono
                error={e("key")}
                readOnly={readOnly}
                onChange={(v) => patch({ key: v.replace(/^!/, "") })}
              />
            ) : null}
            {budget}
            {variant === "library" ? enabled(t("process.admin.editor.enabledLib")) : null}
          </div>
        </details>
      )}
    </Panel>
  );
}
