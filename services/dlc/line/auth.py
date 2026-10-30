"""Bearer-token authentication against an OIDC realm (Keycloak), standard library only.

    v = Verifier.from_config(cfg)           # None when cfg.auth_issuer is empty (auth off)
    claims = v.verify(token)                # raises AuthError(401|403, code, message)
    v.require(claims, admin=False)          # role check (user role; admin role when admin=True)
    actor(claims)                           # preferred_username, else sub

Signature: RS256 (RSASSA-PKCS1-v1_5 with SHA-256) against the realm's JWKS
({issuer}/protocol/openid-connect/certs), cached for cfg.auth_jwks_ttl_s and refetched once when a
token names an unknown key id. Checks: iss == issuer, exp / nbf with cfg.auth_leeway_s, aud (string or
list) or azp contains cfg.auth_audience, and the role in realm_access.roles or resource_access[<client>].roles
for the audience / azp client. The admin role implies the user role.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import threading
import time
import urllib.request
from typing import Any, Callable, Dict, List, Mapping, Optional, Set

#: DER prefix of DigestInfo(SHA-256) for PKCS#1 v1.5
_SHA256_PREFIX = bytes.fromhex("3031300d060960864801650304020105000420")


class AuthError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message

    def to_dict(self) -> Dict[str, Any]:
        return {"code": self.code, "message": self.message, "detail": {}}


def b64url_decode(s: str) -> bytes:
    s = s.strip()
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def b64url_encode(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")


def _int(b64: str) -> int:
    return int.from_bytes(b64url_decode(b64), "big")


def rsa_verify_sha256(n: int, e: int, message: bytes, signature: bytes) -> bool:
    """RSASSA-PKCS1-v1_5 verification with SHA-256 (RFC 8017 8.2.2), constant-time comparison."""
    k = (n.bit_length() + 7) // 8
    if len(signature) != k:
        return False
    s = int.from_bytes(signature, "big")
    if s >= n:
        return False
    em = pow(s, e, n).to_bytes(k, "big")
    t = _SHA256_PREFIX + hashlib.sha256(message).digest()
    if k < len(t) + 11:
        return False
    expected = b"\x00\x01" + b"\xff" * (k - len(t) - 3) + b"\x00" + t
    return hmac.compare_digest(em, expected)


def _fetch_json(url: str, timeout: float = 10.0) -> Dict[str, Any]:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:   # noqa: S310 - the configured realm URL
        return json.loads(r.read().decode("utf-8"))


class Verifier:
    def __init__(self, issuer: str, audience: str = "dlc-api", role_user: str = "dlc-user",
                 role_admin: str = "dlc-admin", jwks_ttl_s: int = 600, leeway_s: int = 60,
                 fetch: Optional[Callable[[str], Dict[str, Any]]] = None, clock: Callable[[], float] = time.time):
        self.issuer = issuer.rstrip("/")
        self.audience = audience
        self.role_user, self.role_admin = role_user, role_admin
        self.jwks_ttl_s, self.leeway_s = int(jwks_ttl_s), int(leeway_s)
        self._fetch = fetch or _fetch_json
        self._clock = clock
        self._keys: Dict[str, Dict[str, int]] = {}
        self._fetched = 0.0
        self._lock = threading.Lock()

    @classmethod
    def from_config(cls, cfg: Any) -> Optional["Verifier"]:
        issuer = str(getattr(cfg, "auth_issuer", "") or "").strip()
        if not issuer:
            return None
        return cls(issuer, cfg.auth_audience, cfg.auth_role_user, cfg.auth_role_admin, cfg.auth_jwks_ttl_s,
                   cfg.auth_leeway_s)

    @property
    def jwks_url(self) -> str:
        return self.issuer + "/protocol/openid-connect/certs"

    def _load_keys(self) -> None:
        doc = self._fetch(self.jwks_url)
        keys: Dict[str, Dict[str, int]] = {}
        for k in doc.get("keys") or []:
            if k.get("kty") != "RSA" or k.get("use", "sig") != "sig":
                continue
            try:
                keys[str(k.get("kid", ""))] = {"n": _int(k["n"]), "e": _int(k["e"])}
            except (KeyError, ValueError):
                continue
        self._keys, self._fetched = keys, self._clock()

    def _key(self, kid: str) -> Optional[Dict[str, int]]:
        with self._lock:
            stale = self._clock() - self._fetched > self.jwks_ttl_s
            if stale or (kid not in self._keys):
                try:
                    if stale or self._clock() - self._fetched > 5:   # an unknown kid refetches at most every 5 s
                        self._load_keys()
                except Exception as e:   # noqa: BLE001 - the realm is unreachable
                    if not self._keys:
                        raise AuthError(503, "AUTH_UNAVAILABLE", "cannot read the realm keys: %s" % e)
            if kid in self._keys:
                return self._keys[kid]
            if not kid and len(self._keys) == 1:
                return next(iter(self._keys.values()))
            return None

    def verify(self, token: str) -> Dict[str, Any]:
        parts = (token or "").split(".")
        if len(parts) != 3:
            raise AuthError(401, "UNAUTHENTICATED", "malformed token")
        try:
            header = json.loads(b64url_decode(parts[0]))
            claims = json.loads(b64url_decode(parts[1]))
            sig = b64url_decode(parts[2])
        except (ValueError, UnicodeDecodeError):
            raise AuthError(401, "UNAUTHENTICATED", "malformed token")
        if not isinstance(header, dict) or not isinstance(claims, dict):
            raise AuthError(401, "UNAUTHENTICATED", "malformed token")
        if header.get("alg") != "RS256":
            raise AuthError(401, "UNAUTHENTICATED", "unsupported token algorithm %r" % header.get("alg"))
        key = self._key(str(header.get("kid") or ""))
        if key is None:
            raise AuthError(401, "UNAUTHENTICATED", "token signed with an unknown key")
        if not rsa_verify_sha256(key["n"], key["e"], (parts[0] + "." + parts[1]).encode("ascii"), sig):
            raise AuthError(401, "UNAUTHENTICATED", "bad token signature")
        if not hmac.compare_digest(str(claims.get("iss", "")).rstrip("/"), self.issuer):
            raise AuthError(401, "UNAUTHENTICATED", "token issuer is not this realm")
        now = self._clock()
        try:
            exp = float(claims["exp"])
        except (KeyError, TypeError, ValueError):
            raise AuthError(401, "UNAUTHENTICATED", "token has no expiry")
        if now > exp + self.leeway_s:
            raise AuthError(401, "UNAUTHENTICATED", "token expired")
        nbf = claims.get("nbf")
        if nbf is not None and now + self.leeway_s < float(nbf):
            raise AuthError(401, "UNAUTHENTICATED", "token not valid yet")
        aud = claims.get("aud")
        auds = [aud] if isinstance(aud, str) else list(aud or [])
        if self.audience and self.audience not in auds and claims.get("azp") != self.audience:
            raise AuthError(401, "UNAUTHENTICATED", "token is not for %s" % self.audience)
        return claims

    def roles(self, claims: Mapping[str, Any]) -> Set[str]:
        out: Set[str] = set((claims.get("realm_access") or {}).get("roles") or [])
        ra = claims.get("resource_access") or {}
        for client in {self.audience, str(claims.get("azp") or "")}:
            if client:
                out.update((ra.get(client) or {}).get("roles") or [])
        return out

    def require(self, claims: Mapping[str, Any], admin: bool = False) -> None:
        roles = self.roles(claims)
        if admin:
            if self.role_admin not in roles:
                raise AuthError(403, "FORBIDDEN", "this action needs the %s role" % self.role_admin)
            return
        if self.role_user not in roles and self.role_admin not in roles:
            raise AuthError(403, "FORBIDDEN", "this API needs the %s role" % self.role_user)


def actor(claims: Optional[Mapping[str, Any]]) -> str:
    if not claims:
        return ""
    return str(claims.get("preferred_username") or claims.get("email") or claims.get("sub") or "")


def bearer(header: Optional[str]) -> str:
    h = (header or "").strip()
    return h[7:].strip() if h[:7].lower() == "bearer " else ""


#: routes that never need a token (prefix match on the path, exact for the rest)
# /api/catalog: what the line is made of (steps, roles, models) - no run or project data
OPEN_PATHS = ("/", "/board", "/board.html", "/api/health", "/api/openapi.json", "/api/auth/config", "/api/catalog")


def admin_route(method: str, path: str) -> bool:
    """Routes that need the admin role: cancel a run, stop a started app, everything under /api/admin/."""
    return path.startswith("/api/admin/") or (
        method == "POST" and (path.endswith(":cancel") or path.endswith("/app:stop")))


__all__ = ["AuthError", "Verifier", "actor", "bearer", "rsa_verify_sha256", "b64url_decode", "b64url_encode",
           "OPEN_PATHS", "admin_route"]
