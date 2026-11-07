// CR-122 · P8 · CR-123 FR-12: nội dung menu "Thêm bước" dùng chung cho nút "+ Thêm bước" (thêm cuối) và nút "+" trên cạnh (chèn giữa).
// Công ty chỉ thấy bước nghiệp vụ (Duyệt, Nếu, Ký số, Chờ ký xong, Thông báo, Kết thúc); mục "Nâng cao" chỉ quản trị nền tảng thấy
// (logic chia ở `lib/node-menu`). Chọn một node ⇒ `pick` nhận danh sách {patch, name} (node module có thể nhiều bước).
import type { AppNodeDecl } from "@ai/contracts/app-manifest";
import { startOutputsOf } from "@ai/contracts/app-manifest";
import { FLOW_PALETTE_MIME } from "@ai/flow-canvas/pure";
import { useTranslation } from "react-i18next";
import { notifyInfo } from "@/components/shared/toast";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useSession } from "@/lib/auth/use-session";
import { autoBindNode, mapSources } from "../../lib/auto-bind";
import type { StageDraft } from "../../lib/def-form";
import { finishPatch, type NodeEntry, nodesForApp } from "../../lib/flow-def";
import { type MenuItem, splitMenu } from "../../lib/node-menu";
import { nodeLabel, nodeToPatches } from "../../lib/palette-node";
import { usePalette } from "../../palette-api";
import { useFlowCtx } from "./flow-ctx";

export type PickedNode = { patch: Partial<StageDraft>; name: string };

type Props = {
  pick: (items: PickedNode[]) => void;
  room: number;
  align?: "start" | "center";
  /** CR-123 · p25 · bật kéo thả: mỗi mục kéo được vào sơ đồ (thả trống = thêm vào cột, thả lên cạnh = chèn giữa); `onEnd` đóng menu. */
  drag?: { onEnd: () => void };
};

export function NodeMenuContent({ pick, room, align = "start", drag }: Props) {
  const { t, i18n } = useTranslation();
  const ctx = useFlowCtx();
  const isPlatform = useSession((s) => s.me?.role) === "platform_admin";
  const palette = usePalette(ctx?.app ?? "", ctx?.tenantId);
  if (!ctx) return null;
  const tableItems = (n: NodeEntry): PickedNode[] => {
    if (!n.patch) return [];
    const patch = n.id === "finish" ? finishPatch(ctx.event) : n.patch;
    return [{ patch, name: t(`process.admin.flow.node.${n.id}`) }];
  };
  const lang = i18n.language === "vi" ? ("vi" as const) : ("en" as const);
  const byKey = new Map((palette.data ?? []).map((n) => [n.key, n]));
  /** CR-125 · m4 · tự nối đầu vào có đúng một nguồn; đầu vào còn lại ⇒ câu nghiệp vụ (chỉ khi thật sự chọn, không khi vẽ menu). */
  const bound = (n: AppNodeDecl) =>
    autoBindNode(
      n,
      nodeToPatches(n),
      mapSources(startOutputsOf(ctx.event), ctx.nodeKeys ?? [], byKey),
      lang,
    );
  const moduleItems = (n: AppNodeDecl): PickedNode[] =>
    bound(n).patches.map((patch, i) => {
      const name = nodeLabel(n, i18n.language);
      return { patch, name: i === 0 ? name : `${name} ${i + 1}` };
    });
  /** Thuộc tính kéo của một mục menu (chỉ khi bật `drag` và mục không bị tắt). */
  const dragProps = (items: PickedNode[], disabled: boolean, fresh = false) =>
    drag && !disabled && items.length > 0
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            // node thả mới đặt tên mặc định "Bước duyệt mới" ⇒ người dùng thấy cần đặt tên lại (CR-123 · u11)
            const named = fresh
              ? items.map((i) => ({
                  ...i,
                  name: t("process.admin.canvas.free.newName", { label: i.name.toLowerCase() }),
                }))
              : items;
            e.dataTransfer.setData(FLOW_PALETTE_MIME, JSON.stringify(named));
            e.dataTransfer.effectAllowed = "copy";
          },
          onDragEnd: drag.onEnd,
        }
      : {};
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
        onSelect={() => pick(tableItems(m.entry))}
        {...dragProps(tableItems(m.entry), !m.entry.patch, true)}
      >
        {t(`process.admin.flow.node.${m.entry.id}`)}
      </DropdownMenuItem>
    ) : (
      <DropdownMenuItem
        key={m.node.key}
        data-testid={`flow-node-${m.node.key}`}
        disabled={room < m.node.stages.length}
        onSelect={() => {
          for (const q of bound(m.node).asks) notifyInfo(q);
          pick(moduleItems(m.node));
        }}
        {...dragProps(moduleItems(m.node), room < m.node.stages.length)}
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
      {drag ? (
        <>
          <DropdownMenuSeparator />
          <p className="px-2 py-1 text-caption text-muted-foreground">
            {t("process.admin.flow.dragHint")}
          </p>
        </>
      ) : null}
    </DropdownMenuContent>
  );
}
