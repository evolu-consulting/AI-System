// ADM-FR-69 · HUB-FR-124 · P-b FS-7: thẻ "Nguồn của quy trình" — chọn ≤ 20 nguồn của công ty; bỏ nguồn đang giai đoạn dùng ⇒ chặn.
import { DEF_SOURCES_MAX } from "@ai/contracts/hub-admin";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "@/components/shared/panel/Panel";
import { RefPicker } from "@/components/shared/RefPicker";
import { useSourceOptions } from "@/features/sources/api";
import type { DefDraft, DraftErrors } from "../../lib/def-form";
import { canDropSource, firstStageUsing } from "../../lib/sources-form";

type Props = {
  draft: DefDraft;
  errors: DraftErrors;
  readOnly: boolean;
  tenantId: string | undefined;
  /** Đã biết công ty (platform_admin chọn xong) ⇒ mới tải danh sách nguồn. */
  ready: boolean;
  patch: (p: Partial<DefDraft>) => void;
};

export function SourcesCard({ draft, errors, readOnly, tenantId, ready, patch }: Props) {
  const { t } = useTranslation();
  const q = useSourceOptions(tenantId, ready);
  const [blocked, setBlocked] = useState<string | null>(null);
  const options = q.data ?? [];
  const full = draft.sources.length >= DEF_SOURCES_MAX;
  const drop = (key: string) => {
    if (!canDropSource(draft, key)) {
      setBlocked(t("process.admin.editor.sources.inUse", { key, n: firstStageUsing(draft, key) }));
      return;
    }
    setBlocked(null);
    patch({ sources: draft.sources.filter((k) => k !== key) });
  };
  const gone = (key: string) => q.isSuccess && !options.some((o) => o.key === key);
  const err = errors.sources ? t(errors.sources) : null;
  return (
    <Panel title={t("process.admin.editor.sources.title")}>
      {draft.sources.length === 0 ? (
        <p className="text-body text-muted-foreground">{t("process.admin.editor.sources.empty")}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {draft.sources.map((key) => (
            <li
              key={key}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-label ${
                gone(key)
                  ? "border-destructive bg-destructive/10 text-destructive"
                  : "border-border bg-muted"
              }`}
            >
              {key}
              {gone(key) ? (
                <span className="font-sans">{t("process.admin.editor.sources.gone")}</span>
              ) : null}
              {readOnly ? null : (
                <button
                  type="button"
                  aria-label={t("process.admin.editor.sources.remove", { key })}
                  onClick={() => drop(key)}
                  className="rounded-full p-0.5 hover:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <X aria-hidden className="size-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {readOnly ? null : (
          <RefPicker
            label={t("process.admin.editor.sources.add")}
            options={options.map((o) => ({ id: o.key, label: o.key, hint: o.description }))}
            selectedIds={draft.sources}
            isLoading={q.isPending && ready}
            disabled={full}
            onPick={(key) => patch({ sources: [...draft.sources, key] })}
          />
        )}
        <Link to="/sources" className="text-label text-primary underline-offset-2 hover:underline">
          {t("process.admin.editor.sources.declare")}
        </Link>
      </div>
      {full ? (
        <p className="text-caption text-muted-foreground">
          {t("process.admin.editor.sources.max")}
        </p>
      ) : null}
      {blocked ? (
        <p role="alert" className="text-caption text-destructive">
          {blocked}
        </p>
      ) : null}
      {err ? <p className="text-caption text-destructive">{err}</p> : null}
    </Panel>
  );
}
