// CR-186 · MỘT dòng «Nhắc: A, B» dùng chung cho bài đăng (CR-145) và bình luận; rỗng/vắng ⇒ không vẽ gì.
import { t } from "../i18n";

export function MentionedLine({
  users,
  testId,
}: {
  users: readonly { name: string }[] | undefined;
  testId: string;
}) {
  if (!users || users.length === 0) return null;
  return (
    <p className="pmentions" data-testid={testId}>
      {t("community.draft.mentionShown", { names: users.map((m) => m.name).join(", ") })}
    </p>
  );
}
