// CR-191 BR-191-6 · ô «Hàng hoá» gõ được + gợi ý thả xuống (Sản phẩm & Giá của công ty + hàng công ty đã đăng). Chọn gợi ý ⇒ điền sẵn đơn vị + đơn giá.
// Một lời gọi mỗi lần gõ (debounce 200 ms); lỗi/không có gợi ý ⇒ vẫn gõ tự do.

import type { GoodsSuggestion } from "@ai/contracts/community";
import { Input } from "@ai/web-kit/ui/kit/input";
import { useEffect, useRef, useState } from "react";
import { useApp } from "../application/ctx";
import { t } from "../i18n";

export function GoodsCombo({
  value,
  onChange,
  onPick,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick: (g: GoodsSuggestion) => void;
}) {
  const { api } = useApp();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<GoodsSuggestion[]>([]);
  const seq = useRef(0);
  useEffect(() => {
    if (!open) return;
    const n = ++seq.current;
    const h = setTimeout(
      () =>
        api.goodsSuggest(value.trim()).then(
          (r) => n === seq.current && setList(r),
          () => n === seq.current && setList([]),
        ),
      200,
    );
    return () => clearTimeout(h);
  }, [api, value, open]);
  return (
    <div className="goodscombo" style={{ position: "relative" }}>
      <Input
        role="combobox"
        aria-expanded={open && list.length > 0}
        aria-autocomplete="list"
        aria-label={t("community.draft.goods")}
        placeholder={t("community.draft.goodsHint")}
        data-testid="goods-input"
        value={value}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
      />
      {open && list.length > 0 && (
        <div
          role="listbox"
          data-testid="goods-list"
          aria-label={t("community.draft.goods")}
          className="absolute left-0 right-0 z-20 mt-1 max-h-60 overflow-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {list.map((g) => (
            <div key={`${g.source}:${g.name}`} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={g.name === value}
                data-testid="goods-option"
                className="flex min-h-11 w-full items-center justify-between gap-2 rounded px-2 text-left text-sm hover:bg-muted"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(g);
                  setOpen(false);
                }}
              >
                <span className="min-w-0 flex-1 truncate font-semibold">{g.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {[g.unit, g.price].filter(Boolean).join(" · ")}
                  {" · "}
                  {g.source === "catalog"
                    ? t("community.draft.goodsCatalog")
                    : t("community.draft.goodsPosted")}
                </span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
