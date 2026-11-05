// CR-097 K3b · UC-04: so sánh hai phiên bản — bảng các trường pháp lý khác nhau.
import type { ContractVersionRef } from "@ai/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { diffKey, fetchVersionDiff } from "../api";
import { defaultPair, diffRows } from "../lib/versions";

export function VersionDiff({
  contractId,
  versions,
}: {
  contractId: string;
  versions: readonly ContractVersionRef[];
}) {
  const { t } = useTranslation();
  const init = defaultPair(versions);
  const [pair, setPair] = useState<[string, string] | null>(init);
  const [a, b] = pair ?? ["", ""];
  const q = useQuery({
    queryKey: diffKey(contractId, a, b),
    queryFn: ({ signal }) => fetchVersionDiff(contractId, a, b, signal),
    enabled: pair !== null && a !== b,
  });
  if (!pair) return null;
  const opt = (v: ContractVersionRef) => (
    <option key={v.id} value={v.id}>
      v{v.version_no}
    </option>
  );
  const rows = q.data ? diffRows(q.data.changes) : [];
  return (
    <section data-testid="version-diff" className="mb-3 rounded-lg border border-rule bg-panel p-4">
      <h3 className="mb-2 font-semibold">{t("contracts.versions.diff.title")}</h3>
      <div className="mb-3 flex items-center gap-2 text-sm">
        <select
          aria-label={t("contracts.versions.diff.from")}
          value={a}
          onChange={(e) => setPair([e.target.value, b])}
        >
          {versions.map(opt)}
        </select>
        <span>→</span>
        <select
          aria-label={t("contracts.versions.diff.to")}
          value={b}
          onChange={(e) => setPair([a, e.target.value])}
        >
          {versions.map(opt)}
        </select>
      </div>
      {q.isError && <p className="text-sm text-late">{t("contracts.versions.diff.failed")}</p>}
      {q.data && rows.length === 0 && (
        <p className="text-sm text-dim">{t("contracts.versions.diff.same")}</p>
      )}
      {rows.length > 0 && (
        <table className="w-full text-sm" data-testid="diff-table">
          <thead>
            <tr className="text-left text-dim">
              <th>{t("contracts.versions.diff.field")}</th>
              <th>v{q.data?.a.version_no}</th>
              <th>v{q.data?.b.version_no}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} data-testid={`diff-${r.key}`}>
                <td className="font-semibold">
                  {t(`contracts.versions.field.${r.key}`, { defaultValue: r.key })}
                </td>
                <td>{r.a}</td>
                <td>{r.b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
