// CR-180 · «Sơ đồ tổ chức» trên điện thoại: danh sách cây phòng ban lồng nhau (thụt lề), mỗi dòng ≥ 44px:
// tên phòng · trưởng phòng · số người. Bấm ⇒ mở thành viên như bấm thẻ trên sơ đồ.
import { Button } from "@ai/web-kit/ui/kit/button";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";
import { flattenOrg, headcount, type OrgNode } from "../lib/org-tree";

export function OrgTreeList({
  tree,
  highlightIds = [],
  onSelectDept,
}: {
  tree: readonly OrgNode[];
  highlightIds?: readonly string[];
  onSelectDept: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <ul
      data-testid="org-tree-list"
      className="m-0 list-none rounded-xl border border-rule bg-panel p-0"
    >
      {flattenOrg(tree).map(({ node, depth }) => (
        <li
          key={node.id}
          className="border-b border-rule-soft last:border-0"
          style={{ paddingLeft: Math.min(depth, 5) * 16 }}
        >
          <Button
            variant="ghost"
            data-testid={`org-node-${node.id}`}
            data-depth={depth}
            className={cn(
              "h-auto min-h-11 w-full justify-start gap-3 rounded-none px-4 py-2.5 text-left font-normal",
              highlightIds.includes(node.id) && "bg-act-soft",
            )}
            onClick={() => onSelectDept(node.id)}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold text-ink">{node.name}</span>
              <span className="block text-sm text-dim">
                {node.head?.name ?? t("contracts.orgChart.noHead")}
              </span>
            </span>
            <span className="tnum shrink-0 text-sm text-dim">
              {t("contracts.orgChart.people", { count: headcount(node) })}
            </span>
          </Button>
        </li>
      ))}
    </ul>
  );
}
