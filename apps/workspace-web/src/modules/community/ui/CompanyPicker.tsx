// CR-195 BR-195-8: danh sách có ô chọn (ô tìm nằm ở hộp chọn).
// #269 · ô chọn công ty nhận bài: tìm theo tên ở máy chủ + «Xem thêm» (50 công ty/lần), không tải cả danh sách.

import type { PartnerOrg } from "@ai/contracts/community";
import { Button } from "@ai/web-kit/ui/kit/button";
import { Checkbox } from "@ai/web-kit/ui/kit/checkbox";
import { useEffect, useState } from "react";
import { useApp } from "../application/ctx";
import { t } from "../i18n";

const PAGE = 50;

export function CompanyPicker({
  q,
  selected,
  onToggle,
}: {
  q: string;
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const { api } = useApp();
  const [list, setList] = useState<PartnerOrg[]>([]);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    api.listPartners({ q, limit: PAGE, offset: 0 }).then(
      (r) => {
        if (!live) return;
        setList(r);
        setMore(r.length === PAGE);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [api, q]);
  const loadMore = () => {
    if (busy) return;
    setBusy(true);
    api
      .listPartners({ q, limit: PAGE, offset: list.length })
      .then((r) => {
        setList((cur) => [...cur, ...r]);
        setMore(r.length === PAGE);
      })
      .finally(() => setBusy(false));
  };
  const shown = list.filter((p) => !p.left);
  return (
    <div className="companypick">
      <ul className="companyrows">
        {shown.map((p) => (
          <li key={p.id}>
            <div className="companyrow">
              <Checkbox
                id={`co-${p.id}`}
                checked={selected.includes(p.id)}
                onCheckedChange={() => onToggle(p.id)}
              />
              <label htmlFor={`co-${p.id}`}>{p.name}</label>
            </div>
          </li>
        ))}
        {shown.length === 0 && !more && (
          <li className="muted">{t("community.audience.companyNone")}</li>
        )}
      </ul>
      {more && (
        <Button
          variant="quiet"
          size="sm"
          data-testid="company-more"
          disabled={busy}
          onClick={loadMore}
        >
          {t("community.audience.companyMore")}
        </Button>
      )}
    </div>
  );
}
