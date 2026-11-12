// CR-130 · menu trái của hộp thoại Cài đặt chung: nhóm Sổ Hợp Tác (5 mục, cần gói contracts) + nhóm Bảng tin (Thông báo, cần gói Cộng đồng).
import {
  Bell,
  Building2,
  GitBranch,
  type LucideIcon,
  Search,
  Star,
  TrendingUp,
} from "lucide-react";
import type { ReactNode } from "react";
import type { SettingsNavGroup } from "~/shared/ui/settings-layout";
import { allowedSections } from "../lib/section-key";
import type { SectionId } from "../lib/types";

/** Mục dùng bản nháp chung + nút Lưu chung (công ty, điểm kinh doanh); còn lại lưu riêng. */
export const isDraftSection = (s: SectionId) => s === "co" || s === "biz";
const SECTION_ICON: Record<SectionId, LucideIcon> = {
  co: Building2,
  rep: Star,
  biz: TrendingUp,
  scout: Search,
  flow: GitBranch,
};

export function buildNavGroups(p: {
  hasContracts: boolean;
  hasFeed: boolean;
  /** CR-138 Q6 · không phải chủ sở hữu ⇒ chỉ mục «Quy trình duyệt» (các mục chỉ đọc bị ẩn). Mặc định true. */
  owner?: boolean;
  s: (k: string) => string;
  dot: (k: SectionId) => ReactNode;
}): SettingsNavGroup[] {
  const { s } = p;
  const multi = p.hasContracts && p.hasFeed; // hai nhóm ⇒ có tiêu đề nhóm
  const out: SettingsNavGroup[] = [];
  if (p.hasContracts)
    out.push({
      id: "contracts",
      label: multi ? s("group.contracts") : undefined,
      items: allowedSections(p.owner ?? true).map((k) => ({
        id: k,
        label: s(`sec.${k}`),
        hint: s(`sec.${k}Hint`),
        icon: SECTION_ICON[k],
        badge: p.dot(k),
      })),
    });
  if (p.hasFeed)
    out.push({
      id: "feed",
      label: multi ? s("group.feed") : undefined,
      items: [{ id: "feed", label: s("sec.feed"), hint: s("sec.feedHint"), icon: Bell }],
    });
  return out;
}
