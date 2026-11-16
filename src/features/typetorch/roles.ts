/**
 * The web explorer's role checks (lib/auth.ts isReadOnly, lib/nav.ts ownerOnly) for a phone account: `admin` is an
 * owner (Roblox owner or the admin token), `web` the read-only role (a Roblox viewer). The backend enforces access
 * either way; these only hide what a session can't use.
 */
import type { BackendAccount } from "@/store/accounts";

export function isReadOnly(account: Pick<BackendAccount, "role"> | null | undefined): boolean {
	return account?.role === "web";
}

export function isOwner(account: Pick<BackendAccount, "role"> | null | undefined): boolean {
	return account?.role === "admin";
}
