// ADM-FR-01 · dữ liệu mẫu hợp lệ cho unit test contract (không export qua index).
import type { Me, Tenant, User } from "./index";

export const T0 = "2026-10-01T08:00:00.000Z";
export const T1 = "2026-10-01T09:00:00.000Z";
export const TENANT_ID = "0199a3b2-7c1e-7a2b-8c3d-1e2f3a4b5c6d";
export const USER_ID = "0199a3b2-7c1e-7a2b-8c3d-1e2f3a4b5c6e";
export const TEMP_PW = "Ab3dEf6hIj9lMn0p";

export const me: Me = {
  id: USER_ID,
  tenant: { id: TENANT_ID, key: "acme", name: "Acme" },
  username: "an",
  display_name: "An Nguyễn",
  email: "an@acme.test",
  role: "member",
  locale: "vi",
  must_change_password: false,
};

export const tenant: Tenant = {
  id: TENANT_ID,
  key: "acme",
  name: "Acme",
  active: true,
  status: "active",
  max_concurrent_sub: null,
  user_count: 7,
  created_at: T0,
  updated_at: T1,
  version: 2,
};

export const user: User = {
  id: USER_ID,
  tenant_id: TENANT_ID,
  tenant_key: "acme",
  username: "an",
  display_name: "An Nguyễn",
  email: null,
  role: "member",
  locale: "vi",
  status: "active",
  active: true,
  locked_by_tenant: false,
  locked_until: null,
  must_change_password: true,
  last_login_at: null,
  created_at: T0,
  updated_at: T1,
  version: 1,
};
