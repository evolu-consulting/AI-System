// Cài đặt người dùng của adapter mock (in-memory theo user).
import { type CommunitySettings, DEFAULT_SETTINGS } from "@ai/contracts/community";
import type { CommunityApi } from "./client";

export function settingsMock(
  userId: () => string,
): Pick<CommunityApi, "getSettings" | "saveSettings"> {
  const settings = new Map<string, CommunitySettings>();
  return {
    getSettings: async () => settings.get(userId()) ?? structuredClone(DEFAULT_SETTINGS),
    saveSettings: async (s) => {
      settings.set(userId(), s);
      return s;
    },
  };
}
