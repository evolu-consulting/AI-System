// ADM-BR-01 · M2-R13 · ô Alias: nhập rồi `Thêm alias` (hoặc Enter); chip `Bỏ alias {name}`; ≤ 5, không trùng, không trùng command khác.
import { ALIASES_MAX, CATALOG_KEY_RE } from "@ai/contracts";
import { X } from "lucide-react";
import { useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { FormField } from "@/components/shared/form/FormField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeCommandName } from "@/lib/normalize";
import { useTr } from "@/lib/use-translate";
import { findNameConflict } from "../api";
import type { CommandFormValues } from "../lib/schemas";

/** Lỗi khi thêm `alias` vào danh sách `aliases` của command tên `name`; `null` = hợp lệ (chưa kiểm trùng server). */
export function aliasProblem(alias: string, name: string, aliases: string[]): string | null {
  if (!CATALOG_KEY_RE.test(alias)) return "commands.error.nameFormat";
  if (alias === name || aliases.includes(alias)) return "commands.error.aliasDup";
  if (aliases.length >= ALIASES_MAX) return "commands.error.aliasMax";
  return null;
}

type Props = { excludeId?: string; serverError?: string };

export function AliasField({ excludeId, serverError }: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const { control, setValue, getValues } = useFormContext<CommandFormValues>();
  const aliases = useWatch({ control, name: "aliases" });
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();

  const add = async () => {
    const alias = normalizeCommandName(draft);
    if (alias === "") return;
    const name = getValues("name");
    const problem = aliasProblem(alias, name, aliases);
    if (problem) return setError(tr(problem));
    const taken = await findNameConflict(alias, excludeId).catch(() => false);
    if (taken) return setError(tr("commands.error.nameTaken", { name: alias }));
    setValue("aliases", [...aliases, alias], { shouldDirty: true });
    setDraft("");
    setError(undefined);
  };

  return (
    <FormField id="cmd-alias" label={t("commands.field.alias")} error={error ?? serverError}>
      {(p) => (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              {...p}
              value={draft}
              onChange={(e) => {
                setDraft(normalizeCommandName(e.target.value));
                setError(undefined);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void add();
                }
              }}
              autoComplete="off"
              spellCheck={false}
              className="max-w-xs font-mono"
            />
            <Button type="button" variant="outline" onClick={() => void add()}>
              {t("commands.field.aliasAdd")}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {aliases.map((a) => (
              <span
                key={a}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 font-mono text-label"
              >
                {a}
                <button
                  type="button"
                  aria-label={t("commands.alias.remove.aria", { name: a })}
                  onClick={() =>
                    setValue(
                      "aliases",
                      aliases.filter((x) => x !== a),
                      { shouldDirty: true },
                    )
                  }
                  className="rounded-full p-0.5 hover:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </FormField>
  );
}
