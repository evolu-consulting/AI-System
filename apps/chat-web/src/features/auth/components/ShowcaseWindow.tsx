// CR-052 phương án C · cửa sổ Evolu Copilot mẫu (tĩnh, trang trí): sidebar phòng/agent + hội thoại Lan/Hoa/Ledger + ô soạn.
// Tên Nova/Ledger/Pilot chỉ là minh hoạ, không phải agent thật.
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";
import { RobotAvatar } from "./RobotArt";

const ROW = "rounded-md p-2 text-secondary-foreground";

function SideLabel({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn("px-2 py-1 text-micro font-semibold text-muted-foreground", className)}>
      {text}
    </span>
  );
}

function Sidebar() {
  const { t } = useTranslation();
  return (
    <div className="flex w-[220px] flex-col gap-1 border-r border-border bg-sidebar px-3 py-4 text-label">
      <SideLabel text={t("login.showcase.chats")} />
      <span className="rounded-md bg-accent p-2 font-semibold text-accent-foreground">
        {t("login.showcase.room")}
      </span>
      <span className={ROW}>{t("login.showcase.direct")}</span>
      <span className={ROW}>{t("login.showcase.room2")}</span>
      <SideLabel text={t("login.showcase.agents")} className="pt-3" />
      <span className={ROW}>{t("login.showcase.agent1")}</span>
      <span className={ROW}>{t("login.showcase.agent2")}</span>
      <span className={ROW}>{t("login.showcase.agent3")}</span>
    </div>
  );
}

function Person({
  tone,
  name,
  children,
}: {
  tone: string;
  name: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2.5">
      <span className={cn("size-7 shrink-0 rounded-full", tone)} />
      <div>
        <b>{name}</b>
        <div className="text-secondary-foreground">{children}</div>
      </div>
    </div>
  );
}

function Conversation() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-1 flex-col gap-3.5 p-5 text-label leading-normal">
      <Person tone="bg-chart-4/60" name={t("login.showcase.msg1.author")}>
        {t("login.showcase.msg1.text")}
      </Person>
      <Person tone="bg-chart-5" name={t("login.showcase.msg2.author")}>
        <span className="rounded bg-accent px-1.5 py-px font-semibold text-accent-foreground">
          {t("login.showcase.msg2.mention")}
        </span>{" "}
        {t("login.showcase.msg2.text")}
      </Person>
      <div className="flex gap-2.5">
        <RobotAvatar tip="#fbbf24" />
        <div className="max-w-[380px] rounded-[10px] bg-background px-3 py-2.5">
          <b>{t("login.showcase.reply.author")}</b>{" "}
          <span className="text-micro text-muted-foreground">
            {t("login.showcase.reply.badge")}
          </span>
          <div className="text-secondary-foreground">{t("login.showcase.reply.text")}</div>
        </div>
      </div>
    </div>
  );
}

export function ShowcaseWindow() {
  const { t } = useTranslation();
  return (
    <>
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <div className="flex h-[52px] items-center border-b border-border px-5 text-body font-semibold">
          {t("login.showcase.room")}
        </div>
        <Conversation />
        <div className="mx-5 mb-5 flex h-11 items-center rounded-[10px] border border-input px-3.5 text-label text-muted-foreground">
          {t("login.showcase.composer")}
        </div>
      </div>
    </>
  );
}
