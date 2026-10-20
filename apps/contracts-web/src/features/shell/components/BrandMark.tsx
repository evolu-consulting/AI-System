// nav-v2 · khối nhận diện theo mockup NITI: ô chữ cái đầu tên công ty nền chuyển màu (token `act` → `grad-to`).
import { cn } from "~/lib/utils";

export const initialOf = (name: string | undefined): string =>
  (name?.trim().charAt(0) || "S").toLocaleUpperCase("vi");

export function BrandMark({ name, className }: { name?: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-linear-to-br from-act to-grad-to text-[15px] font-extrabold text-white",
        className,
      )}
    >
      {initialOf(name)}
    </span>
  );
}
