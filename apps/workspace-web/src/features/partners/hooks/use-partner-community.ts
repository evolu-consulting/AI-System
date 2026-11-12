// CR-130 · truy vấn/ghi khối Bảng tin của đối tác (hồ sơ, tài khoản đã mời, danh sách tài khoản chưa gắn).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  communityKeys,
  fetchCommunity,
  fetchCommunityCandidates,
  saveCommunityAccount,
  saveCommunityProfile,
} from "../api";

export const useCommunity = (party: string, enabled: boolean) =>
  useQuery({
    queryKey: communityKeys.one(party),
    queryFn: ({ signal }) => fetchCommunity(party, signal),
    enabled,
  });

export const useCandidates = (enabled: boolean) =>
  useQuery({
    queryKey: communityKeys.candidates,
    queryFn: ({ signal }) => fetchCommunityCandidates(signal),
    enabled,
  });

export function useCommunityWrites(party: string) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ["partners", "community"] });
  return {
    saveProfile: useMutation({
      mutationFn: (v: { cats: string[]; area: string }) => saveCommunityProfile({ party, ...v }),
      onSuccess: done,
    }),
    setAccount: useMutation({
      mutationFn: (extOrgId: string | null) =>
        saveCommunityAccount({ party, ext_org_id: extOrgId }),
      onSuccess: done,
    }),
  };
}
