// ADM-FR-30 · icon của feature (map tĩnh trong lib/icons.ts); trang trí nên ẩn khỏi trình đọc màn hình.
import { cn } from "@/lib/utils";
import { iconFor } from "../lib/icons";

export function FeatureIcon({ name, className }: { name: string; className?: string }) {
  const Icon = iconFor(name);
  return <Icon aria-hidden className={cn("size-4 shrink-0", className)} />;
}
