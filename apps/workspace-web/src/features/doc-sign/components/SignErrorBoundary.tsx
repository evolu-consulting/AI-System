// CR-182 · fix-cr182-ui · lỗi 2: khung màn ký bắt mọi lỗi hiển thị ⇒ câu tiếng Việt + «Tải lại», không bao giờ lộ màn lỗi tiếng Anh của router.
import { Button } from "@ai/web-kit/ui/kit/button";
import { Component, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

export function SignCrashView() {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      data-testid="sign-crash"
      className="flex h-full min-h-screen flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <h1 className="text-base font-semibold">{t("contracts.docsign.crash.title")}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{t("contracts.docsign.crash.body")}</p>
      <Button onClick={() => window.location.reload()}>
        {t("contracts.docsign.crash.reload")}
      </Button>
    </div>
  );
}

type State = { failed: boolean };

export class SignErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false };
  static getDerivedStateFromError(): State {
    return { failed: true };
  }
  override componentDidCatch(e: unknown) {
    console.error("sign-screen", e);
  }
  override render() {
    return this.state.failed ? <SignCrashView /> : this.props.children;
  }
}
