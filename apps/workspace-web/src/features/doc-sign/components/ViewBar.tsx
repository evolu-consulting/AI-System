// CR-182 · «Kiểu xem khi ký»: Từng trang | Xoè quạt; Từng trang có «Liền mép»; Xoè quạt có Mép phải | Mép dưới và ‹ Trang 1–5 ›.
// Điện thoại (≤ 640px): ẩn cả cụm — chỉ có «Từng trang».
import { Button } from "@ai/web-kit/ui/kit/button";
import { Label } from "@ai/web-kit/ui/kit/label";
import { Switch } from "@ai/web-kit/ui/kit/switch";
import { ToggleGroup, ToggleGroupItem } from "@ai/web-kit/ui/kit/toggle-group";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import {
  clampGroup,
  type FanEdge,
  groupCount,
  groupRange,
  type StageView,
  type ViewMode,
} from "../lib/fan";

export function ViewBar(p: {
  view: StageView;
  pageCount: number;
  onChange: (v: StageView) => void;
}) {
  const { t } = useTranslation();
  const lienId = useId();
  const v = p.view;
  const range = groupRange(p.pageCount, v.group);
  const groups = groupCount(p.pageCount);
  const go = (d: number) => p.onChange({ ...v, group: clampGroup(v.group + d, p.pageCount) });
  return (
    <div className="flex flex-wrap items-center gap-2 max-sm:hidden" data-testid="sign-viewbar">
      <ToggleGroup
        type="single"
        value={v.mode}
        aria-label={t("contracts.docsign.view.label")}
        onValueChange={(m) => m && p.onChange({ ...v, mode: m as ViewMode, group: 0 })}
      >
        <ToggleGroupItem value="page">{t("contracts.docsign.view.page")}</ToggleGroupItem>
        <ToggleGroupItem value="fan">{t("contracts.docsign.view.fan")}</ToggleGroupItem>
      </ToggleGroup>
      {v.mode === "page" && (
        <div className="flex items-center gap-2">
          <Switch
            id={lienId}
            checked={v.lien}
            onCheckedChange={(lien) => p.onChange({ ...v, lien })}
          />
          <Label htmlFor={lienId}>{t("contracts.docsign.view.lien")}</Label>
        </div>
      )}
      {v.mode === "fan" && (
        <>
          <ToggleGroup
            type="single"
            value={v.edge}
            aria-label={t("contracts.docsign.view.edge")}
            onValueChange={(e) => e && p.onChange({ ...v, edge: e as FanEdge })}
          >
            <ToggleGroupItem value="right">{t("contracts.docsign.view.edgeRight")}</ToggleGroupItem>
            <ToggleGroupItem value="bottom">
              {t("contracts.docsign.view.edgeBottom")}
            </ToggleGroupItem>
          </ToggleGroup>
          {groups > 1 && (
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="outline"
                aria-label={t("contracts.docsign.view.prev")}
                disabled={v.group <= 0}
                onClick={() => go(-1)}
              >
                ‹
              </Button>
              <span className="text-sm" data-testid="sign-group-label">
                {t("contracts.docsign.view.group", { from: range.from + 1, to: range.to + 1 })}
              </span>
              <Button
                size="icon"
                variant="outline"
                aria-label={t("contracts.docsign.view.next")}
                disabled={v.group >= groups - 1}
                onClick={() => go(1)}
              >
                ›
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
