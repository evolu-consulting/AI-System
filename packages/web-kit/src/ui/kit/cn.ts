// CR-177 · gộp class Tailwind cho bộ component chung (shadcn): clsx + tailwind-merge.
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
