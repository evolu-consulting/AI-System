// CR-121 C-8 · mục đang chọn + khe tìm theo location ĐÍCH (đang chờ trang lười), không theo route đã khớp.
import { expect, test } from "bun:test";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { MODULES } from "./modules";
import { activeEntry, buildShellNav } from "./nav";
import { destPath, searchOwner } from "./use-nav-path";

test("khe tìm: chỉ module đích sở hữu; mục chọn: đúng 1 mục trong toàn thanh", () => {
  expect(searchOwner("/contracts/list")).toBe("contracts");
  expect(searchOwner("/community")).toBe("community");
  const groups = buildShellNav(
    MODULES,
    () => true,
    () => true,
  );
  const lit = (p: string) => groups.filter((g) => activeEntry(g, p)).length;
  expect(lit("/contracts/list")).toBe(1);
  expect(lit("/community")).toBe(1);
});

test("location của router (nguồn của useNavPath) là ĐÍCH khi trang đích còn tải; route đã khớp vẫn là cũ", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const root = createRootRoute();
  const a = createRoute({ getParentRoute: () => root, path: "/community" });
  const b = createRoute({ getParentRoute: () => root, path: "/contracts", loader: () => gate });
  const router = createRouter({
    routeTree: root.addChildren([a, b]),
    history: createMemoryHistory({ initialEntries: ["/community"] }),
  });
  await router.load();
  router.history.push("/contracts"); // (Transitioner của React tự gọi load khi history đổi; headless thì gọi tay)
  const nav = router.load();
  await new Promise((r) => setTimeout(r, 20));
  const s = router.stores.__store.get();
  expect(s.resolvedLocation?.pathname).toBe("/community"); // route cũ còn vẽ
  expect(s.location.pathname).toBe("/community"); // store location chỉ đổi khi commit ⇒ KHÔNG dùng cho khung
  expect(destPath(router)).toBe("/contracts"); // useNavPath đọc nguồn này (lịch sử đổi ngay lúc bấm)
  release();
  await nav;
});
