// ADM-FR-66 · CR-056 · P-a F5 · P-b2 · P-d2: khung form một giai đoạn — `region "Giai đoạn n: <tên>"` (plan-frontend §1, e2e §2).
// Chi tiết từng phần ở StageGeneral/StageStepFields/StageGate/StageAnswerer/StageActions (tách — TECH-DEBT #136).
import type { NotifyTo } from "@ai/contracts/hub-admin";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useSession } from "@/lib/auth/use-session";
import { useGroupKeyOptions } from "../../hooks/use-group-key-options";
import { isApply } from "../../lib/apply-form";
import { isForm } from "../../lib/form-fields";
import { isIf } from "../../lib/if-form";
import { draftClusterOf } from "../../lib/module-cluster";
import { isSet } from "../../lib/set-form";
import { isStartForm } from "../../lib/start-form";
import { isSubprocessExecutor } from "../../lib/subprocess-form";
import { isTool } from "../../lib/tool-form";
import { isWait, isWaitFamily } from "../../lib/wait-form";
import { hasNodePanel } from "../../modules/panel-registry";
import { usePalette } from "../../palette-api";
import { useFlowCtx } from "../flow/flow-ctx";
import { NodeConfigPanel } from "../flow/NodeConfigPanel";
import { SelectField, TextField } from "./Fields";
import { StageActions } from "./StageActions";
import { StageAdminModeNotice } from "./StageAdminModeNotice";
import { StageAnswerer } from "./StageAnswerer";
import { StageApply } from "./StageApply";
import { StageApprove } from "./StageApprove";
import { StageApproveBasics } from "./StageApproveBasics";
import { StageAutofix } from "./StageAutofix";
import { StageBranch } from "./StageBranch";
import { StageCluster } from "./StageCluster";
import { StageFormFields } from "./StageFormFields";
import { StageGate } from "./StageGate";
import { StageGeneral, StageLimits } from "./StageGeneral";
import { StageIfForm } from "./StageIf";
import { StageLinks } from "./StageLinks";
import { StageMustKnow } from "./StageMustKnow";
import { StageOutput } from "./StageOutput";
import { StageRemind } from "./StageRemind";
import { StageSet } from "./StageSet";
import { StageSourcesField } from "./StageSourcesField";
import { StageStartForm } from "./StageStartForm";
import { StageStepFields } from "./StageStepFields";
import { StageTimedWait } from "./StageTimedWait";
import { StageWait } from "./StageWait";
import type { StageFormProps } from "./stage-form-props";

export type { StageFormProps } from "./stage-form-props";

/** P-d2 · chỉ nạp khi chọn "Gọi tool" (plan-frontend-d2 §14). */
const StageTool = lazy(() => import("./StageTool"));

/** `stages.<i>.executor.values.<j>.key|from` → `<j>.key|from` (cho StageSet). */
function setErrors(
  errors: StageFormProps["errors"],
  index: number,
  t: (k: string) => string,
): Record<string, string> {
  const pre = `stages.${index}.executor.values.`;
  return Object.fromEntries(
    Object.entries(errors)
      .filter(([k]) => k.startsWith(pre))
      .map(([k, v]) => [k.slice(pre.length), t(v)]),
  );
}

function Body(p: StageFormProps) {
  const { t } = useTranslation();
  const { stage, index, errors, readOnly, onChange } = p;
  const flow = useFlowCtx();
  const set = isSet(stage);
  const form = isForm(stage);
  // `set`/`form` như `tool`: không nguồn/tự-sửa/người trả lời/ghi nhớ (Hub ép khi lưu)
  const tool = isTool(stage) || set || form;
  const apply = isApply(stage);
  return (
    <>
      {set ? (
        <StageSet
          id={stage.uid}
          rows={stage.set.rows}
          fields={stage.fields}
          inputs={(p.defInputs ?? []).map((i) => ({
            key: i.key,
            label: i.label || i.key,
            type: i.type,
          }))}
          prev={p.all
            .filter((s) => s.step < stage.step)
            .map((s) => ({
              step: s.step,
              label: s.name || s.key,
              fields: s.executor === "wait_event" ? [...s.fields, { key: "event" }] : s.fields,
            }))}
          facts={flow?.event?.facts}
          readOnly={readOnly}
          errors={setErrors(errors, index, t)}
          onChange={(rows) => onChange({ set: { rows } })}
        />
      ) : null}
      {isTool(stage) ? (
        <Suspense fallback={null}>
          <StageTool {...p} />
        </Suspense>
      ) : form ? (
        <StageFormFields {...p} />
      ) : (
        <StageOutput
          stage={stage}
          index={index}
          errors={errors}
          readOnly={readOnly}
          onChange={onChange}
          hideFile={!!flow && set}
        />
      )}
      {apply ? (
        <StageApply {...p} />
      ) : (
        <>
          {tool ? null : (
            <>
              <StageSourcesField {...p} />
              <StageAutofix {...p} />
            </>
          )}
          <StageGate {...p} />
          <StageRemind {...p} />
          <StageBranch {...p} />
        </>
      )}
      {tool ? null : <StageAnswerer {...p} />}
      <StageAdminModeNotice after={stage.after} gate={!apply} asks={!tool} />

      <StageLimits {...p} />
      {apply || tool ? null : <StageMustKnow {...p} />}
    </>
  );
}

/** Thu gọn "Nâng cao" (đóng mặc định): chi tiết kỹ thuật không bắt người dùng nghiệp vụ nhìn. */
function AdvancedBox({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <details className="rounded-md border border-border px-3 py-2" data-testid="stage-advanced">
      <summary className="cursor-pointer text-label font-medium">
        {t("process.admin.flow.advanced")}
      </summary>
      <div className="mt-3 space-y-4">{children}</div>
    </details>
  );
}

/** Node module (Gửi email, Ký số, Hẹn giờ…): chỉ phần nghiệp vụ đặt sẵn của node. */
function ModuleBody(p: StageFormProps) {
  const { t } = useTranslation();
  const { stage } = p;
  const flow = useFlowCtx();
  const palette = usePalette(flow?.app ?? "", flow?.tenantId);
  const node = palette.data?.find((n) => n.key === stage.node);
  if (isWait(stage)) return <StageWait {...p} />;
  if (isWaitFamily(stage)) return <StageTimedWait {...p} />;
  // CR-125 · cr125-subprocess-ui · «Quy trình con»: một stage, panel riêng ở panelRegistry (chọn quy trình con, nối đầu vào)
  if (node && isSubprocessExecutor(stage.executor) && hasNodePanel(node))
    return <NodeConfigPanel {...p} node={node} />;
  // CR-122 · U2f · node có cấu hình riêng (manifest `config`): panel theo `options_path`, chỉ ở stage `config.stage` (stage tool).
  if (
    node &&
    hasNodePanel(node) &&
    stage.executor === "tool" &&
    node.stages[node.config?.stage ?? 0]?.executor.kind === "tool"
  )
    return <NodeConfigPanel {...p} node={node} />;
  if (stage.executor === "notify" && stage.notifyRaw)
    return <NotifyBasics stage={stage} readOnly={p.readOnly} onChange={p.onChange} />;
  return (
    <p className="text-caption text-muted-foreground" data-testid="module-note">
      {t("process.admin.flow.moduleNote")}
    </p>
  );
}

/** CR-123 u9 · "Gửi cho": người tạo hợp đồng và/hoặc một phòng ban (chọn theo tên, không gõ mã). */
function NotifyRecipients(p: {
  id: string;
  to: NotifyTo[];
  readOnly: boolean;
  onChange: (to: NotifyTo[]) => void;
}) {
  const { t } = useTranslation();
  const flow = useFlowCtx();
  const groups = useGroupKeyOptions(flow?.tenantId, !!flow?.tenantId);
  const starter = p.to.some((x) => x.who === "starter");
  const group = p.to.find((x) => x.who === "group");
  const rest = p.to.filter((x) => x.who === "input_user");
  const build = (s: boolean, g: string): NotifyTo[] => [
    ...(s ? [{ who: "starter" as const }] : []),
    ...(g ? [{ who: "group" as const, group_key: g }] : []),
    ...rest,
  ];
  return (
    <fieldset className="space-y-2 border-0 p-0" data-testid="notify-to">
      <legend className="text-label font-medium">{t("process.admin.flow.notify.to")}</legend>
      <Label className="flex items-center gap-2 font-normal">
        <Checkbox
          checked={starter}
          disabled={p.readOnly}
          onCheckedChange={(v) => p.onChange(build(v === true, group?.group_key ?? ""))}
        />
        {t("process.admin.flow.notify.toStarter")}
      </Label>
      <SelectField
        id={`${p.id}-ngroup`}
        label={t("process.admin.flow.notify.toGroup")}
        value={group?.group_key ?? ""}
        readOnly={p.readOnly}
        placeholder={t("process.admin.flow.notify.toGroupPh")}
        options={groups}
        onChange={(v) => p.onChange(build(starter, v))}
      />
    </fieldset>
  );
}

/** Gửi email / Thông báo chuông: Gửi cho + tiêu đề + nội dung (kênh đã đặt sẵn theo node). */
function NotifyBasics(p: Pick<StageFormProps, "stage" | "readOnly" | "onChange">) {
  const { t } = useTranslation();
  const raw = p.stage.notifyRaw;
  if (!raw) return null;
  const set = (patch: { title?: string; body?: string; to?: NotifyTo[] }) =>
    p.onChange({ notifyRaw: { ...raw, ...patch } });
  return (
    <div className="space-y-3" data-testid="notify-basics">
      <NotifyRecipients
        id={p.stage.uid}
        to={raw.to}
        readOnly={p.readOnly}
        onChange={(to) => set({ to })}
      />
      <TextField
        id={`${p.stage.uid}-ntitle`}
        label={t("process.admin.flow.notify.title")}
        value={raw.title}
        readOnly={p.readOnly}
        onChange={(v) => set({ title: v })}
      />
      <TextField
        id={`${p.stage.uid}-nbody`}
        label={t("process.admin.flow.notify.body")}
        value={raw.body}
        readOnly={p.readOnly}
        multiline
        rows={4}
        onChange={(v) => set({ body: v })}
      />
    </div>
  );
}

/** CR-122 · U2e · trình sửa node của FLOW: tên + phần nghiệp vụ ở trên; mã giai đoạn, người thực hiện, chạy ở bước… vào "Nâng cao". */
function FlowMain(p: StageFormProps) {
  const { stage } = p;
  const { t } = useTranslation();
  const isPlatform = useSession((s) => s.me?.role) === "platform_admin";
  if (isStartForm(stage)) return <StageStartForm {...p} />;
  if (stage.node) return <ModuleBody {...p} />;
  if (isWait(stage)) return <StageWait {...p} />;
  if (isWaitFamily(stage)) return <StageTimedWait {...p} />;
  if (isIf(stage)) return <StageIfForm {...p} />;
  if (stage.executor === "approve") return null; // "Ai duyệt" + "Hạn trả lời" ở StageApproveBasics
  // CR-123 FR-13: node Công cụ (tool) là kỹ thuật ⇒ phần chính chỉ một câu giải thích, chi tiết ở "Nâng cao"
  if (isTool(stage))
    return (
      <p className="text-caption text-muted-foreground" data-testid="tool-note">
        {/* CR-125 · c6 · B4: "Nâng cao" là khái niệm của quản trị nền tảng — người dùng công ty không có mục đó, không nhắc tới */}
        {t(isPlatform ? "process.admin.flow.toolNote" : "process.admin.flow.toolNoteCompany")}
      </p>
    );
  return <Body {...p} />;
}

function FlowForm(p: StageFormProps) {
  const { stage } = p;
  // CR-123 · u3a · FR-14: stage của node module nhiều stage (Ký số) ⇒ MỘT panel cho cả ô, bấm stage nào cũng vậy.
  // CR-123 u9: "Nâng cao" (mã bước, người thực hiện, Tự sửa mã, Chạy tính năng…) chỉ cho quản trị nền tảng — công ty chỉ thấy phần nghiệp vụ
  const isPlatform = useSession((s) => s.me?.role) === "platform_admin";
  const cluster = draftClusterOf(p.all, p.index);
  if (cluster) return <StageCluster {...p} cluster={cluster} />;
  const mod = !!stage.node;
  const approve = stage.executor === "approve" && !mod;
  const tool = isTool(stage) && !mod;
  return (
    <section className="space-y-4 px-1" aria-label={stage.name}>
      <StageGeneral {...p} part="name" />
      {approve ? <StageApproveBasics {...p} /> : null}
      {stage.executor === "approve" ? <StageApprove {...p} /> : null}
      <StageLinks {...p} />
      <FlowMain {...p} />
      {isPlatform ? (
        <AdvancedBox>
          <StageGeneral {...p} part="tech" />
          <StageStepFields {...p} />
          {approve ? <StageRemind {...p} skipRemind /> : null}
          {tool || (mod && !isStartForm(stage) && !isWaitFamily(stage) && !isWait(stage)) ? (
            <Body {...p} />
          ) : null}
        </AdvancedBox>
      ) : null}
      <StageActions {...p} />
    </section>
  );
}

export function StageForm(p: StageFormProps) {
  const { t } = useTranslation();
  const { stage, index } = p;
  const flow = useFlowCtx();
  if (flow) return <FlowForm {...p} />;
  return (
    <section
      aria-label={t("process.admin.editor.stage.aria", { n: index + 1, name: stage.name })}
      className="space-y-4 px-1"
    >
      <StageGeneral {...p} />
      <StageStepFields {...p} />
      {stage.executor === "approve" ? <StageApprove {...p} /> : null}
      <StageLinks {...p} />
      {isWait(stage) ? (
        <StageWait {...p} />
      ) : isWaitFamily(stage) ? (
        <StageTimedWait {...p} />
      ) : isIf(stage) ? (
        <StageIfForm {...p} />
      ) : (
        <Body {...p} />
      )}
      <StageActions {...p} />
    </section>
  );
}
