// ADM-FR-21, ADM-FR-22 · AC-A03 · một dòng input map: tên input (mono, `*` nếu bắt buộc, kiểu) · nguồn (8) · tham số / giá trị cố định.
import { MAP_SOURCES } from "@ai/contracts";
import { TriangleAlert } from "lucide-react";
import { memo } from "react";
import { Controller, useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { MapInput, MapWarning } from "../lib/input-map";
import type { CommandFormValues, MapEntryValues } from "../lib/schemas";
import { mapSyntax } from "../lib/syntax";

type Props = {
  input: MapInput;
  entry: MapEntryValues;
  argNames: string[];
  /** Hàng bắt buộc chưa có nguồn sau khi bấm Lưu. */
  invalid: boolean;
  warning?: MapWarning;
};

function MapRowImpl({ input, entry, argNames, invalid, warning }: Props) {
  const { t } = useTranslation();
  const { control, register } = useFormContext<CommandFormValues>();
  const name = input.name;
  const warnId = `map-warn-${name}`;
  const prefix = `input_map.${name}` as const;
  return (
    <div
      className={cn(
        "grid gap-2 border-b border-border py-3 md:grid-cols-[14rem_14rem_1fr]",
        invalid && "bg-destructive/5",
      )}
    >
      <div className="min-w-0">
        <p className="font-mono text-body">
          {name}
          {input.required ? <span aria-hidden> *</span> : null}
        </p>
        <p className="text-caption text-muted-foreground">{input.type}</p>
      </div>
      <Controller
        control={control}
        name={`${prefix}.source`}
        render={({ field }) => (
          <Select
            value={field.value === "" ? undefined : field.value}
            onValueChange={field.onChange}
          >
            <SelectTrigger
              aria-label={t("commands.map.source.aria", { name })}
              aria-invalid={invalid ? true : undefined}
              aria-describedby={warning ? warnId : undefined}
              className="w-full"
            >
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {MAP_SOURCES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`commands.map.source.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      <div className="space-y-1">
        {entry.source === "arg" ? (
          <Controller
            control={control}
            name={`${prefix}.value`}
            render={({ field }) => (
              <Select
                value={field.value === "" ? undefined : field.value}
                onValueChange={field.onChange}
              >
                <SelectTrigger
                  aria-label={t("commands.map.arg.aria", { name })}
                  className="w-full max-w-xs font-mono"
                >
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {argNames.map((a) => (
                    <SelectItem key={a} value={a} className="font-mono">
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        ) : null}
        {entry.source === "const" ? (
          <Input
            {...register(`${prefix}.value`)}
            aria-label={t("commands.map.value.aria", { name })}
            autoComplete="off"
            className="max-w-md"
          />
        ) : null}
        {mapSyntax(entry) ? (
          <p className="font-mono text-caption text-muted-foreground">{mapSyntax(entry)}</p>
        ) : null}
        {warning ? (
          <p id={warnId} className="flex items-center gap-1 text-caption text-warning">
            <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
            {t("commands.warn.mapType", {
              source: t(`commands.map.source.${warning.source}`),
              type: warning.type,
              name,
            })}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export const InputMapRow = memo(MapRowImpl);
