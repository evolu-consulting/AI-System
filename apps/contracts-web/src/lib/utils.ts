// ADM-NFR-06 · helper `cn()` chuẩn shadcn: gộp class, class Tailwind sau thắng class trước.
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
