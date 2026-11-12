// CR-120 · Yêu cầu tham gia: đối tác gửi form (một công ty một yêu cầu chờ); người duyệt xem danh sách, duyệt/từ chối kèm lý do.
import type { JoinRequest } from "@ai/contracts/community";
import { PARTNER_LABELS } from "@ai/contracts/community";
import { useState } from "react";
import { useApp } from "../../application/ctx";
import { isConflict } from "../../domain/flows";
import { approveErrorKey } from "../../domain/join-approve";
import { t } from "../../i18n";
import { JoinApprove } from "./JoinApprove";
import { FlowPage, ListState, ReasonDialog, useFlowList } from "./parts";

const TONE: Record<JoinRequest["status"], string> = {
  pending: "tag soon sm",
  approved: "tag ok sm",
  rejected: "tag late sm",
};

function JoinForm() {
  const { api, toast } = useApp();
  const [f, setF] = useState({ company: "", contact: "", email: "", reason: "" });
  const [labels, setLabels] = useState<(typeof PARTNER_LABELS)[number][]>([]);
  const [sent, setSent] = useState<JoinRequest | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    if (!f.company.trim() || !f.contact.trim() || !f.email.includes("@"))
      return setErr(t("community.flows.join.invalid"));
    try {
      setSent(await api.flows.createJoin({ ...f, labels }));
      setErr(null);
      toast(t("community.flows.join.sentToast"));
    } catch (e) {
      setErr(
        t(isConflict(e) ? "community.flows.join.duplicate" : "community.flows.common.submitError"),
      );
    }
  };
  if (sent)
    return (
      <div className="card pcard" data-testid="join-sent">
        <h2>{t("community.flows.join.sentTitle", { company: sent.company })}</h2>
        <p className="muted">{t("community.flows.join.sentWhy")}</p>
      </div>
    );
  return (
    <section className="card pcard" data-testid="join-form">
      <h2>{t("community.flows.join.formTitle")}</h2>
      <div className="composer">
        {(["company", "contact", "email"] as const).map((k) => (
          <label key={k}>
            <b>{t(`community.flows.join.${k}`)}</b>
            <input className="field" value={f[k]} data-testid={`join-${k}`} onChange={set(k)} />
          </label>
        ))}
        <label>
          <b>{t("community.flows.join.reason")}</b>
          <textarea
            className="field"
            rows={3}
            value={f.reason}
            data-testid="join-reason"
            onChange={set("reason")}
          />
        </label>
        <fieldset className="chips">
          {PARTNER_LABELS.map((l) => (
            <button
              key={l}
              type="button"
              className={labels.includes(l) ? "chip on" : "chip"}
              aria-pressed={labels.includes(l)}
              onClick={() =>
                setLabels(labels.includes(l) ? labels.filter((x) => x !== l) : [...labels, l])
              }
            >
              {t(`community.profile.label${l === "supplier" ? "Supplier" : "Buyer"}`)}
            </button>
          ))}
        </fieldset>
        {err && (
          <p className="muted" role="alert" data-testid="join-error">
            {err}
          </p>
        )}
        <div className="cbar">
          <div className="sp" />
          <button type="button" className="primary sm" data-testid="join-submit" onClick={submit}>
            {t("community.flows.join.submit")}
          </button>
        </div>
      </div>
    </section>
  );
}

function JoinReview() {
  const { api, toast, bump } = useApp();
  const list = useFlowList(() => api.flows.listJoins(false));
  const [rejecting, setRejecting] = useState<JoinRequest | null>(null);
  const decide = async (
    j: JoinRequest,
    action: "approve" | "reject",
    feedback?: string,
    partyKey?: string,
  ) => {
    try {
      await api.flows.decideJoin(j.id, {
        action,
        taskId: j.taskId,
        ...(feedback ? { feedback } : {}),
        ...(partyKey ? { partyKey } : {}),
      });
      toast(
        t(action === "approve" ? "community.flows.join.approved" : "community.flows.join.rejected"),
      );
      setRejecting(null);
      bump();
    } catch (e) {
      const why = approveErrorKey(e);
      if (why) return toast(t(why)); // vẫn ở màn duyệt để chọn lại đối tác
      if (!isConflict(e)) throw e;
      toast(t("community.flows.join.conflict"));
      setRejecting(null);
      list.reload();
    }
  };
  return (
    <>
      <ListState {...list} emptyKey="community.flows.join.empty" />
      {list.items?.map((j) => (
        <article className="card post" key={j.id} data-testid="join-item">
          <div className="ph">
            <div className="who">
              <b>{j.company}</b>
              <div className="meta">
                {j.contact} · {j.email}{" "}
                <span className={TONE[j.status]}>
                  {t(`community.flows.join.status.${j.status}`)}
                </span>
              </div>
            </div>
          </div>
          <div className="pbody">
            {j.reason && <p>{j.reason}</p>}
            {j.status === "rejected" && j.feedback && (
              <p className="muted">
                {t("community.flows.join.rejectedWhy", { reason: j.feedback })}
              </p>
            )}
          </div>
          {j.status === "pending" && (
            <JoinApprove
              j={j}
              onApprove={(party) => void decide(j, "approve", undefined, party)}
              onReject={() => setRejecting(j)}
            />
          )}
        </article>
      ))}
      {rejecting && (
        <ReasonDialog
          testId="join-reject-dialog"
          title={t("community.flows.join.rejectTitle")}
          intro={t("community.flows.join.rejectIntro")}
          label={t("community.flows.join.reasonLabel")}
          required={false}
          submitLabel={t("community.flows.join.reject")}
          onClose={() => setRejecting(null)}
          onSubmit={(text) => decide(rejecting, "reject", text)}
        />
      )}
    </>
  );
}

export default function JoinRequestsPage() {
  const { isHostViewer } = useApp();
  return (
    <FlowPage
      title={t("community.flows.join.title")}
      intro={t(
        isHostViewer ? "community.flows.join.introHost" : "community.flows.join.introPartner",
      )}
      testId="join-page"
    >
      {isHostViewer ? <JoinReview /> : <JoinForm />}
    </FlowPage>
  );
}
