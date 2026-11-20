// CR-191 BR-187-6 · icon thao tác của thẻ bài: Sửa / Lưu trữ / Đã xong / Ẩn / Báo cáo / Xoá theo quyền của bài.
// CR-195 BR-195-3 · máy tính: nút icon nhỏ sát nhau (`.ph .acts`); điện thoại (≤ 640px): MỘT nút «⋯» mở menu (kit DropdownMenu), cùng danh sách, cùng testid.
import type { PostAction, PostView } from "@ai/contracts/community";
import { Button } from "@ai/web-kit/ui/kit/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ai/web-kit/ui/kit/dropdown-menu";
import type { ReactNode } from "react";
import { useNarrow } from "../application/useStuck";
import { t } from "../i18n";
import { IconAction } from "./IconAction";
import {
  IconArchive,
  IconCheck,
  IconDots,
  IconEdit,
  IconEyeOff,
  IconFlag,
  IconTrash,
} from "./icons";

export const has = (p: PostView, a: PostAction) => p.actions.includes(a);

type Entry = {
  key: string;
  label: string;
  testId?: string;
  icon: ReactNode;
  run: () => void;
  danger?: boolean;
};

/** Danh sách thao tác theo quyền của bài (thứ tự cố định) — dùng chung cho nút icon và menu «⋯». */
export function postActionEntries(
  p: PostView,
  h: {
    onEdit: () => void;
    onAsk: () => void;
    onDo: (a: "archive" | "unarchive" | "done" | "hide" | "unhide") => void;
    onReport?: (() => void) | undefined;
  },
): Entry[] {
  const out: Entry[] = [];
  const add = (e: Entry) => out.push(e);
  if (has(p, "edit"))
    add({
      key: "edit",
      label: t("community.post.menu.edit"),
      testId: "post-edit",
      icon: <IconEdit size={16} />,
      run: h.onEdit,
    });
  if (has(p, "archive"))
    add({
      key: "archive",
      label: t("community.post.menu.archive"),
      icon: <IconArchive size={16} />,
      run: () => h.onDo("archive"),
    });
  if (has(p, "unarchive"))
    add({
      key: "unarchive",
      label: t("community.post.menu.unarchive"),
      icon: <IconArchive size={16} />,
      run: () => h.onDo("unarchive"),
    });
  if (has(p, "done"))
    add({
      key: "done",
      label:
        p.type === "buy" ? t("community.post.menu.doneBuy") : t("community.post.menu.doneSell"),
      icon: <IconCheck size={16} />,
      run: () => h.onDo("done"),
    });
  if (has(p, "hide"))
    add({
      key: "hide",
      label: t("community.post.menu.hide"),
      testId: "post-hide",
      icon: <IconEyeOff size={16} />,
      run: () => h.onDo("hide"),
    });
  if (has(p, "unhide"))
    add({
      key: "unhide",
      label: t("community.post.menu.unhide"),
      icon: <IconEyeOff size={16} />,
      run: () => h.onDo("unhide"),
    });
  if (h.onReport)
    add({
      key: "report",
      label: t("community.flows.reports.menu"),
      testId: "post-report",
      icon: <IconFlag size={16} />,
      run: h.onReport,
    });
  if (has(p, "delete"))
    add({
      key: "delete",
      label: t("community.post.menu.delete"),
      testId: "post-delete",
      icon: <IconTrash size={16} />,
      run: h.onAsk,
      danger: true,
    });
  return out;
}

export function PostActions(props: {
  onReport?: (() => void) | undefined;
  p: PostView;
  onEdit: () => void;
  onAsk: () => void;
  onDo: (a: "archive" | "unarchive" | "done" | "hide" | "unhide") => void;
}) {
  const narrow = useNarrow();
  const entries = postActionEntries(props.p, props);
  if (narrow)
    return (
      <span className="acts" data-testid="post-acts">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("community.post.more")}
              data-testid="post-more"
            >
              <IconDots size={18} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {entries.map((e) => (
              <DropdownMenuItem
                key={e.key}
                data-testid={e.testId}
                danger={e.danger ?? false}
                onSelect={e.run}
              >
                {e.icon}
                {e.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    );
  return (
    <span className="acts" data-testid="post-acts">
      {entries.map((e) => (
        <IconAction key={e.key} label={e.label} onClick={e.run} testId={e.testId}>
          {e.icon}
        </IconAction>
      ))}
    </span>
  );
}
