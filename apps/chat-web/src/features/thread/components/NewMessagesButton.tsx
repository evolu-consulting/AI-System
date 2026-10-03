// CHAT-AC-07 · nút nổi giữa đáy luồng khi người dùng đã cuộn lên trong lúc stream.
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";

export function NewMessagesButton({ onClick }: { onClick(): void }) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full shadow-md"
      onClick={onClick}
    >
      {t("thread.newMessages")}
    </Button>
  );
}
