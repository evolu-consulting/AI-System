// Fixture cố ý vi phạm T-DEP-3 nhánh npm: rules import hono.
import { Hono } from "hono";

export const canY = (): boolean => typeof Hono === "function";
