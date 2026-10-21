// gap-c · `href` nội bộ của thông báo ("/contracts/1", "/notifications#prefs") ⇒ đối số cho `navigate({ to, hash })` của router app.
export function splitHref(href: string): { to: string; hash?: string } {
  const i = href.indexOf("#");
  return i < 0 ? { to: href } : { to: href.slice(0, i), hash: href.slice(i + 1) };
}
