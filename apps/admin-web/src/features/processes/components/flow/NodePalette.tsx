// CR-122 · U2d · FLOW2-FR-15/25: MỘT nút "+ Thêm bước" mở danh sách node theo nhóm (Lõi · từng ứng dụng) thay cho hàng 13 nút.
// Node dựng sẵn (Duyệt, Điền thông tin, Nếu, Agent, Công cụ, Ghi giá trị, Kết thúc) + node lõi/module từ `GET /process-palette`.
// Chèn node bảng ghi `stage.node`; mỗi stage mẫu thành một bước mới cuối.
import type { AppNodeDecl } from "@ai/contracts/app-manifest";
import { LayoutTemplate, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTr } from "@/lib/use-translate";
import type { StageOps } from "../../hooks/use-stage-ops";
import { finishPatch, type NodeEntry, nodesForApp } from "../../lib/flow-def";
import { nodeLabel, nodeToPatches } from "../../lib/palette-node";
import { usePalette } from "../../palette-api";
import { useFlowCtx } from "./flow-ctx";

type Props = { ops: StageOps; count: number; max: number };

/** Có ngữ cảnh flow ⇒ bảng node theo manifest; không ⇒ thanh công cụ giai đoạn thường (children). */
export function FlowToolbar({
  children,
  ...p
}: Props & { children: React.ReactNode }): React.ReactNode {
  return useFlowCtx() ? <NodePalette {...p} /> : children;
}

/** Nhóm node bảng theo tiền tố khoá (`core.*` ⇒ Lõi, còn lại ⇒ app). */
function groupModules(nodes: readonly AppNodeDecl[]): [string, AppNodeDecl[]][] {
  const out = new Map<string, AppNodeDecl[]>();
  for (const n of nodes) {
    const g = n.key.split(".")[0] ?? "core";
    out.set(g, [...(out.get(g) ?? []), n]);
  }
  return [...out];
}

export function NodePalette({ ops, count, max }: Props) {
  const { t, i18n } = useTranslation();
  const tr = useTr();
  const ctx = useFlowCtx();
  const palette = usePalette(ctx?.app ?? "", ctx?.tenantId);
  if (!ctx) return null;
  const full = count >= max;
  const room = max - count;
  const add = (n: NodeEntry) => {
    if (!n.patch) return;
    const patch = n.id === "finish" ? finishPatch(ctx.event) : n.patch;
    ops.addNode(patch, t(`process.admin.flow.node.${n.id}`));
  };
  const addModule = (n: AppNodeDecl) =>
    nodeToPatches(n).forEach((patch, i) => {
      const name = nodeLabel(n, i18n.language);
      ops.addNode(patch, i === 0 ? name : `${name} ${i + 1}`);
    });
  const groups = groupModules(palette.data ?? []);
  return (
    <div className="flex flex-wrap items-center gap-2 scroll-mt-40" data-testid="flow-palette">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="sm" disabled={full} data-testid="flow-add-step">
            <Plus aria-hidden className="size-4" />
            {t("process.admin.flow.add")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-96 overflow-y-auto">
          <DropdownMenuLabel>{t("process.admin.flow.group.basic")}</DropdownMenuLabel>
          {nodesForApp(ctx.app)
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
          {groups.map(([g, nodes]) => (
            <div key={g}>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>
                {g === "core" ? t("process.admin.flow.group.core") : tr(`featmeta.app.${g}.name`)}
              </DropdownMenuLabel>
              {nodes.map((n) => (
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
          {nodesForApp(ctx.app)
            .filter((n) => n.id === "set")
            .map((n) => (
              <DropdownMenuItem
                key={n.id}
                data-testid={`flow-node-${n.id}`}
                onSelect={() => add(n)}
              >
                {t(`process.admin.flow.node.${n.id}`)}
              </DropdownMenuItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button type="button" variant="ghost" size="sm" onClick={ops.arrange}>
        <LayoutTemplate aria-hidden className="size-4" />
        {t("process.admin.canvas.toolbar.arrange")}
      </Button>
      {full ? (
        <span className="text-caption text-muted-foreground">
          {t("process.admin.canvas.err.stagesMax")}
        </span>
      ) : null}
    </div>
  );
}
