// HUB-FR-72 · H4a-R02 · đọc `me` từ cache (guard `_authed` đã nạp); component không import api trực tiếp.
import { useQuery } from "@tanstack/react-query";
import { meQuery } from "../api";

export const useMe = () => useQuery(meQuery).data;
