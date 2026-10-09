// CR-054 · ô Model của bước ② (chỉ agentic-cli): thẻ chọn từ danh mục Runtime đọc từ Claude CLI.
// "Theo profile" = `null`; alias "Luôn bản mới nhất" trên, "Bản cố định" dưới; danh mục rỗng vẫn chọn được "Theo profile".
import type { ModelCatalogItem } from "@ai/contracts/studio";
import { useTranslation } from "react-i18next";
import { cn } from "#/lib/utils";
import type { Catalog } from "../../hooks/use-editor-catalogs";
import {
  formatFetchedAt,
  groupModels,
  latestFetchedAt,
  modelValueLabel,
} from "../../lib/model-catalog";
import type { SectionProps } from "../editor/AgentField";
import { CatalogAlert } from "../editor/CatalogAlert";

type CardProps = {
  title: string;
  note: string;
  value?: string;
  selected: boolean;
  onPick: () => void;
};

function ModelCard({ title, note, value, selected, onPick }: CardProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onPick}
      className={cn(
        "flex flex-col items-start gap-1 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "border-2 border-primary bg-accent" : "border-border",
      )}
    >
      <span className="font-medium">{title}</span>
      {note ? <span className="text-label text-muted-foreground">{note}</span> : null}
      {value ? <span className="font-mono text-label text-muted-foreground">{value}</span> : null}
    </button>
  );
}

function ModelGroup(p: {
  title: string;
  items: ModelCatalogItem[];
  current: string;
  onPick: (v: string) => void;
}) {
  if (p.items.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-label text-muted-foreground">{p.title}</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {p.items.map((m) => (
          <ModelCard
            key={m.value}
            title={m.display_name}
            note={m.description}
            value={modelValueLabel(m)}
            selected={p.current === m.value}
            onPick={() => p.onPick(m.value)}
          />
        ))}
      </div>
    </div>
  );
}

export function ModelPicker({
  draft,
  set,
  models,
}: SectionProps & { models: Catalog<ModelCatalogItem> }) {
  const { t } = useTranslation();
  const groups = groupModels(models.items);
  const at = formatFetchedAt(latestFetchedAt(models.items));
  const pick = (v: string) => set("model", v);
  const empty = !models.pending && !models.failed && models.items.length === 0;
  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 text-label font-medium">{t("editor.field.model")}</legend>
      {models.failed ? <CatalogAlert what={t("editor.field.model")} retry={models.retry} /> : null}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <ModelCard
          title={t("editor.model.byProfile")}
          note={t("editor.model.byProfileNote")}
          selected={draft.model === ""}
          onPick={() => pick("")}
        />
      </div>
      {draft.model !== "" && !models.items.some((m) => m.value === draft.model) ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <ModelCard
            title={draft.model}
            note={t("editor.model.notInCatalog")}
            selected
            onPick={() => pick(draft.model)}
          />
        </div>
      ) : null}
      <ModelGroup
        title={t("editor.model.latest")}
        items={groups.latest}
        current={draft.model}
        onPick={pick}
      />
      <ModelGroup
        title={t("editor.model.pinned")}
        items={groups.pinned}
        current={draft.model}
        onPick={pick}
      />
      {empty ? <p className="text-label text-muted-foreground">{t("editor.model.empty")}</p> : null}
      {at ? (
        <p className="text-label text-muted-foreground">{t("editor.model.fetchedAt", { at })}</p>
      ) : null}
      <p className="rounded-lg border border-border bg-muted px-3 py-2 text-label text-muted-foreground">
        <span className="font-medium text-foreground">{t("editor.model.hintTitle")}</span>{" "}
        {t("editor.model.hint")}
      </p>
    </fieldset>
  );
}
