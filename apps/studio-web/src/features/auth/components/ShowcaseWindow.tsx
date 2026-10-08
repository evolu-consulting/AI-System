// CR-052 phương án C · cửa sổ Agent Forge mẫu (tĩnh, trang trí): sidebar + 3 thẻ agent + thẻ "Editing Ledger" có stepper 5 bước.
// Tên Nova/Ledger/Pilot chỉ là minh hoạ, không phải agent thật.
import { useTranslation } from "react-i18next";
import { cn } from "#/lib/utils";
import { RobotAvatar } from "./RobotArt";

const NAV = ["agents", "orchestrator", "catalog"] as const;
const AGENTS = [
  { n: 1, tip: "#67e8f9", selected: false },
  { n: 2, tip: "#fbbf24", selected: true },
  { n: 3, tip: "#f472b6", selected: false },
] as const;
const STEPS = [1, 2, 3, 4, 5] as const;
const DONE_UNTIL = 2;

function AgentCard({ n, tip, selected }: (typeof AGENTS)[number]) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl p-3.5",
        selected ? "border-2 border-primary p-[13px]" : "border border-border",
      )}
    >
      <RobotAvatar tip={tip} size={36} />
      <b className="text-body">{t(`login.showcase.agent${n}.name`)}</b>
      <span className="self-start rounded-full bg-accent px-2 py-0.5 text-micro text-accent-foreground">
        {t(`login.showcase.agent${n}.tag`)}
      </span>
    </div>
  );
}

function Step({ n }: { n: (typeof STEPS)[number] }) {
  const { t } = useTranslation();
  const done = n <= DONE_UNTIL;
  const current = n === DONE_UNTIL + 1;
  return (
    <>
      {n > 1 ? (
        <span
          className={cn(
            "h-0.5 flex-1",
            n <= DONE_UNTIL ? "bg-primary" : n === DONE_UNTIL + 1 ? "bg-chart-4/60" : "bg-border",
          )}
        />
      ) : null}
      <span
        className={cn(
          "inline-flex size-[22px] items-center justify-center rounded-full",
          done && "bg-primary text-primary-foreground",
          current && "bg-accent text-accent-foreground",
          !done && !current && "bg-muted text-muted-foreground",
        )}
      >
        {n}
      </span>
      <span className={done ? undefined : "text-muted-foreground"}>
        {t(`login.showcase.step${n}`)}
      </span>
    </>
  );
}

export function ShowcaseWindow() {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex w-[200px] flex-col gap-1 border-r border-border bg-sidebar px-3 py-4 text-label">
        {NAV.map((k, i) => (
          <span
            key={k}
            className={cn(
              "rounded-md p-2",
              i === 0
                ? "bg-accent font-semibold text-accent-foreground"
                : "text-secondary-foreground",
            )}
          >
            {t(`login.showcase.nav.${k}`)}
          </span>
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-[18px] px-6 py-5">
        <div className="flex items-center justify-between">
          <span className="text-card-title font-semibold">{t("login.showcase.heading")}</span>
          <span className="rounded-lg bg-primary px-3 py-[7px] text-label font-semibold text-primary-foreground">
            {t("login.showcase.newAgent")}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {AGENTS.map((a) => (
            <AgentCard key={a.n} {...a} />
          ))}
        </div>
        <div className="flex flex-col gap-3.5 rounded-xl border border-border p-4">
          <span className="text-body font-semibold">{t("login.showcase.editing")}</span>
          <div className="flex items-center gap-2 text-caption">
            {STEPS.map((n) => (
              <Step key={n} n={n} />
            ))}
          </div>
          <div className="flex flex-col gap-2">
            {["w-[70%]", "w-[55%]", "w-[62%]"].map((w) => (
              <span key={w} className={cn("h-2.5 rounded bg-accent", w)} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
