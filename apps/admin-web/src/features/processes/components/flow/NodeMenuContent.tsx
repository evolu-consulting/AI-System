// CR-122 · P8 · CR-123 FR-12: nội dung menu "Thêm bước" dùng chung cho nút "+ Thêm bước" (thêm cuối) và nút "+" trên cạnh (chèn giữa).
// Công ty chỉ thấy bước nghiệp vụ (Duyệt, Nếu, Ký số, Chờ ký xong, Thông báo, Kết thúc); mục "Nâng cao" chỉ quản trị nền tảng thấy
// (logic chia ở `lib/node-menu`). Chọn một node ⇒ `pick` nhận danh sách {patch, name} (node module có thể nhiều bước).
import type { AppNodeDecl } from "@ai/contracts/app-manifest";
import { useTranslation } from "react-i18next";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useSession } from "@/lib/auth/use-session";
import type { StageDraft } from "../../lib/def-form";
import { finishPatch, type NodeEntry, nodesForApp } from "../../lib/flow-def";
import { type MenuItem, splitMenu } from "../../lib/node-menu";
import { nodeLabel, nodeToPatches } from "../../lib/palette-node";
import { usePalette } from "../../palette-api";
import { useFlowCtx } from "./flow-ctx";

export type PickedNode = { patch: Partial<StageDraft>; name: string };

type Props = { pick: (items: PickedNode[]) => void; room: number; align?: "start" | "center" };

export function NodeMenuContent({ pick, room, align = "start" }: Props) {
  const { t, i18n } = useTranslation();
  const ctx = useFlowCtx();
  const isPlatform = useSession((s) => s.me?.role) === "platform_admin";
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
  const { business, advanced } = splitMenu({
    app: ctx.app,
    isPlatform,
    table: nodesForApp(ctx.app),
    modules: palette.data ?? [],
  });
  const item = (m: MenuItem) =>
    m.kind === "table" ? (
      <DropdownMenuItem
        key={m.entry.id}
        data-testid={`flow-node-${m.entry.id}`}
        disabled={!m.entry.patch}
        onSelect={() => add(m.entry)}
      >
        {t(`process.admin.flow.node.${m.entry.id}`)}
      </DropdownMenuItem>
    ) : (
      <DropdownMenuItem
        key={m.node.key}
        data-testid={`flow-node-${m.node.key}`}
        disabled={room < m.node.stages.length}
        onSelect={() => addModule(m.node)}
      >
        {nodeLabel(m.node, i18n.language)}
      </DropdownMenuItem>
    );
  return (
    <DropdownMenuContent align={align} className="max-h-96 overflow-y-auto">
      {business.map(item)}
      {advanced.length > 0 ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{t("process.admin.flow.group.advanced")}</DropdownMenuLabel>
          {advanced.map(item)}
        </>
      ) : null}
    </DropdownMenuContent>
  );
}
