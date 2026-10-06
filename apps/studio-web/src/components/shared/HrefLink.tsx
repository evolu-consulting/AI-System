// HUB-FR-72 · liên kết theo đường dẫn nội bộ (có thể kèm query, vd `/agents/new?from=<id>`): href công khai có basepath,
// chuột trái đi qua router (không tải lại trang); mở tab mới/phím bổ trợ vẫn là hành vi trình duyệt.
import { useRouter } from "@tanstack/react-router";
import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { withBase } from "#/lib/env";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { path: string };

export function HrefLink({ path, onClick, ...rest }: Props) {
  const router = useRouter();
  const href = withBase(path);
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    e.preventDefault();
    void router.navigate({ href });
  };
  return <a {...rest} href={href} onClick={handle} />;
}
