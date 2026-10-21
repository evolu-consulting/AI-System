// gap-c #12 · service worker thông báo đẩy (bản chép giống hệt ở public/ của 4 web; web-kit/src/notify/push-sw.test.ts giữ chúng khớp).
// Payload từ hub-api: { title, body, link } (link là đường dẫn trong app, bắt đầu "/"). Không cache, không chặn fetch.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch (_) {
    d = {};
  }
  e.waitUntil(
    self.registration.showNotification(d.title || "Thông báo", {
      body: d.body || "",
      data: { link: typeof d.link === "string" ? d.link : null },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const link = e.notification.data?.link;
  // Chỉ đường dẫn trong app: bắt đầu "/", không "//" hay "/\"; ghép với đường dẫn gốc của SW (studio chạy dưới /studio).
  const safe = typeof link === "string" && /^\/(?![/\\])/.test(link) ? link : "/";
  const base = new URL(self.registration.scope).pathname.replace(/\/$/, "");
  const url = new URL(base + safe, self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.focus();
          if ("navigate" in c) return c.navigate(url);
          return undefined;
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
