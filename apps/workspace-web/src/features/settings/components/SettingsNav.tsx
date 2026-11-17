// CR-130 · menu trái của hộp thoại Cài đặt chung: nhóm Sổ Hợp Tác (6 mục, cần gói contracts) + nhóm Bảng tin (Thông báo, cần gói Cộng đồng).
import {
  Bell,
  Building2,
  FileSignature,
  GitBranch,
  type LucideIcon,
  PenLine,
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
  sign: FileSignature,
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
  // CR-181 · luôn có nhóm «Chung» ⇒ luôn ≥ 2 nhóm ⇒ mọi nhóm đều có tiêu đề.
  const out: SettingsNavGroup[] = [];
  if (p.hasContracts)
    out.push({
      id: "contracts",
      label: s("group.contracts"),
      items: allowedSections(p.owner ?? true).map((k) => ({
        id: k,
        label: s(`sec.${k}`),
        hint: s(`sec.${k}Hint`),
        icon: SECTION_ICON[k],
        badge: p.dot(k),
      })),
    });
  // CR-181 · nhóm «Chung» (dùng chung mọi app): mục «Chữ ký», mọi thành viên xem được.
  out.push({
    id: "common",
    label: s("group.common"),
    items: [
      { id: "signature", label: s("sec.signature"), hint: s("sec.signatureHint"), icon: PenLine },
    ],
  });
  if (p.hasFeed)
    out.push({
      id: "feed",
      label: s("group.feed"),
      items: [{ id: "feed", label: s("sec.feed"), hint: s("sec.feedHint"), icon: Bell }],
    });
  return out;
}
