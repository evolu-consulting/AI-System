// ADM-FR-60, ADM-FR-04 · ô tìm kiếm: `searchbox`, debounce 300 ms, Esc xoá.
import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";

export const SEARCH_DEBOUNCE_MS = 300;

type Props = {
  /** Nhãn truy cập và placeholder (vd "Tìm…"). */
  label: string;
  value: string;
  onChange: (value: string) => void;
};

export function SearchBox({ label, value, onChange }: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSent = useRef(value);

  // Giá trị đổi từ ngoài (URL, "Xoá bộ lọc") → đồng bộ ô nhập.
  useEffect(() => {
    if (value !== lastSent.current) {
      lastSent.current = value;
      setDraft(value);
    }
  }, [value]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const push = (next: string, delay: number) => {
    setDraft(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      lastSent.current = next;
      onChange(next);
    }, delay);
  };

  return (
    <div className="relative w-full max-w-sm">
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        aria-label={label}
        placeholder={label}
        value={draft}
        onChange={(e) => push(e.target.value, SEARCH_DEBOUNCE_MS)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && draft !== "") {
            e.preventDefault();
            push("", 0);
          }
        }}
        className="pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden"
      />
      {draft ? (
        <button
          type="button"
          aria-label={t("common.clearSearch")}
          onClick={() => push("", 0)}
          className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <X aria-hidden className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
