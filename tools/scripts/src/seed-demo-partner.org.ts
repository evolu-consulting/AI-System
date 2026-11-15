// CR-150b · sơ đồ tổ chức EVOLU của bản test (người dùng giao) + kế hoạch THÊM. THUẦN, KHÔNG I/O.
// Luật an toàn như `planEvolu`: chỉ thêm (người, phòng, thành viên) và chỉ ĐẶT cái còn trống (trưởng phòng/cha của phòng chưa là phòng ban, quản lý/chức vụ còn trống); không có hành động xoá.
export const ORG_EMAIL_DOMAIN = "evolu.test";
export const orgEmail = (username: string): string => `${username}@${ORG_EMAIL_DOMAIN}`;

export type OrgPerson = {
  username: string;
  name: string;
  title: string;
  dept: string;
  /** Vai trong Sổ Hợp Tác: owner = Toàn quyền, editor = Nhân viên (sửa). */
  pack: "owner" | "editor";
};
export const ORG_ROOT = "pb-giam-doc";
export const ORG_DEPTS: readonly { key: string; vi: string; head: string }[] = [
  { key: ORG_ROOT, vi: "Ban Giám đốc", head: "thomas.tran" },
  { key: "pb-kinh-doanh", vi: "Kinh doanh", head: "julian.bui" },
  { key: "pb-ky-thuat", vi: "Kỹ thuật", head: "vio.ngo" },
  { key: "pb-cskh", vi: "Chăm sóc khách hàng", head: "rowan.hoang" },
  { key: "pb-rnd", vi: "R&D", head: "edgar.nguyen" },
];
export const ORG_PEOPLE: readonly OrgPerson[] = [
  {
    username: "thomas.tran",
    name: "Thomas Tran",
    title: "Giám đốc",
    dept: ORG_ROOT,
    pack: "owner",
  },
  {
    username: "julian.bui",
    name: "Julian Bui",
    title: "Trưởng phòng kinh doanh / Business Analyst",
    dept: "pb-kinh-doanh",
    pack: "editor",
  },
  {
    username: "vio.ngo",
    name: "Vio Ngo",
    title: "Trưởng phòng kỹ thuật",
    dept: "pb-ky-thuat",
    pack: "editor",
  },
  {
    username: "rowan.hoang",
    name: "Rowan Hoang",
    title: "Trưởng phòng chăm sóc khách hàng",
    dept: "pb-cskh",
    pack: "editor",
  },
  {
    username: "edgar.nguyen",
    name: "Edgar Nguyen",
    title: "Trưởng phòng R&D",
    dept: "pb-rnd",
    pack: "editor",
  },
];
export const ORG_DIRECTOR = "thomas.tran";
/** Người phụ trách hợp đồng nhận + trưởng phòng duyệt (Kinh doanh) + nhóm ký (chứa Thomas) của quy trình «Nhận HĐ từ đối tác (UAT)». */
export const ORG_RECEIVE = {
  owner: "julian.bui",
  approveDept: "pb-kinh-doanh",
  signGroup: "uat-nhan-ky",
  signer: ORG_DIRECTOR,
} as const;
const PACK_GROUP = { owner: "contracts-owner", editor: "contracts-editor" } as const;

export type OrgState = {
  users: ReadonlySet<string>;
  /** mã nhóm → tên đăng nhập thành viên */
  groups: ReadonlyMap<string, ReadonlySet<string>>;
  /** mã phòng ban (nhóm đã đánh dấu phòng ban) → trưởng phòng + phòng cha (tên đăng nhập / mã nhóm; null = chưa có/gốc) */
  depts: ReadonlyMap<string, { head: string | null; parent: string | null }>;
  /** tên đăng nhập → quản lý trực tiếp (tên đăng nhập hoặc null) */
  managers: ReadonlyMap<string, string | null>;
  /** tên đăng nhập → chức vụ (null/rỗng = trống) */
  titles: ReadonlyMap<string, string | null>;
};
export type OrgAction =
  | { op: "create_user"; username: string; name: string }
  | { op: "create_group"; key: string; name: string }
  | { op: "add_member"; group: string; username: string }
  | { op: "set_dept"; key: string; head: string; parent: string | null }
  | { op: "set_manager"; username: string; manager: string }
  | { op: "set_title"; username: string; title: string };

const memberActions = (s: OrgState): OrgAction[] => {
  const out: OrgAction[] = [];
  const add = (group: string, username: string): void => {
    if (!(s.groups.get(group)?.has(username) ?? false))
      out.push({ op: "add_member", group, username });
  };
  for (const p of ORG_PEOPLE) add(p.dept, p.username);
  add(ORG_RECEIVE.signGroup, ORG_RECEIVE.signer);
  // chỉ thêm người của ta vào nhóm gói ĐÃ có
  for (const p of ORG_PEOPLE)
    if (s.groups.has(PACK_GROUP[p.pack])) add(PACK_GROUP[p.pack], p.username);
  return out;
};
/** Phòng chưa là phòng ban ⇒ đánh dấu + trưởng phòng + cha (gốc trước); phòng đã là phòng ban ⇒ không đụng. */
const deptActions = (s: OrgState): OrgAction[] =>
  ORG_DEPTS.filter((d) => !s.depts.has(d.key)).map(
    (d): OrgAction => ({
      op: "set_dept",
      key: d.key,
      head: d.head,
      parent: d.key === ORG_ROOT ? null : ORG_ROOT,
    }),
  );
/** Quản lý trực tiếp (= Giám đốc) và chức vụ: chỉ đặt khi còn trống. */
const personActions = (s: OrgState): OrgAction[] =>
  ORG_PEOPLE.flatMap((p): OrgAction[] => [
    ...(p.username !== ORG_DIRECTOR && !s.managers.get(p.username)
      ? [{ op: "set_manager", username: p.username, manager: ORG_DIRECTOR } as const]
      : []),
    ...(s.titles.get(p.username)
      ? []
      : [{ op: "set_title", username: p.username, title: p.title } as const]),
  ]);

/** Kế hoạch THÊM sơ đồ tổ chức; trạng thái đã đạt ⇒ rỗng. Nhóm gói thiếu ⇒ `missingPackGroups` (script báo lỗi, không tự tạo). */
export function planOrg(s: OrgState): { actions: OrgAction[]; missingPackGroups: string[] } {
  const actions: OrgAction[] = [
    ...ORG_PEOPLE.filter((p) => !s.users.has(p.username)).map(
      (p): OrgAction => ({ op: "create_user", username: p.username, name: p.name }),
    ),
    ...ORG_DEPTS.filter((d) => !s.groups.has(d.key)).map(
      (d): OrgAction => ({ op: "create_group", key: d.key, name: d.vi }),
    ),
    ...memberActions(s),
    ...deptActions(s),
    ...personActions(s),
  ];
  return { actions, missingPackGroups: Object.values(PACK_GROUP).filter((k) => !s.groups.has(k)) };
}

/** Id người dùng từ phản hồi `POST /admin/users` (`{ user: { id }, temp_password }`; KHÔNG phải `{ id }`). */
export function createdUserId(resp: unknown): string {
  const id = (resp as { user?: { id?: unknown } }).user?.id;
  if (typeof id !== "string") throw new Error("phản hồi tạo người dùng không có user.id");
  return id;
}
