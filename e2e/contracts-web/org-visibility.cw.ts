// M1D-FR-02 · M1D-FR-03 · M1D-FR-04 · e2e Cài đặt › Thành viên & phòng ban (/settings/members): chủ sở hữu đổi chế độ sang "theo
// cơ cấu", đặt cấp quản lý, tạo phòng ban + trưởng phòng + thành viên; rồi đăng nhập lại bằng quản lý / trưởng phòng / người xem
// ⇒ danh sách HĐ đổi đúng theo luật thấy (người phụ trách, cấp dưới, thành viên phòng mình làm trưởng; HĐ của đồng nghiệp ẩn).
// Backend giả CÓ TRẠNG THÁI bằng `page.route` (như `bell.cw.ts`): luật lọc ở đây phản chiếu RLS của hub-api (đã có int test riêng ở
// `apps/hub-api`); spec này kiểm màn hình + các yêu cầu API đúng hình + danh sách đổi theo cơ cấu. Dữ liệu duy nhất mỗi lần chạy
// (trạng thái giả nằm trong bộ nhớ test) ⇒ chạy lại luôn xanh. Không sleep: chờ phần tử / yêu cầu.
import { expect, type Page, type Route, test } from "@playwright/test";
import { asHub, dataset } from "./dataset";
import { categoriesAsHub, facetsAsHub, listAsHub, membersAsHub, ROWS } from "./dataset-list";

test.skip(process.env.CW_MODE === "ref", "chế độ chụp tham chiếu mgmt-app");

const uid = (n: number) => `a1000000-0000-4000-8000-0000000000${n.toString(16).padStart(2, "0")}`;
type Who = "lan" | "binh" | "chi" | "dung";
const USERS: Record<
  Who,
  { id: string; username: string; name: string; role: "owner" | "editor" | "viewer" }
> = {
  lan: { id: dataset.user.id, username: "lan", name: dataset.user.name, role: "owner" },
  binh: { id: uid(0xb1), username: "binh", name: "Bình Trần", role: "editor" },
  chi: { id: uid(0xc1), username: "chi", name: "Chi Lê", role: "viewer" },
  dung: { id: uid(0xd1), username: "dung", name: "Dũng Phạm", role: "viewer" },
};
// HĐ[i] ↔ người phụ trách: bao bì = Chi, gia vị = Dũng, vận chuyển = Bình.
const OWNER_OF: Who[] = ["chi", "dung", "binh"];
const [BAO_BI, GIA_VI, VAN_CHUYEN] = ROWS.map((r) => r.title) as [string, string, string];

type Dept = {
  group_id: string;
  key: string;
  name: string;
  head_user_id: string | null;
  member_ids: string[];
};
type Fake = {
  who: Who;
  mode: "tenant" | "org";
  managers: Map<string, string | null>;
  depts: Dept[];
  puts: { path: string; body: unknown }[];
};

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Luật thấy chế độ "org" (phản chiếu RLS): của mình + cấp dưới mọi tầng + thành viên phòng mình làm trưởng; owner thấy hết. */
function visible(f: Fake, owner: Who): boolean {
  const me = USERS[f.who];
  if (f.mode === "tenant" || me.role === "owner" || owner === f.who) return true;
  const target = USERS[owner].id;
  for (let cur: string | null | undefined = target, i = 0; cur && i < 50; i++) {
    cur = f.managers.get(cur);
    if (cur === me.id) return true;
  }
  return f.depts.some((d) => d.head_user_id === me.id && d.member_ids.includes(target));
}

async function install(page: Page): Promise<Fake> {
  const f: Fake = { who: "lan", mode: "tenant", managers: new Map(), depts: [], puts: [] };
  await page.addInitScript(() => {
    try {
      localStorage.setItem("ai.locale", "vi");
      localStorage.setItem("assistant:open", "0");
    } catch {
      /* storage bị chặn */
    }
  });
  const me = () => USERS[f.who];
  const hub = () => {
    const h = asHub(me().role);
    return {
      ...h,
      grant: {
        ...h.grant,
        user: { ...h.grant.user, id: me().id, username: me().username, display_name: me().name },
      },
    };
  };
  await page.route("**/auth/refresh", (r) => json(r, hub().grant));
  await page.route("**/pack/contracts/me", (r) => json(r, hub().packMe));
  const at = (p: string) => (u: URL) => u.pathname === p;
  await page.route(at("/pack/contracts/contracts/facets"), (r) => json(r, facetsAsHub()));
  await page.route(at("/pack/contracts/categories"), (r) => json(r, categoriesAsHub()));
  await page.route(at("/pack/contracts/members"), (r) => json(r, membersAsHub()));
  await page.route(at("/pack/contracts/contracts"), (r) => {
    const all = listAsHub();
    const items = all.items
      .map((it, i) => ({ ...it, owner_user_id: USERS[OWNER_OF[i] as Who].id }))
      .filter((_, i) => visible(f, OWNER_OF[i] as Who));
    return json(r, { ...all, items, total: items.length });
  });
  await page.route(at("/pack/contracts/visibility"), (r) => {
    if (r.request().method() === "PUT") {
      const b = r.request().postDataJSON() as { mode: Fake["mode"] };
      f.puts.push({ path: "visibility", body: b });
      f.mode = b.mode;
    }
    return json(r, { mode: f.mode });
  });
  await page.route(at("/admin/org"), (r) =>
    json(r, {
      members: Object.values(USERS).map((u) => ({
        user_id: u.id,
        username: u.username,
        display_name: u.name,
        manager_id: f.managers.get(u.id) ?? null,
      })),
      departments: f.depts,
    }),
  );
  await page.route(
    (u) =>
      u.pathname.startsWith("/admin/org/managers/") ||
      u.pathname.startsWith("/admin/org/departments/"),
    (r) => {
      const url = new URL(r.request().url());
      const id = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
      const body = r.request().postDataJSON() as Record<string, string | null>;
      f.puts.push({ path: url.pathname, body });
      if (url.pathname.includes("/managers/")) f.managers.set(id, body.manager_id ?? null);
      else {
        const d = f.depts.find((x) => x.group_id === id);
        if (d) d.head_user_id = body.head_user_id ?? null;
      }
      return json(r, { ok: true });
    },
  );
  await page.route(at("/admin/groups"), (r) => {
    const b = r.request().postDataJSON() as { key: string; name: { vi: string } };
    const d: Dept = {
      group_id: uid(0xe0 + f.depts.length),
      key: b.key,
      name: b.name.vi,
      head_user_id: null,
      member_ids: [],
    };
    f.depts.push(d);
    return json(r, { id: d.group_id }, 201);
  });
  await page.route(
    (u) => /^\/admin\/groups\/[^/]+\/members$/.test(u.pathname),
    (r) => {
      const gid = new URL(r.request().url()).pathname.split("/")[3];
      const b = r.request().postDataJSON() as { usernames: string[] };
      const d = f.depts.find((x) => x.group_id === gid);
      for (const n of b.usernames) {
        const u = Object.values(USERS).find((x) => x.username === n);
        if (d && u && !d.member_ids.includes(u.id)) d.member_ids.push(u.id);
      }
      return json(r, { ok: true });
    },
  );
  return f;
}

/** Đăng nhập lại bằng người khác (backend giả đổi người; tải lại trang ⇒ `/auth/refresh` trả người mới) rồi mở danh sách HĐ. */
async function listAs(page: Page, f: Fake, who: Who): Promise<string[]> {
  f.who = who;
  await page.goto("/contracts");
  await expect(
    page.getByRole("heading", { name: "Hợp đồng & giao dịch", exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText(new RegExp(`${[BAO_BI, GIA_VI, VAN_CHUYEN].join("|")}`)).first(),
  ).toBeVisible();
  const seen: string[] = [];
  for (const t of [BAO_BI, GIA_VI, VAN_CHUYEN])
    if ((await page.getByText(t).count()) > 0) seen.push(t);
  return seen;
}

test("M1D · /settings chuyển thẳng tới 'Thành viên & phòng ban' (/settings/members)", async ({
  page,
}) => {
  await install(page);
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/settings\/members$/);
  await expect(page.getByRole("heading", { name: "Thành viên & phòng ban" })).toBeVisible();
});

test("M1D · đổi cơ cấu ở /settings/members ⇒ danh sách HĐ của quản lý / trưởng phòng / người xem đổi theo", async ({
  page,
}) => {
  const f = await install(page);

  // Trước: chế độ tenant — người xem Chi thấy cả 3 HĐ.
  expect(await listAs(page, f, "chi")).toEqual([BAO_BI, GIA_VI, VAN_CHUYEN]);

  // Chủ sở hữu: chế độ org, Bình quản lý Chi, phòng "Kinh doanh" (mã kd) do Dũng làm trưởng, Bình là thành viên.
  f.who = "lan";
  await page.goto("/settings/members");
  await page.getByLabel("Phạm vi xem hợp đồng").selectOption("org");
  await expect.poll(() => f.mode).toBe("org");
  await page.getByLabel("Cấp quản lý · Chi Lê").selectOption({ label: "Bình Trần" });
  await expect.poll(() => f.managers.get(USERS.chi.id)).toBe(USERS.binh.id);
  await page.getByLabel("Tên phòng").fill("Kinh doanh");
  await page.getByLabel("Mã (a-z, 0-9, -)").fill("kd");
  await page.getByRole("button", { name: "Tạo phòng ban" }).click();
  await expect(page.getByRole("heading", { name: "Kinh doanh" })).toBeVisible();
  await page.getByLabel("Trưởng phòng · Kinh doanh").selectOption({ label: "Dũng Phạm" });
  await expect.poll(() => f.depts[0]?.head_user_id).toBe(USERS.dung.id);
  await page.getByLabel("Thêm thành viên · Kinh doanh").selectOption({ label: "Bình Trần" });
  await expect(
    page.getByRole("list", { name: "Thành viên phòng" }).getByText("Bình Trần"),
  ).toBeVisible();
  expect(f.puts).toContainEqual({ path: "visibility", body: { mode: "org" } });

  // Sau: mỗi người chỉ thấy phần của mình.
  expect(await listAs(page, f, "binh")).toEqual([BAO_BI, VAN_CHUYEN]); // của mình + của Chi (cấp dưới)
  expect(await listAs(page, f, "dung")).toEqual([GIA_VI, VAN_CHUYEN]); // của mình + thành viên phòng làm trưởng (Bình)
  expect(await listAs(page, f, "chi")).toEqual([BAO_BI]); // đồng nghiệp ngang cấp / cấp trên: ẩn
  expect(await listAs(page, f, "lan")).toEqual([BAO_BI, GIA_VI, VAN_CHUYEN]); // chủ sở hữu thấy hết

  // Bỏ quản lý của Chi ⇒ Bình mất HĐ của Chi, chỉ còn HĐ của mình.
  f.who = "lan";
  await page.goto("/settings/members");
  await page.getByLabel("Cấp quản lý · Chi Lê").selectOption({ label: "—" });
  await expect.poll(() => f.managers.get(USERS.chi.id)).toBeNull();
  expect(await listAs(page, f, "binh")).toEqual([VAN_CHUYEN]);
});
