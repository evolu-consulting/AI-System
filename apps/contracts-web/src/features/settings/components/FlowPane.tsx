// contract-flow S5 · mục "Quy trình duyệt" trong Cài đặt: mọi người có quyền đọc gói đều xem; chỉ chủ sở hữu (owner) sửa + lưu.
// Danh sách bước (≤ 8, bước 1 cố định) · xem trước đường đi · Lưu ⇒ PUT, lỗi server hiện theo trường.
// TODO: nút "Thêm bước Dify" ẩn tới khi có API liệt kê workflow catalog (xem docs/specs/contract-flow/tasks.md).
import { useEffect, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import { FLOW_MAX_STEPS, type FlowStep } from "../api-flow";
import { useDepartments, useFlow, useSaveFlow } from "../hooks/use-flow";
import { type FlowIssue, flowReducer, serverIssues, validateFlow } from "../lib/flow-state";
import { FlowPreview } from "./FlowPreview";
import { FlowStepCard } from "./FlowStepCard";

const BTN = "h-9 rounded-lg border border-rule px-3 text-label hover:bg-sunk disabled:opacity-50";

export function FlowPane({ owner }: { owner: boolean }) {
  const { t } = useTranslation();
  const f = (k: string) => t(`contracts.flow.${k}`);
  const q = useFlow(true);
  const depts = useDepartments(true);
  const save = useSaveFlow();
  const [steps, dispatch] = useReducer(flowReducer, [] as FlowStep[]);
  const [server, setServer] = useState<FlowIssue[]>([]);
  const version = useRef<number | null>(null);

  useEffect(() => {
    if (!q.data || version.current === q.data.version) return;
    version.current = q.data.version;
    dispatch({ type: "load", steps: q.data.steps });
    setServer([]);
  }, [q.data]);

  if (q.isError)
    return (
      <p role="alert" className="text-late">
        {f("loadFail")}{" "}
        <button type="button" className="underline" onClick={() => void q.refetch()}>
          {t("contracts.common.retry")}
        </button>
      </p>
    );
  if (!q.data) return <p className="text-dim">{t("contracts.common.loading")}</p>;

  const local = validateFlow(steps);
  const issues = [...local, ...server];
  const dirty = JSON.stringify(steps) !== JSON.stringify(q.data.steps);
  const list = depts.data ?? [];

  const onSave = () => {
    if (local.length) return;
    save.mutate(steps, {
      onSuccess: (d) => {
        version.current = d.version;
        dispatch({ type: "load", steps: d.steps });
        setServer([]);
        toast(f("saved"));
      },
      onError: (e) => {
        const got = serverIssues(e);
        setServer(got);
        toast(got.length ? f("saveInvalid") : ((e as Error).message ?? f("saveFail")), "late");
      },
    });
  };
  const general = issues.filter((i) => i.index === null);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">{f("title")}</h2>
        {q.data.is_default && (
          <span className="rounded-full bg-act-soft px-2.5 py-0.5 text-caption font-semibold text-act">
            {f("isDefault")}
          </span>
        )}
        <span className="text-caption text-dim">v{q.data.version}</span>
        {!owner && <span className="text-caption text-dim">{f("readOnly")}</span>}
      </div>
      <p className="mb-3 text-dim">{f("lead")}</p>
      {depts.isError && <p className="mb-3 text-caption text-dim">{f("deptsFail")}</p>}
      <fieldset disabled={!owner || save.isPending} className="min-w-0 border-0 p-0">
        <ol className="mb-3 flex flex-col gap-3">
          {steps.map((s, i) => (
            <FlowStepCard
              key={s.key}
              step={s}
              index={i}
              count={steps.length}
              depts={list}
              issues={issues}
              editable={owner}
              onPatch={(patch) => dispatch({ type: "patch", index: i, patch })}
              onWhen={(when) => dispatch({ type: "setWhen", index: i, when })}
              onMove={(dir) => dispatch({ type: "move", index: i, dir })}
              onRemove={() => dispatch({ type: "remove", index: i })}
            />
          ))}
        </ol>
        {owner && (
          <button
            type="button"
            className={BTN}
            disabled={steps.length >= FLOW_MAX_STEPS}
            onClick={() => dispatch({ type: "addReview" })}
          >
            {f("addStep")}
          </button>
        )}
        {steps.length >= FLOW_MAX_STEPS && (
          <span className="ml-3 text-caption text-dim">{f("maxReached")}</span>
        )}
      </fieldset>
      {general.map((g) => (
        <p key={`${g.field}${g.code}`} role="alert" className="mt-2 text-late">
          {g.message ?? f(`err.${g.code}`)}
        </p>
      ))}
      <div className="mt-4">
        <FlowPreview steps={steps} />
      </div>
      {owner && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`${BTN} bg-act text-white`}
            disabled={!dirty || local.length > 0 || save.isPending}
            onClick={onSave}
          >
            {f("save")}
          </button>
          <button
            type="button"
            className={BTN}
            disabled={!dirty || save.isPending}
            onClick={() => {
              dispatch({ type: "load", steps: q.data.steps });
              setServer([]);
            }}
          >
            {f("discard")}
          </button>
        </div>
      )}
    </div>
  );
}
