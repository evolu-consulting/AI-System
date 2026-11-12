// CR-128 L1: dòng thông tin dưới tiêu đề — các mục cách nhau bằng «·» có khoảng đều (mục rỗng bị bỏ, không để dấu lẻ).
import { Children, Fragment, type ReactNode } from "react";

export function MetaLine({ children }: { children: ReactNode }) {
  const items = Children.toArray(children).filter(Boolean);
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {items.map((it, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: danh sách tĩnh theo thứ tự
        <Fragment key={i}>
          {i > 0 && (
            <span aria-hidden="true" className="text-dim">
              ·
            </span>
          )}
          {it}
        </Fragment>
      ))}
    </span>
  );
}
