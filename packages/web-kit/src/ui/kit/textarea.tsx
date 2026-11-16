// CR-177 · Ô nhập nhiều dòng, cùng kiểu với Input.
import type { ComponentProps } from "react";
import { cn } from "./cn";
import { fieldBase } from "./input";

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldBase, "min-h-20 resize-y py-2", className)}
      {...props}
    />
  );
}
