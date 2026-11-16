// #269 · ô chọn công ty nhận bài: tìm theo tên ở máy chủ + «Xem thêm» (50 công ty/lần), không tải cả danh sách.

import type { PartnerOrg } from "@ai/contracts/community";
import { Input } from "@ai/web-kit/ui/kit/input";
import { useEffect, useState } from "react";
import { useApp } from "../application/ctx";
import { t } from "../i18n";

const PAGE = 50;

export function CompanyPicker({
  selected,
  onToggle,
}: {
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const { api } = useApp();
  const [q, setQ] = useState("");
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
      <Input
        type="search"
        data-testid="company-search"
        placeholder={t("community.audience.companySearch")}
        aria-label={t("community.audience.companySearch")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="chips">
        {shown.map((p) => (
          <button
            key={p.id}
            type="button"
            className={selected.includes(p.id) ? "chip on" : "chip"}
            aria-pressed={selected.includes(p.id)}
            onClick={() => onToggle(p.id)}
          >
            {p.name}
          </button>
        ))}
        {shown.length === 0 && !more && (
          <span className="muted">{t("community.audience.companyNone")}</span>
        )}
      </div>
      {more && (
        <button
          type="button"
          className="btn btn-sm"
          data-testid="company-more"
          disabled={busy}
          onClick={loadMore}
        >
          {t("community.audience.companyMore")}
        </button>
      )}
    </div>
  );
}
