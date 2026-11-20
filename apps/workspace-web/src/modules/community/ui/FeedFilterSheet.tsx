// CR-191 · bộ lọc bảng tin gộp: nút «Lọc» (CR-193: mọi màn hình là nút nổi, máy tính góc phải dưới) mở sheet
// (máy tính: bên phải; điện thoại: từ dưới). Lọc loại bài + nguồn (Tất cả / Công ty mình / Đối tác / từng công ty đã kết nối) + nhóm hàng/khu vực.
import type { FeedResponse, FeedTab } from "@ai/contracts/community";
import { Button } from "@ai/web-kit/ui/kit/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@ai/web-kit/ui/kit/sheet";
import { useState } from "react";
import { OptionSelect } from "~/shared/ui/OptionSelect";
import type { ConnectedCompany } from "../application/ports";
import type { useFeedFilters } from "../application/useFeed";
import { activeFilterCount, sourceChoices, sourceCount, typeCount } from "../domain/feed-source";
import { t } from "../i18n";
import { IconFilter } from "./icons";

type Filters = ReturnType<typeof useFeedFilters>;
const TYPES: FeedTab[] = ["all", "sell", "buy", "note", "archived"];

function Choice({
  on,
  label,
  n,
  testId,
  onClick,
}: {
  on: boolean;
  label: string;
  n: number | null;
  testId: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={on ? "chip on" : "chip"}
      aria-pressed={on}
      data-testid={testId}
      onClick={onClick}
    >
      {label}
      {n !== null && <span className="n">{n}</span>}
    </button>
  );
}

export function FeedFilterSheet({
  f,
  data,
  connected,
  narrow,
}: {
  f: Filters;
  data: FeedResponse | null;
  connected: ConnectedCompany[];
  narrow: boolean;
}) {
  const [open, setOpen] = useState(false);
  const n = activeFilterCount(f);
  const counts = data?.counts;
  const trigger = (
    <button
      type="button"
      className="filterfab"
      data-testid="feed-filter-btn"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => setOpen(true)}
    >
      <IconFilter size={16} />
      {t("community.feed.filter.button")}
      {n > 0 && (
        <span className="n" data-testid="feed-filter-n">
          {n}
        </span>
      )}
    </button>
  );
  const src = (v: string, label: string) => (
    <Choice
      key={v || "all"}
      on={f.source === v}
      label={label}
      n={sourceCount(counts, f.tab, v)}
      testId={`filter-source-${v || "all"}`}
      onClick={() => f.setSource(v)}
    />
  );
  return (
    <>
      {trigger}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side={narrow ? "bottom" : "right"}
          closeLabel={t("community.common.close")}
          data-testid="feed-filter-sheet"
          className="feedsheet"
        >
          <div data-mod="community" className="feedsheet-in">
            <SheetHeader>
              <SheetTitle>{t("community.feed.filter.title")}</SheetTitle>
              <SheetDescription className="sr-only">
                {t("community.feed.filterAria")}
              </SheetDescription>
            </SheetHeader>
            <SheetBody className="feedsheet-body">
              <h3>{t("community.feed.filter.type")}</h3>
              <div className="chips tight">
                {TYPES.map((id) => (
                  <Choice
                    key={id}
                    on={f.tab === id}
                    label={t(`community.feed.tabs.${id}`)}
                    n={typeCount(counts, id, f.source)}
                    testId={`filter-type-${id}`}
                    onClick={() => f.setTab(id)}
                  />
                ))}
              </div>
              <h3>{t("community.feed.filter.source")}</h3>
              <div className="chips tight">
                {sourceChoices(connected).map((c) =>
                  src(c.value, c.label ? t(c.label) : (c.name ?? "")),
                )}
              </div>
              {data && (
                <div className="selrow">
                  <OptionSelect
                    aria-label={t("community.feed.filters.cat")}
                    value={f.cat}
                    onValueChange={(v) => f.setCat(v)}
                  >
                    <option value="">{t("community.feed.filters.catAll")}</option>
                    {data.facets.cats.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </OptionSelect>
                  <OptionSelect
                    aria-label={t("community.feed.filters.area")}
                    value={f.area}
                    onValueChange={(v) => f.setArea(v)}
                  >
                    <option value="">{t("community.feed.filters.areaAll")}</option>
                    {data.facets.areas.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </OptionSelect>
                </div>
              )}
            </SheetBody>
            <SheetFooter>
              {n > 0 && (
                <Button variant="link" data-testid="filter-clear" onClick={f.clear}>
                  {t("community.feed.filters.clear")}
                </Button>
              )}
              <Button variant="primary" onClick={() => setOpen(false)}>
                {t("community.feed.filter.done")}
              </Button>
            </SheetFooter>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
