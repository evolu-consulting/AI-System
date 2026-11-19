// CR-142 · thân «Sơ đồ tổ chức»: ô tìm (chọn ⇒ nhảy tới phòng + làm nổi thẻ), sơ đồ cây, hộp thành viên khi bấm thẻ phòng.
// CR-180 · điện thoại (≤ 640px): danh sách cây thay canvas (tìm ⇒ lọc cây); desktop giữ canvas.

import type { ContractsOrgDept } from "@ai/contracts/pack-contracts";
import { searchDepts } from "@ai/flow-canvas/pure";
import { Button } from "@ai/web-kit/ui/kit/button";
import { Input } from "@ai/web-kit/ui/kit/input";
import { useDeferredValue, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toChartDepts } from "../lib/org-chart-data";
import { buildOrgTree, type OrgNode } from "../lib/org-tree";
import { DeptMembersDialog } from "./DeptMembersDialog";
import { OrgChartLazy } from "./OrgChartLazy";

function indexById(tree: readonly OrgNode[]): Map<string, OrgNode> {
  const m = new Map<string, OrgNode>();
  const walk = (n: OrgNode) => {
    m.set(n.id, n);
    n.children.forEach(walk);
  };
  tree.forEach(walk);
  return m;
}

export function OrgChartBody({ departments }: { departments: readonly ContractsOrgDept[] }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const [openId, setOpenId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ id: string; seq: number } | null>(null);
  const depts = useMemo(() => toChartDepts(departments), [departments]);
  const tree = useMemo(() => buildOrgTree(departments), [departments]);
  const byId = useMemo(() => indexById(tree), [tree]);
  const matches = useMemo(() => searchDepts(depts, deferred), [depts, deferred]);
  const labels = useMemo(
    () => ({
      noHead: t("contracts.orgChart.noHead"),
      people: (count: number) => t("contracts.orgChart.people", { count }),
      peopleTotal: (count: number) => t("contracts.orgChart.peopleTotal", { count }),
      canvas: t("contracts.orgChart.chart"),
      controls: {
        title: t("contracts.orgChart.controls"),
        zoomIn: t("contracts.orgChart.zoomIn"),
        zoomOut: t("contracts.orgChart.zoomOut"),
        fit: t("contracts.orgChart.fit"),
      },
    }),
    [t],
  );
  const jump = (id: string | undefined) => {
    if (id) setFocus((f) => ({ id, seq: (f?.seq ?? 0) + 1 }));
  };
  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <label className="sr-only" htmlFor="org-search">
          {t("contracts.orgChart.search")}
        </label>
        <Input
          id="org-search"
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            jump(searchDepts(depts, e.target.value)[0]);
          }}
          onKeyDown={(e) => {
            // Enter = phòng khớp kế tiếp
            if (e.key !== "Enter" || matches.length === 0) return;
            jump(matches[(matches.indexOf(focus?.id ?? "") + 1) % matches.length]);
          }}
          placeholder={t("contracts.orgChart.search")}
          className="w-full sm:h-10 sm:max-w-sm"
        />
        {query ? (
          <Button variant="quiet" onClick={() => setQuery("")}>
            {t("contracts.orgChart.clear")}
          </Button>
        ) : null}
      </div>
      {deferred.trim() && matches.length === 0 ? (
        <p className="mb-2 text-sm text-dim" data-testid="org-no-match">
          {t("contracts.orgChart.noMatch", { q: deferred })}
        </p>
      ) : null}
      {/* Sơ đồ ở mọi cỡ màn — phóng to/thu nhỏ/kéo được (người dùng chốt 2026-11-16, bỏ dạng danh sách trên điện thoại). */}
      <OrgChartLazy
        depts={depts}
        rootName={t("contracts.orgChart.company")}
        labels={labels}
        highlightIds={matches}
        focus={focus}
        onSelectDept={setOpenId}
      />
      <DeptMembersDialog
        dept={openId ? (byId.get(openId) ?? null) : null}
        onClose={() => setOpenId(null)}
      />
    </>
  );
}
