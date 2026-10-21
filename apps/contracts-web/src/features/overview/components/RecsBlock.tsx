// V2-N · "Sản phẩm: nên làm gì" (mockup `recPanel`): SP có điểm kinh doanh (V2-J1 `GET /business/products`) chia 3 cột theo đề xuất.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { ErrorLine, Loading } from "~/components/shared/states";
import { Tag } from "~/components/shared/tag";
import { useBizProducts } from "~/features/products/hooks/use-business";
import { suggestColumns } from "../lib/overview";
import { BlockHead } from "./BlockHead";

export function RecsBlock() {
  const { t } = useTranslation();
  const q = useBizProducts();
  const cols = suggestColumns(q.data?.items);
  return (
    <Panel>
      <BlockHead
        title={t("contracts.overview.recs.title")}
        meta={t("contracts.overview.recs.lead")}
      />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorLine error={q.error} />
      ) : (
        <div className="grid grid-cols-3 gap-3 p-4 max-sm:grid-cols-1" data-testid="recs">
          {cols.map((c) => (
            <div key={c.key} data-col={c.key}>
              <div className="mb-1.5 flex items-center gap-2">
                <Tag tone={c.tone}>{t(`contracts.overview.recs.${c.key}`)}</Tag>
                <span className="text-label text-dim">{c.rows.length}</span>
              </div>
              {c.rows.length === 0 ? (
                <p className="py-1.5 text-label text-dim">{t("contracts.overview.recs.none")}</p>
              ) : (
                c.rows.map((p) => (
                  <Link
                    key={p.id}
                    to="/products"
                    search={{ sp: p.id }}
                    className="flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-sunk"
                  >
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-body">{p.name}</b>
                      <span className="block truncate text-[12px] text-dim">
                        {p.business.reason}
                      </span>
                    </span>
                    <b className="tnum">{p.business.score}</b>
                  </Link>
                ))
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
