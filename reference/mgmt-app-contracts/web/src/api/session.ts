import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, send } from "./client";

export type OrgRole = "owner" | "editor" | "viewer";
export type Me = {
  email: string; name: string; role: string | null; has_password?: boolean;
  org: { id: string; name: string; role: OrgRole } | null;
};

export const me = () => api<Me>("/auth/me");
export const login = (email: string, password: string) => api<Me>("/auth/login", send({ email, password }));
export const signup = (name: string, email: string, password: string) => api<Me>("/auth/signup", send({ name, email, password }));
export const logout = () => api<{ ok: boolean }>("/auth/logout", send({}));
export const createOrg = (name: string) => api<unknown>("/orgs", send({ name }));

/** Whether people may make their own account and company (off while sign-up is closed). */
export function useSignupOpen() {
  return useQuery({ queryKey: ["auth-options"], queryFn: () => api<{ signup: boolean }>("/auth/options"), staleTime: 300_000 })
    .data?.signup ?? false;
}

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: me, retry: false, staleTime: 60_000 });
}

export function useRefreshMe() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["me"] });
}

/** What the person may do in their organisation; the server checks again, this only hides buttons. */
export const canWrite = (m: Me | undefined) => !!m?.org && m.org.role !== "viewer";
export const isOwner = (m: Me | undefined) => m?.org?.role === "owner";
