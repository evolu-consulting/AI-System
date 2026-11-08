// CR-125 · cr125-manual-start-ui · phiếu yêu cầu dựng từ schema của flow (`GET /processes/startable`): điền → gửi với `request_id` do client sinh
// MỖI lần mở phiếu (gửi lại = cùng yêu cầu) → sang trang yêu cầu. Lỗi theo MÃ nói bằng ngôn ngữ nghiệp vụ; lỗi 422 hiện cạnh từng ô.

import { ApiError } from "@ai/web-kit/http";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHead, Panel } from "~/components/shared/layout";
import { Skeleton } from "~/components/ui/skeleton";
import { fetchStartable, requestKeys, startRequest } from "../api";
import { RequestField } from "../components/RequestField";
import {
  fieldErrorsOf,
  initialValues,
  type RValues,
  startErrorKey,
  toPayload,
  validate,
} from "../lib/request-form";

export function NewRequestPage({ flowKey }: { flowKey: string }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: requestKeys.startable,
    queryFn: ({ signal }) => fetchStartable(signal),
    staleTime: 30_000,
  });
  const flow = q.data?.items.find((f) => f.flow_key === flowKey);
  const back = (
    <Link to="/contracts/requests" className="hover:underline">
      {t("contracts.requests.back")}
    </Link>
  );
  if (q.isPending) return <Skeleton className="h-40 w-full" />;
  if (!flow)
    return (
      <div data-testid="request-form-missing">
        <PageHead title={t("contracts.requests.title")} crumb={back} />
        <p role="alert" className="text-sm text-late">
          {t(
            q.isError ? "contracts.requests.loadError" : "contracts.requests.err.PROCESS_NOT_FOUND",
          )}
        </p>
      </div>
    );
  return <RequestForm key={flow.flow_key} flow={flow} back={back} />;
}

function RequestForm({
  flow,
  back,
}: {
  flow: NonNullable<Awaited<ReturnType<typeof fetchStartable>>["items"][number]>;
  back: React.ReactNode;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fields = flow.form.fields;
  // mã yêu cầu sinh MỘT lần mỗi lần mở phiếu: bấm gửi hai lần / mạng chập chờn ⇒ cùng một yêu cầu
  const requestId = useRef(crypto.randomUUID());
  const [values, setValues] = useState<RValues>(() => initialValues(fields));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onError = (err: unknown) => {
    const code = err instanceof ApiError ? String(err.code) : "";
    if (code === "START_FORM_INVALID") setErrors(fieldErrorsOf((err as ApiError).details));
    if (code === "START_REQUEST_REUSED") requestId.current = crypto.randomUUID();
    setBanner(startErrorKey(code));
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local = validate(fields, values);
    setErrors(local);
    setBanner(null);
    if (Object.keys(local).length > 0) return;
    setBusy(true);
    try {
      const r = await startRequest({
        flow_key: flow.flow_key,
        request_id: requestId.current,
        values: toPayload(fields, values),
      });
      await navigate({
        to: "/contracts/requests/$runId",
        params: { runId: r.run_id },
        search: { sent: r.created ? "new" : "again" },
      });
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-testid="request-form">
      <PageHead title={t("contracts.requests.newTitle", { name: flow.name })} crumb={back} />
      <Panel className="max-w-2xl px-6 py-5">
        <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          {fields.map((f) => (
            <RequestField
              key={f.key}
              field={f}
              value={values[f.key] ?? ""}
              error={errors[f.key]}
              onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
            />
          ))}
          {banner && (
            <p role="alert" className="text-sm text-late" data-testid="request-error">
              {t(banner)}
            </p>
          )}
          <div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy}
              data-testid="request-submit"
            >
              {t(busy ? "contracts.requests.submitting" : "contracts.requests.submit")}
            </button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
