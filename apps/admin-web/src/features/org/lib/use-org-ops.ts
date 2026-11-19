// CR-189 · BR-189-6 · các thao tác sửa cơ cấu của màn «Cơ cấu» + HOÀN TÁC 6 giây = gọi thao tác NGƯỢC bằng dữ liệu API trả về
// (tên cũ `before`, phòng cũ `from_group_ids`, phòng cha được đưa về `moved_to_group_id`). Mỗi thao tác trả chuỗi lỗi nghiệp vụ
// (hoặc null khi xong) để nơi gọi hiện tại chỗ (ô nhập) hoặc bằng toast; không ném.
import type {
  DeptMemberRemoveResponse,
  DeptMembersAddResponse,
  OrgDepartment,
} from "@ai/contracts/org";
import { notifyError, notifySuccess, toastUndo } from "@ai/web-kit/ui/toast";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import type { OrgApi } from "../api";
import { accessNote, orgErrorSpec } from "./org-edit";

const DEPTH_MAX = 32;

type Added = DeptMembersAddResponse | null;

/** Thao tác ngược của «lưu thành viên»: người bị bỏ ⇒ thêm lại; người được chuyển ⇒ về phòng cũ; người mới vào (vốn chưa có phòng) ⇒ gỡ về công ty. */
async function undoMembers(
  api: OrgApi,
  id: string,
  added: Added,
  removed: DeptMemberRemoveResponse[],
) {
  const back = removed.filter((r) => r.removed).map((r) => r.user_id);
  if (back.length) await api.addMembers(id, back);
  for (const m of added?.moved ?? [])
    if (m.from_group_ids[0]) await api.addMembers(m.from_group_ids[0], [m.user_id]);
  const movedIds = new Set((added?.moved ?? []).map((m) => m.user_id));
  for (const u of added?.added ?? []) if (!movedIds.has(u)) await unassignAll(api, id, u);
}

/** Gỡ người khỏi `gid` rồi tiếp tục gỡ khỏi phòng cha họ vừa được đưa về, tới khi về công ty. */
async function unassignAll(api: OrgApi, gid: string, uid: string) {
  let cur: string | null = gid;
  for (let i = 0; i < DEPTH_MAX && cur; i++)
    cur = (await api.removeMember(cur, uid)).moved_to_group_id;
}

type Core = {
  api: OrgApi;
  t: TFunction;
  text: (err: unknown) => string;
  undoable: (msg: string, inverse: () => Promise<unknown>) => void;
  run: (fn: () => Promise<void>) => Promise<string | null>;
  dept: (id: string) => OrgDepartment | undefined;
};

function useCore(api: OrgApi, depts: readonly OrgDepartment[]): Core {
  const { t } = useTranslation();
  const tr = useTr();
  const text = (err: unknown): string => {
    if (err instanceof ApiError) {
      const spec = orgErrorSpec(err);
      if (spec) return t(spec.key, spec.params);
    }
    const spec = describeError(err);
    return tr(spec.key, spec.params);
  };
  const undoable = (msg: string, inverse: () => Promise<unknown>) =>
    toastUndo(
      msg,
      () =>
        void inverse()
          .then(api.refresh)
          .then(() => notifySuccess(t("orgEdit.undone")))
          .catch((e: unknown) => notifyError(text(e))),
      t("orgEdit.undo"),
    );
  /** Chạy một thao tác ghi: xong ⇒ làm mới sơ đồ, lỗi ⇒ trả câu lỗi (không ném, không treo UI). */
  const run = async (fn: () => Promise<void>): Promise<string | null> => {
    try {
      await fn();
      await api.refresh();
      return null;
    } catch (e) {
      if (e instanceof ApiError && e.code === "UNAUTHORIZED") return null;
      return text(e);
    }
  };
  return { api, t, text, undoable, run, dept: (id) => depts.find((d) => d.group_id === id) };
}

/** Phòng: thêm, đổi tên, chuyển phòng cha, đổi trưởng phòng, xoá. */
function deptOps({ api, t, undoable, run, dept }: Core) {
  return {
    add: (parent: string | null, name: string) =>
      run(async () => {
        const r = await api.createDept(name, parent);
        undoable(t("orgEdit.did.add", { name: r.name }), () => api.removeDept(r.group_id));
      }),
    rename: (id: string, name: string) =>
      run(async () => {
        const r = await api.renameDept(id, name);
        if (r.before === r.name) return;
        undoable(t("orgEdit.did.rename", { name: r.name }), () => api.renameDept(id, r.before));
      }),
    move: (id: string, parent: string | null) =>
      run(async () => {
        const d = dept(id);
        if (!d) return;
        await api.setDept(id, { head_user_id: d.head_user_id, parent_group_id: parent });
        const to = parent ? (dept(parent)?.name ?? "") : t("orgEdit.company");
        undoable(t("orgEdit.did.move", { name: d.name, to }), () =>
          api.setDept(id, { head_user_id: d.head_user_id, parent_group_id: d.parent_group_id }),
        );
      }),
    setHead: (id: string, head: string | null, headName: string) =>
      run(async () => {
        const d = dept(id);
        if (!d) return;
        await api.setDept(id, { head_user_id: head });
        undoable(
          t("orgEdit.did.head", { name: d.name, head: headName || t("orgEdit.noHead") }),
          () => api.setDept(id, { head_user_id: d.head_user_id }),
        );
      }),
    remove: (id: string) =>
      run(async () => {
        const d = dept(id);
        if (!d) return;
        await api.removeDept(id);
        undoable(t("orgEdit.did.remove", { name: d.name }), () =>
          api.createDept(d.name, d.parent_group_id),
        );
      }),
  };
}

/** Lưu thành viên: `add` = người mới tick (người đang ở phòng khác được CHUYỂN sang), `remove` = người bị bỏ tick (về phòng cha). */
function memberOps({ api, t, undoable, run, dept }: Core) {
  return {
    members: (id: string, add: string[], remove: string[]) =>
      run(async () => {
        const added = add.length ? await api.addMembers(id, add) : null;
        const removed: DeptMemberRemoveResponse[] = [];
        for (const u of remove) removed.push(await api.removeMember(id, u));
        const note = accessNote({
          gained: (added?.access.gained ?? 0) + removed.reduce((n, r) => n + r.access.gained, 0),
          lost: (added?.access.lost ?? 0) + removed.reduce((n, r) => n + r.access.lost, 0),
        });
        const msg = t("orgEdit.did.members", { name: dept(id)?.name ?? "" });
        undoable(note ? `${msg} ${t("orgEdit.did.access", note)}` : msg, () =>
          undoMembers(api, id, added, removed),
        );
      }),
  };
}

export function useOrgOps(api: OrgApi, depts: readonly OrgDepartment[]) {
  const core = useCore(api, depts);
  return { text: core.text, ...deptOps(core), ...memberOps(core) };
}
