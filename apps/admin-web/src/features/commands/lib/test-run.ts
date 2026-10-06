// ADM-FR-23 · X1 F4 · body "Chạy thử" từ BẢN NHÁP form (không lưu): `command` = phần chạy được của lệnh, ngữ cảnh tuỳ chọn.
import type { CommandTestRequest } from "@ai/contracts";
import { TEST_RUN_TEXT_MAX } from "@ai/contracts/hub-internal";
import { toRequestBody } from "./defaults";
import type { CommandFormValues } from "./schemas";

export type TestInput = {
  text: string;
  selection: string;
  pageUrl: string;
  /** Id user "Chạy với tư cách"; rỗng = chính admin (admin-api tự điền). */
  runAsUserId: string;
};

export const emptyTestInput = (): TestInput => ({
  text: "",
  selection: "",
  pageUrl: "",
  runAsUserId: "",
});

const PAGE_URL_RE = /^https?:\/\//;

/** URL trang để trống được; có thì phải `http(s)://` (khớp `MessageContextSchema.page_url`). */
export function pageUrlValid(v: string): boolean {
  const u = v.trim();
  return u === "" || PAGE_URL_RE.test(u);
}

export function textValid(v: string): boolean {
  return v.length <= TEST_RUN_TEXT_MAX;
}

/** Phần `command` của body: chỉ trường Hub cần để chạy (workflow, args, input_map, output, timeout). */
export function draftCommand(v: CommandFormValues): CommandTestRequest["command"] {
  const b = toRequestBody(v);
  return {
    workflow_id: b.workflow_id,
    args: b.args,
    input_map: b.input_map,
    output: b.output,
    timeout_s: v.timeout_s,
  };
}

/** Bỏ trường rỗng: không `context` khi không có ngữ cảnh, không `run_as_user_id` khi chạy với tư cách chính mình. */
export function buildTestBody(
  v: CommandFormValues,
  input: TestInput,
  confirmSideEffect = false,
): CommandTestRequest {
  const context: NonNullable<CommandTestRequest["context"]> = {};
  if (input.selection.trim() !== "") context.selection = input.selection;
  if (input.pageUrl.trim() !== "") context.page_url = input.pageUrl.trim();
  return {
    command: draftCommand(v),
    text: input.text,
    ...(Object.keys(context).length ? { context } : {}),
    ...(input.runAsUserId ? { run_as_user_id: input.runAsUserId } : {}),
    ...(confirmSideEffect ? { confirm_side_effect: true } : {}),
  };
}
