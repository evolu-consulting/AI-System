// ADM-FR-68 · C3 · `combobox "Tài liệu thư viện"`: nút mở Popover có ô tìm theo tên + listbox + "Tải thêm". Nút hiện tên tài liệu đã chọn.
// Không gõ UUID (plan-frontend §2). Dữ liệu do hook `useLibraryDocPicker` cấp qua props (component không gọi API).
import { ChevronsUpDown } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { LibraryDocPickerData } from "../hooks/use-library-doc-picker";

const DEBOUNCE_MS = 300;

type Props = {
  id: string;
  value: string;
  onChange: (id: string) => void;
  picker: LibraryDocPickerData;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
};

export function LibraryDocPicker({
  id,
  value,
  onChange,
  picker,
  invalid,
  describedBy,
  disabled,
}: Props) {
  const { t } = useTranslation();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { setQuery: search } = picker;
  const selected = picker.items.find((d) => d.id === value);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => search(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, open, search]);

  const pick = (docId: string) => {
    onChange(docId);
    setOpen(false);
    setQuery("");
  };
  const shown = value
    ? (selected?.name ?? value.slice(0, 8))
    : t("process.sources.field.documentPlaceholder");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={t("process.sources.field.document")}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          disabled={disabled}
          className={cn("w-full justify-between", !value && "text-muted-foreground")}
        >
          <span className="truncate">{shown}</span>
          <ChevronsUpDown aria-hidden className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2 p-2">
        <Input
          type="search"
          value={query}
          placeholder={t("process.sources.field.documentSearch")}
          aria-label={t("process.sources.field.documentSearch")}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div
          id={listId}
          role="listbox"
          aria-label={t("process.sources.field.document")}
          className="max-h-60 overflow-y-auto"
        >
          {picker.items.map((d) => (
            <div
              key={d.id}
              role="option"
              aria-selected={d.id === value}
              tabIndex={0}
              onClick={() => pick(d.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  pick(d.id);
                }
              }}
              className={cn(
                "cursor-pointer rounded-sm px-2 py-1.5 text-body hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                d.id === value && "bg-accent text-accent-foreground",
              )}
            >
              {d.name}
            </div>
          ))}
        </div>
        {picker.isLoading ? (
          <p className="px-2 text-caption text-muted-foreground">{t("common.loading")}</p>
        ) : null}
        {picker.isError ? (
          <p className="px-2 text-caption text-destructive">
            {t("process.sources.field.documentError")}
          </p>
        ) : null}
        {!picker.isLoading && !picker.isError && picker.items.length === 0 ? (
          <p className="px-2 text-caption text-muted-foreground">
            {t("process.sources.field.documentEmpty")}
          </p>
        ) : null}
        {picker.hasMore ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={picker.loadingMore}
            onClick={picker.loadMore}
          >
            {t("process.sources.more")}
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
