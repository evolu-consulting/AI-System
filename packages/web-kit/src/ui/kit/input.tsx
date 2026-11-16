// CR-177 · Ô nhập một dòng. aria-invalid ⇒ viền danger; disabled ⇒ nền muted.
import type { ComponentProps } from "react";
import { cn } from "./cn";

export const fieldBase =
  "w-full rounded-md border border-input bg-card px-3 text-md text-foreground outline-none transition-colors duration-[var(--duration-fast)] placeholder:text-placeholder focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground aria-invalid:border-error-border";

export function Input({ className, type = "text", ...props }: ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(fieldBase, "h-[var(--control-md)] max-sm:min-h-11", className)}
      {...props}
    />
  );
}
