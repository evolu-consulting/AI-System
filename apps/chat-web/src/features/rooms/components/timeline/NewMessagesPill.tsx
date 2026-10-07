// X2a-AC15 · nút "n tin mới" khi đang cuộn ở trên mà có tin đến; bấm → xuống đáy.
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";

export function NewMessagesPill({ count, onClick }: { count: number; onClick(): void }) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full shadow-md"
      onClick={onClick}
    >
      {t("rooms.newMessages", { count })}
    </Button>
  );
}
