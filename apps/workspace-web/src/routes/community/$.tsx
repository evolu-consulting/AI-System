// CR-118 · `/community/profile/$orgId/$section` và mọi đường dưới /community: splat rỗng — module tự đọc URL (RouterPort.parsePath).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/community/$")({});
