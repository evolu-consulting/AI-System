// CR-118 bundle · hộp thoại Cài đặt (rất nặng: 5 ngăn + canvas) chỉ nạp khi mở lần đầu; SettingsDialog tự đọc bus khi mount đã mở.
import { lazy, Suspense, useState } from "react";
import { useSettingsOpen } from "../lib/bus";

const Dialog = lazy(() => import("./SettingsDialog").then((m) => ({ default: m.SettingsDialog })));

export function SettingsDialogLazy(props: { owner: boolean; tenantName: string }) {
  const open = useSettingsOpen();
  const [seen, setSeen] = useState(open);
  if (open && !seen) setSeen(true);
  if (!seen) return null;
  return (
    <Suspense fallback={null}>
      <Dialog {...props} />
    </Suspense>
  );
}
