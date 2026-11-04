// CR-118 · cr118-form-node · gửi form của node `form` (`POST /review-tasks/:id/form`): phần DB chạy TRONG tx của cổng kiểm
// (`GateService.formSubmit`, run đã khoá FOR UPDATE). Kiểm giá trị theo trường form của SNAPSHOT run (không def hiện hành),
// ghi field vào output "chờ điền" của stage, audit (chỉ key, không giá trị), trả chuỗi canonical lưu ở `review_tasks.answer`
// để gửi lại cùng giá trị ⇒ cùng kết quả (idempotent). Đối tác (user ngoài) không bao giờ làm bước ở run gói `contracts`.
import type { FormField } from "@ai/contracts/hub-admin";
import { PROCESS_FORM_ERRORS } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { AppError } from "../../../lib/errors";
import { clipEntityName, dbHubAudit } from "../../../lib/hub-audit";
import { processError } from "../core/errors";
import {
  canonicalFormValues,
  type FormValues,
  validateFormValues,
} from "../domain/form/form.rules";
import type { Viewer } from "../domain/runs/run-access.rules";
import { setOutputMd } from "../domain/set/set.rules";
import { type Locked, notFound, snapOf } from "./gates.effects";

/** Yêu cầu gửi form (giá trị thô + người gửi là user ngoài/đối tác). */
export type FormSubmit = { values: unknown; external: boolean };

/** Gói mà đối tác không bao giờ được làm bước (câu 17 CR-118). */
const PARTNER_DENIED_PACKS: ReadonlySet<string> = new Set(["contracts"]);

export function formValuesError(paths: string[]): AppError {
  return new AppError(
    "FORM_VALUES_INVALID",
    PROCESS_FORM_ERRORS.FORM_VALUES_INVALID,
    "Form values are invalid",
    { paths },
  );
}

/** Trường form của stage `idx` trong snapshot; stage không phải `form` ⇒ null. */
export function snapFormFields(run: Locked, idx: number): FormField[] | null {
  const ex = (snapOf(run).stages[idx] as { executor?: { kind: string; fields?: FormField[] } })
    ?.executor;
  return ex?.kind === "form" ? (ex.fields ?? []) : null;
}

/** Đối tác ở run gói `contracts` ⇒ 404 (không lộ tồn tại), trước mọi kiểm khác. */
export function assertFormActor(run: Locked, f: FormSubmit): void {
  if (f.external && run.packKey != null && PARTNER_DENIED_PACKS.has(run.packKey)) throw notFound();
}

/** Kiểm theo snapshot ⇒ giá trị chuẩn hoá; sai ⇒ 422 `FORM_VALUES_INVALID` {paths}. */
export function checkFormValues(fields: readonly FormField[], raw: unknown): FormValues {
  const r = validateFormValues(fields, raw);
  if (!r.ok) throw formValuesError(r.paths);
  return r.values;
}

type WriteForm = {
  run: Locked;
  idx: number;
  outputId: string | null;
  taskId: string;
  values: FormValues;
  v: Viewer;
};

/** Ghi field vào output hiện hành của stage (cùng tx với đóng task) + audit. Trả chuỗi lưu ở `answer`. */
export async function writeFormOutput(tx: Tx, w: WriteForm): Promise<string> {
  if (!w.outputId) throw processError("NO_OUTPUT");
  const name = (snapOf(w.run).stages[w.idx] as { name?: string } | undefined)?.name ?? "";
  const answer = canonicalFormValues(w.values);
  await tx.execute(sql`update hub.process_outputs
    set content = ${setOutputMd(name, w.values)}, fields = ${answer}::jsonb, template_ok = true
    where id = ${w.outputId} and tenant_id = ${w.run.tenantId}`);
  await dbHubAudit.insert(tx, {
    tenantId: w.run.tenantId,
    actorId: w.v.userId,
    actorUsername: null,
    actorRole: w.v.role,
    action: "review",
    entity: "review_task",
    entityId: w.taskId,
    entityName: clipEntityName(w.taskId),
    hubConfigVersion: null,
    before: null,
    after: { kind: "form", stage_idx: w.idx, keys: Object.keys(w.values) },
    summary: { process_run_id: w.run.id },
  });
  return answer;
}

type Pre = {
  run: Locked;
  idx: number;
  outputId: string | null;
  taskId: string;
  v: Viewer;
  form: FormSubmit | undefined;
};

/**
 * Trước khi đóng task của cổng kiểm: stage `form` CHỈ quyết qua gửi form, stage khác KHÔNG nhận gửi form (409
 * TASK_KIND_MISMATCH). Gửi form ⇒ chặn đối tác, kiểm theo snapshot, ghi output. Trả `answer` (null khi không phải form).
 */
export async function formPre(tx: Tx, p: Pre): Promise<string | null> {
  const fields = snapFormFields(p.run, p.idx);
  if ((fields !== null) !== (p.form !== undefined)) throw processError("TASK_KIND_MISMATCH");
  if (!p.form || !fields) return null;
  assertFormActor(p.run, p.form);
  const values = checkFormValues(fields, p.form.values);
  return writeFormOutput(tx, { ...p, values });
}

/**
 * Task form đã đóng: cùng giá trị (sau chuẩn hoá theo snapshot) với lần Đạt trước ⇒ không làm gì (người gọi trả thẻ task);
 * khác/không phải lần gửi form ⇒ 409 REVIEW_TASK_CLOSED.
 */
export async function formReplayCheck(
  tx: Tx,
  q: { run: Locked; idx: number; taskId: string; form: FormSubmit },
): Promise<void> {
  const fields = snapFormFields(q.run, q.idx);
  if (fields === null) throw processError("TASK_KIND_MISMATCH");
  assertFormActor(q.run, q.form);
  const answer = canonicalFormValues(checkFormValues(fields, q.form.values));
  const [r] = await tx.execute<{ result: string | null; answer: string | null }>(
    sql`select result, answer from hub.review_tasks where id = ${q.taskId} and tenant_id = ${q.run.tenantId}`,
  );
  if (r?.result !== "pass" || r.answer !== answer) throw processError("REVIEW_TASK_CLOSED");
}
