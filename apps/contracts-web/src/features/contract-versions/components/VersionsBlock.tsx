// CR-097 K3b: khối "Phiên bản hợp đồng" — v1..vN, mỗi dòng: biểu tượng trạng thái, số HĐ, hiệu lực, giá trị, nút "Xem".
import type { ContractVersionRef } from "@ai/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { viDate, vnd } from "~/components/shared/format";
import { KIND_ICON, versionKind } from "../lib/versions";

export function VersionsBlock({
  currentId,
  versions,
}: {
  currentId: string;
  versions: readonly ContractVersionRef[];
}) {
  const { t } = useTranslation();
  const nav = useNavigate();
  if (versions.length < 2) return null;
  return (
    <section
      data-testid="versions-block"
      className="mb-3 rounded-lg border border-rule bg-panel p-4"
    >
      <h3 className="mb-2 font-semibold">{t("contracts.versions.title")}</h3>
      <ul className="divide-y divide-rule">
        {versions.map((v) => {
          const kind = versionKind(v, versions);
          return (
            <li
              key={v.id}
              data-testid={`version-row-${v.version_no}`}
              data-kind={kind}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm"
            >
              <span className="w-8 font-semibold">v{v.version_no}</span>
              <span>
                {KIND_ICON[kind]} {t(`contracts.versions.kind.${kind}`)}
              </span>
              <span>{v.number ?? "—"}</span>
              <span className="text-dim">
                {viDate(v.effective_from)} – {viDate(v.effective_to)}
              </span>
              <span className="ml-auto tabular-nums">{vnd(v.total_value)}</span>
              {v.id !== currentId && (
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => void nav({ to: "/contracts/$id", params: { id: v.id } })}
                >
                  {t("contracts.versions.view")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
