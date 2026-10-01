// ADM-FR-30 · D8 · bộ icon feature chọn sẵn (map tĩnh, tree-shake; không nạp cả bộ lucide). Giá trị lạ → `package`.
import {
  BookOpen,
  Calculator,
  ChartBar,
  Database,
  FileText,
  FlaskConical,
  Globe,
  Languages,
  type LucideIcon,
  Mail,
  MessageSquare,
  Package,
  Search,
  Settings,
  Shield,
  Users,
  Zap,
} from "lucide-react";

export const FEATURE_ICONS = {
  package: Package,
  calculator: Calculator,
  languages: Languages,
  "file-text": FileText,
  "bar-chart": ChartBar,
  flask: FlaskConical,
  users: Users,
  shield: Shield,
  mail: Mail,
  "message-square": MessageSquare,
  globe: Globe,
  database: Database,
  settings: Settings,
  search: Search,
  zap: Zap,
  "book-open": BookOpen,
} as const satisfies Record<string, LucideIcon>;

export type FeatureIconName = keyof typeof FEATURE_ICONS;
export const FEATURE_ICON_NAMES = Object.keys(FEATURE_ICONS) as FeatureIconName[];

export function iconFor(name: string): LucideIcon {
  return (FEATURE_ICONS as Record<string, LucideIcon>)[name] ?? Package;
}
