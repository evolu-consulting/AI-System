// Fixture cố ý vi phạm T-DEP-4: service import hono (gói npm, resolve qua store .bun/…/hono/dist/).
import { Hono } from "hono";

export const serviceB = () => new Hono();
