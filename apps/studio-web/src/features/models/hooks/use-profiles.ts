// HUB-FR-67 · danh sách model profile (làm tươi 10 s để `active_step` theo trạng thái provider).
import { useQuery } from "@tanstack/react-query";
import { profilesQuery } from "../api";

export type { ProfileItem } from "../api";

export const useProfiles = () => useQuery(profilesQuery);
