// Client HTTP riêng của studio-web cho kit (kit không biết token của web này). Dưới base `/studio`: API `/notifications` ở gốc origin.
import { api } from "#/lib/http";

export const KIT_TRANSPORT = { request: api };
