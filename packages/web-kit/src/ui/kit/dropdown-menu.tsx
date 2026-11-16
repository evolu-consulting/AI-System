// CR-177 U3 · DropdownMenu (Radix): mũi tên, Home/End, Esc trả focus về nút mở; mục có trạng thái focus; mục `danger` (đỏ).
import { DropdownMenu as P } from "radix-ui";
import type * as React from "react";
import { cn } from "./cn";

export const DropdownMenu = (props: React.ComponentProps<typeof P.Root>) => (
  <P.Root data-slot="dropdown-menu" {...props} />
);
export const DropdownMenuTrigger = (props: React.ComponentProps<typeof P.Trigger>) => (
  <P.Trigger data-slot="dropdown-menu-trigger" {...props} />
);

export function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-40 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          className,
        )}
        {...props}
      />
    </P.Portal>
  );
}

export function DropdownMenuItem({
  className,
  danger = false,
  ...props
}: React.ComponentProps<typeof P.Item> & { danger?: boolean }) {
  return (
    <P.Item
      data-slot="dropdown-menu-item"
      data-variant={danger ? "danger" : "default"}
      className={cn(
        "relative flex cursor-default items-center gap-2 max-sm:min-h-11 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors duration-[var(--duration-fast)] select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
        danger &&
          "text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive",
        className,
      )}
      {...props}
    />
  );
}

export const DropdownMenuLabel = ({ className, ...p }: React.ComponentProps<typeof P.Label>) => (
  <P.Label
    data-slot="dropdown-menu-label"
    className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className)}
    {...p}
  />
);
export const DropdownMenuSeparator = ({
  className,
  ...p
}: React.ComponentProps<typeof P.Separator>) => (
  <P.Separator
    data-slot="dropdown-menu-separator"
    className={cn("-mx-1 my-1 h-px bg-border", className)}
    {...p}
  />
);

export const DropdownMenuGroup = (props: React.ComponentProps<typeof P.Group>) => (
  <P.Group data-slot="dropdown-menu-group" {...props} />
);
export const DropdownMenuSub = (props: React.ComponentProps<typeof P.Sub>) => (
  <P.Sub data-slot="dropdown-menu-sub" {...props} />
);
export const DropdownMenuSubTrigger = ({
  className,
  ...p
}: React.ComponentProps<typeof P.SubTrigger>) => (
  <P.SubTrigger
    data-slot="dropdown-menu-sub-trigger"
    className={cn(
      "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[state=open]:bg-accent",
      className,
    )}
    {...p}
  />
);
export const DropdownMenuSubContent = ({
  className,
  ...p
}: React.ComponentProps<typeof P.SubContent>) => (
  <P.Portal>
    <P.SubContent
      data-slot="dropdown-menu-sub-content"
      className={cn(
        "z-50 min-w-40 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
        className,
      )}
      {...p}
    />
  </P.Portal>
);
