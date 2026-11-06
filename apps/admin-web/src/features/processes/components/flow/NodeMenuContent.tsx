// CR-122 · P8: nội dung menu "Thêm bước" (Cơ bản · Lõi/module · Nâng cao) dùng chung cho nút "+ Thêm bước" (thêm cuối)
// và nút "+" trên cạnh (chèn vào giữa). Chọn một node ⇒ `pick` nhận danh sách {patch, name} (node module có thể nhiều giai đoạn).
import type { AppNodeDecl } from "@ai/contracts/app-manifest";
import { useTranslation } from "react-i18next";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useTr } from "@/lib/use-translate";
import type { StageDraft } from "../../lib/def-form";
import { finishPatch, type NodeEntry, nodesForApp } from "../../lib/flow-def";
import { nodeLabel, nodeToPatches } from "../../lib/palette-node";
import { usePalette } from "../../palette-api";
import { useFlowCtx } from "./flow-ctx";

export type PickedNode = { patch: Partial<StageDraft>; name: string };

/** Nhóm node bảng theo tiền tố khoá (`core.*` ⇒ Lõi, còn lại ⇒ app). */
function groupModules(nodes: readonly AppNodeDecl[]): [string, AppNodeDecl[]][] {
  const out = new Map<string, AppNodeDecl[]>();
  for (const n of nodes) {
    const g = n.key.split(".")[0] ?? "core";
    out.set(g, [...(out.get(g) ?? []), n]);
  }
  return [...out];
}

type Props = { pick: (items: PickedNode[]) => void; room: number; align?: "start" | "center" };

export function NodeMenuContent({ pick, room, align = "start" }: Props) {
  const { t, i18n } = useTranslation();
  const tr = useTr();
  const ctx = useFlowCtx();
  const palette = usePalette(ctx?.app ?? "", ctx?.tenantId);
  if (!ctx) return null;
  const add = (n: NodeEntry) => {
    if (!n.patch) return;
    const patch = n.id === "finish" ? finishPatch(ctx.event) : n.patch;
    pick([{ patch, name: t(`process.admin.flow.node.${n.id}`) }]);
  };
  const addModule = (n: AppNodeDecl) =>
    pick(
      nodeToPatches(n).map((patch, i) => {
        const name = nodeLabel(n, i18n.language);
        return { patch, name: i === 0 ? name : `${name} ${i + 1}` };
      }),
    );
  const groups = groupModules(palette.data ?? []);
  const nodes = nodesForApp(ctx.app);
  return (
    <DropdownMenuContent align={align} className="max-h-96 overflow-y-auto">
      <DropdownMenuLabel>{t("process.admin.flow.group.basic")}</DropdownMenuLabel>
      {nodes
        .filter((n) => n.id !== "set")
        .map((n) => (
          <DropdownMenuItem
            key={n.id}
            data-testid={`flow-node-${n.id}`}
            disabled={!n.patch}
            onSelect={() => add(n)}
          >
            {t(`process.admin.flow.node.${n.id}`)}
          </DropdownMenuItem>
        ))}
      {groups.map(([g, list]) => (
        <div key={g}>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>
            {g === "core" ? t("process.admin.flow.group.core") : tr(`featmeta.app.${g}.name`)}
          </DropdownMenuLabel>
          {list.map((n) => (
            <DropdownMenuItem
              key={n.key}
              data-testid={`flow-node-${n.key}`}
              disabled={room < n.stages.length}
              onSelect={() => addModule(n)}
            >
              {nodeLabel(n, i18n.language)}
            </DropdownMenuItem>
          ))}
        </div>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuLabel>{t("process.admin.flow.group.advanced")}</DropdownMenuLabel>
      {nodes
        .filter((n) => n.id === "set")
        .map((n) => (
          <DropdownMenuItem key={n.id} data-testid={`flow-node-${n.id}`} onSelect={() => add(n)}>
            {t(`process.admin.flow.node.${n.id}`)}
          </DropdownMenuItem>
        ))}
    </DropdownMenuContent>
  );
}
