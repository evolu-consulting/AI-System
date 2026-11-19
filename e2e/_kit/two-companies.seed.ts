// CR-161 · dựng hai công ty cho hành trình kết nối: DB (người dùng + vai gói, cách của `seed-e2e-journey`) rồi API (hồ sơ, add-on, Danh bạ, bài công khai).
// Chạy một lần bởi `e2e/cr161/_cr161-stack.ts` SAU `_ja-stack.ts`. Không đụng công ty khác.
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Db } from "@ai/db";
import { JOURNEY_SPEC, setJourneyPasswords } from "../../tools/scripts/src/seed-e2e-journey";
import { runSeed } from "../../tools/scripts/src/seed-niti";
import type { Person } from "../../tools/scripts/src/seed-niti.data";
import {
  apiLogin,
  createPost,
  featureIdByKey,
  grantFeature,
  removeGroupMember,
  type Session,
  setCompanyListed,
  setCompanyProfile,
  tenantIdByKey,
} from "./api";
import { CO, NAME, POST_BODY, POST_BODY_B, WHO } from "./two-companies";

const byName = (u: string): Person => {
  const p = JOURNEY_SPEC.people.find((x) => x.username === u);
  if (!p) throw new Error(`two-companies: JOURNEY_SPEC không có ${u}`);
  return p;
};

/** Người của từng công ty: Tiên (Toàn quyền), Thanh (Toàn quyền thứ hai, KHÔNG phải người mời), Vy + Lan + Nam (nhân viên) · Dung (Toàn quyền) + Hà (nhân viên). */
function peopleOf(side: "a" | "b"): Person[] {
  const tien = byName(WHO.tien);
  const vy = byName(WHO.vy);
  const staff = (username: string, display: string): Person => ({
    ...vy,
    username,
    display,
    title: display,
  });
  if (side === "b") return [tien, staff(WHO.ha, NAME.ha)];
  return [
    tien,
    { ...tien, username: WHO.thanh, display: "E2E Thanh", title: "E2E Thanh", head: false },
    vy,
    staff(WHO.lan, NAME.lan),
    staff(WHO.nam, NAME.nam),
  ];
}

/** Bước DB: tenant + gói Sổ Hợp Tác + người + vai gói + mật khẩu cố định. */
export async function provisionPair(admin: Db, hub: Db, pw: string): Promise<void> {
  for (const side of ["a", "b"] as const) {
    const key = CO[side].key();
    const credFile = join(tmpdir(), `e2e-cr161-cred-${process.pid}-${side}.txt`);
    try {
      await runSeed(
        admin,
        hub,
        {
          ...JOURNEY_SPEC,
          tenantKey: key,
          tenantName: `E2E ${CO[side].name}`,
          emailDomain: `${key}.example.invalid`,
          people: peopleOf(side),
        },
        { apply: true, credFile },
      );
      await setJourneyPasswords(admin, key, pw);
    } finally {
      rmSync(credFile, { force: true });
    }
  }
}

/** Bước API: hồ sơ pháp lý + MST, add-on Bảng tin, Danh bạ bật, một bài công khai mỗi công ty (cho «Bảng tin <Công ty>» trong Tin nhắn), gỡ quyền Sổ Hợp Tác của Nam. */
export async function configurePair(o: {
  api: string;
  hub: string;
  pw: string;
  platform: Session;
}): Promise<void> {
  const community = await featureIdByKey(o.api, o.platform, "contracts-community");
  for (const side of ["a", "b"] as const) {
    const key = CO[side].key();
    const id = await tenantIdByKey(o.api, o.platform, key);
    await setCompanyProfile(o.api, o.platform, id, {
      legal_name: CO[side].name,
      tax_code: CO[side].tax,
      address: `${side === "a" ? 1 : 2} Phố Kết Nối, Hà Nội`,
    });
    await grantFeature(o.api, o.platform, community, id);
    const boss = await apiLogin({
      base: o.api,
      tenantKey: key,
      username: WHO.tien,
      password: o.pw,
      app: "contracts",
    });
    await setCompanyListed(o.hub, boss, true);
    await createPost(o.hub, boss, { type: "note", body: side === "a" ? POST_BODY : POST_BODY_B });
    if (side === "a") await removeGroupMember(o.api, o.platform, id, "contracts-editor", WHO.nam);
  }
}
