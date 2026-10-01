// ADM-FR-03 · bố cục ngoài khung (mẫu D): thẻ ở giữa, dùng cho login/đổi mật khẩu bắt buộc/member/404 chưa đăng nhập.
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";

type Props = { children: ReactNode; width?: "narrow" | "wide" };

export function BareLayout({ children, width = "narrow" }: Props) {
  return (
    <div className="grid min-h-screen place-items-center bg-background p-4">
      <main
        id="main"
        className={`w-full rounded-xl border border-border bg-card p-8 shadow-dialog ${width === "wide" ? "max-w-[480px]" : "max-w-[400px]"}`}
      >
        {children}
      </main>
      <Toaster position="bottom-right" />
    </div>
  );
}
