// CR-103 · R1 fnr-registry · design §1: registry loại node phía editor (song song `hub-api/.../nodes/registry.ts`).
// `lib/stage-convert.ts` đọc từ đây thay vì so `executor.kind`. Thêm loại node = thêm một mục (thiếu ⇒ lỗi typecheck).
import {
  type ExecutorKind,
  NODE_FAMILY_OF,
  type NodeFamily,
  type ProcessStageDef,
} from "@ai/contracts/hub-admin";
import { APPLY_EXECUTOR, APPLY_PATCH, executorToDef } from "../lib/apply-form";
import type { StageDraft } from "../lib/draft-types";
import { draftsToFields, FORM_EXECUTOR, FORM_PATCH, fieldToDraft } from "../lib/form-fields";
import { draftToIf, IF_EXECUTOR, IF_PATCH, ifToDraft } from "../lib/if-form";
import { SET_EXECUTOR, SET_PATCH, setFromDef, setToDef } from "../lib/set-form";
import {
  emptySubprocess,
  SUBPROCESS_EXECUTOR,
  subprocessFromDef,
  subprocessToDef,
} from "../lib/subprocess-form";
import {
  WAIT_EVENT_PATCH,
  WAIT_FOR_PATCH,
  waitEventFromDef,
  waitEventToDef,
  waitForFromDef,
  waitForToDef,
} from "../lib/timed-wait-form";
import { TOOL_EXECUTOR, TOOL_PATCH, toolFromDef, toolToDef } from "../lib/tool-form";
import {
  WAIT_EVENT_EXECUTOR,
  WAIT_EXECUTOR,
  WAIT_FOR_EXECUTOR,
  WAIT_PATCH,
  waitFromDef,
  waitToDef,
} from "../lib/wait-form";

type Executor = ProcessStageDef["executor"];
type Ex<K extends ExecutorKind> = Extract<Executor, { kind: K }>;

/** CR-125 · m6b · một mục của menu "+" / bảng node do loại bước CƠ BẢN này đóng góp (MỘT nguồn, thay `NODE_TABLE` cứng): `id` = khoá nhãn
 *  `process.admin.flow.node.<id>` + testid `flow-node-<id>`; `patch` = phần draft khi thêm; `section`/`order` như `NodeMenu` của node module. */
export type NodeMenuEntry = {
  id: string;
  section: "business" | "advanced";
  order: number;
  patch: Partial<StageDraft>;
};

export type FeNode<K extends ExecutorKind = ExecutorKind> = {
  kind: K;
  /** Mục menu "+" của loại bước (vắng ⇒ không thêm trực tiếp từ menu). */
  menu?: readonly NodeMenuEntry[];
  family: NodeFamily;
  /** Khoá i18n nhãn loại; agent/team = null (nhãn là tên agent/nhóm trong danh sách chọn). */
  labelKey: string | null;
  /** Patch draft khi chọn loại này (agent/team: rỗng — chỉ đổi `executor` theo agent/nhóm được chọn). */
  defaults(): Partial<StageDraft>;
  /** Giá trị cố định của ô `executor` (loại không tham chiếu agent/nhóm); agent/team = null ("agent:<id>"/"team:<id>"). */
  draftValue: string | null;
  /** Giá trị ô `executor` của draft. */
  draftExecutor(ex: Ex<K>): string;
  /** Phần draft riêng của loại khi nạp def (vắng ⇒ giữ rỗng). */
  fromDef?(
    ex: Ex<K>,
  ): Partial<
    Pick<
      StageDraft,
      "wait" | "tool" | "set" | "ifx" | "formFields" | "approve" | "notifyRaw" | "subprocess"
    >
  >;
  /** Draft → executor của contract. */
  toDef(s: StageDraft): Executor;
};

const refToDef = (s: StageDraft): Executor => executorToDef(s.executor);

export const FE_NODES: { readonly [K in ExecutorKind]: FeNode<K> } = {
  agent: {
    kind: "agent",
    menu: [{ id: "agent", section: "advanced", order: 20, patch: { executor: "" } }],
    family: NODE_FAMILY_OF.agent,
    labelKey: null,
    defaults: () => ({}),
    draftValue: null,
    draftExecutor: (ex) => `agent:${ex.agent_id}`,
    toDef: refToDef,
  },
  team: {
    kind: "team",
    family: NODE_FAMILY_OF.team,
    labelKey: null,
    defaults: () => ({}),
    draftValue: null,
    draftExecutor: (ex) => `team:${ex.team_id}`,
    toDef: refToDef,
  },
  apply: {
    kind: "apply",
    family: NODE_FAMILY_OF.apply,
    labelKey: "process.admin.apply.kind",
    defaults: () => ({ ...APPLY_PATCH }),
    draftValue: APPLY_EXECUTOR,
    draftExecutor: () => APPLY_EXECUTOR,
    toDef: refToDef,
  },
  wait_until: {
    kind: "wait_until",
    family: NODE_FAMILY_OF.wait_until,
    labelKey: "process.admin.editor.stage.kind.wait",
    defaults: () => ({ ...WAIT_PATCH }),
    draftValue: WAIT_EXECUTOR,
    draftExecutor: () => WAIT_EXECUTOR,
    fromDef: (ex) => ({ wait: waitFromDef(ex) }),
    toDef: (s) => waitToDef(s.wait),
  },
  tool: {
    kind: "tool",
    menu: [{ id: "tool", section: "advanced", order: 30, patch: { executor: "tool" } }],
    family: NODE_FAMILY_OF.tool,
    labelKey: "process.admin.editor.stage.kind.tool",
    defaults: () => ({ ...TOOL_PATCH }),
    draftValue: TOOL_EXECUTOR,
    draftExecutor: () => TOOL_EXECUTOR,
    fromDef: (ex) => ({ tool: toolFromDef(ex) }),
    toDef: (s) => toolToDef(s.tool),
  },
  set: {
    kind: "set",
    menu: [
      { id: "set", section: "advanced", order: 90, patch: { executor: "set" } },
      { id: "finish", section: "business", order: 60, patch: { executor: "set" } },
    ],
    family: NODE_FAMILY_OF.set,
    labelKey: "process.admin.editor.stage.kind.set",
    defaults: () => ({ ...SET_PATCH }),
    draftValue: SET_EXECUTOR,
    draftExecutor: () => SET_EXECUTOR,
    fromDef: (ex) => ({ set: setFromDef(ex) }),
    toDef: (s) => setToDef(s.set),
  },
  if: {
    kind: "if",
    menu: [{ id: "if", section: "business", order: 20, patch: { executor: "if" } }],
    family: NODE_FAMILY_OF.if,
    labelKey: "process.admin.editor.stage.kind.if",
    defaults: () => ({ ...IF_PATCH }),
    draftValue: IF_EXECUTOR,
    draftExecutor: () => IF_EXECUTOR,
    fromDef: (ex) => ({ ifx: ifToDraft(ex) }),
    toDef: (s) => draftToIf(s.ifx),
  },
  // CR-118 · node form: trường sửa ở `StageFormFields`; `fields` (output) đồng bộ ở `formPatch`/`normalizeForm`.
  form: {
    kind: "form",
    menu: [{ id: "form", section: "business", order: 45, patch: { executor: "form" } }],
    family: NODE_FAMILY_OF.form,
    labelKey: "process.admin.editor.stage.kind.form",
    defaults: () => ({ ...FORM_PATCH }),
    draftValue: FORM_EXECUTOR,
    draftExecutor: () => FORM_EXECUTOR,
    fromDef: (ex) => ({ formFields: ex.fields.map(fieldToDraft) }),
    toDef: (s) => ({ kind: "form", fields: draftsToFields(s.formFields ?? []) }),
  },
  // CR-120 · G3/G4 · chờ N giờ / chờ sự kiện: khối nhập ở `StageTimedWait`.
  wait_for: {
    kind: "wait_for",
    family: NODE_FAMILY_OF.wait_for,
    labelKey: "process.admin.editor.stage.kind.waitFor",
    defaults: () => ({ ...WAIT_FOR_PATCH }),
    draftValue: WAIT_FOR_EXECUTOR,
    draftExecutor: () => WAIT_FOR_EXECUTOR,
    fromDef: (ex) => ({ wait: waitForFromDef(ex) }),
    toDef: (s) => waitForToDef(s.wait),
  },
  wait_event: {
    kind: "wait_event",
    family: NODE_FAMILY_OF.wait_event,
    labelKey: "process.admin.editor.stage.kind.waitEvent",
    defaults: () => ({ ...WAIT_EVENT_PATCH }),
    draftValue: WAIT_EVENT_EXECUTOR,
    draftExecutor: () => WAIT_EVENT_EXECUTOR,
    fromDef: (ex) => ({ wait: waitEventFromDef(ex) }),
    toDef: (s) => waitEventToDef(s.wait),
  },
  // CR-121 D-6/D-6b · node `notify`: người dùng thêm/sửa ở khe `contracts.approval` qua Form + Canvas thư viện (`library/FlowNotifyFields`,
  // sửa vào `slot_body`; Hub dựng stage engine khi lưu). Trình sửa thường: chọn được "Thông báo" với mặc định an toàn (xem toDef).
  notify: {
    kind: "notify",
    family: NODE_FAMILY_OF.notify,
    labelKey: "process.admin.library.form.notifyStep",
    defaults: () => ({ executor: "notify" }),
    draftValue: "notify",
    draftExecutor: () => "notify",
    // CR-122 · U2: node bảng (Gửi email, Thông báo chuông) mang cấu hình đặt sẵn ⇒ giữ nguyên (`notifyRaw`); stage tự thêm: gửi chuông
    // cho người bắt đầu lượt, tiêu đề = tên bước (hợp lệ, không mất bước).
    fromDef: (ex) => ({ notifyRaw: ex }),
    toDef: (s) =>
      s.notifyRaw ?? {
        kind: "notify",
        to: [{ who: "starter" }],
        channels: ["bell"],
        title: s.name.trim() || "Thông báo",
        body: "",
      },
  },
  // CR-122 E2b · node Duyệt độc lập — CHỈ cho typecheck (engine đã có); `draftValue = null` ⇒ chưa chọn được trong bảng node. U2 bật
  // (nhãn, khối sửa đích Từ chối/Trả lại).
  approve: {
    kind: "approve",
    menu: [
      {
        id: "approve",
        section: "business",
        order: 10,
        patch: { executor: "approve", after: "review" },
      },
    ],
    family: NODE_FAMILY_OF.approve,
    labelKey: "process.admin.flow.node.approve",
    defaults: () => ({ executor: "approve", after: "review" }),
    draftValue: "approve",
    draftExecutor: () => "approve",
    fromDef: (ex) => ({ approve: { reject: ex.reject_step, ret: ex.return_step } }),
    toDef: (s) => ({
      kind: "approve",
      reject_step: s.approve?.reject ?? null,
      return_step: s.approve?.ret ?? null,
    }),
  },
  // CR-125 · cr125-subprocess-ui · «Quy trình con» (`core.subprocess`): họ `control` (không rẽ nhánh theo luật). Không `menu`/`labelKey`: nút ở menu "+"
  // đến từ bảng node (`GET /process-palette`), không phải ô chọn loại bước thường. Nhánh rejected/cancelled nằm ở `wait.branches` của nháp.
  subprocess: {
    kind: "subprocess",
    family: NODE_FAMILY_OF.subprocess,
    labelKey: null,
    defaults: () => ({ executor: SUBPROCESS_EXECUTOR, subprocess: emptySubprocess() }),
    draftValue: SUBPROCESS_EXECUTOR,
    draftExecutor: () => SUBPROCESS_EXECUTOR,
    fromDef: (ex) => subprocessFromDef(ex),
    toDef: (s) => subprocessToDef(s.subprocess, s.wait),
  },
};

/** Mục registry của executor contract. */
export const feNodeOf = <K extends ExecutorKind>(kind: K): FeNode<K> => FE_NODES[kind] as FeNode<K>;

/** Loại node của ô `executor` draft ("agent:<id>"/"team:<id>"/"apply"/"wait_until"/"tool"); trống/lạ ⇒ null. */
export function draftKindOf(executor: string): ExecutorKind | null {
  for (const n of Object.values(FE_NODES) as FeNode[])
    if (n.draftValue !== null && executor === n.draftValue) return n.kind;
  const head = executor.split(":")[0];
  return head === "agent" || head === "team" ? head : null;
}
