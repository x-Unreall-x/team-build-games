/**
 * Server-side read of the current Wix member (impure Wix adapter). Returns a normalized
 * `MemberInfo` or `null` for anonymous visitors — the pure capability model lives in
 * `../members/capability`.
 *
 * Login/logout need NO code here: Wix's Astro integration provides built-in `/api/auth/login`
 * and `/api/auth/logout` endpoints (see the account page + `<LockedFeature>`).
 *
 * Login detection uses the SESSION TOKEN ROLE (`getContextualAuth().loggedIn()`), not a
 * Members-API read: it's reliable and independent of Members-API scope or whether the member has a
 * profile. The profile read is best-effort, only to show a name/email/avatar.
 */

import { getContextualAuth } from "@wix/sdk-runtime/context";
import { members } from "@wix/members";
import type { MemberInfo } from "../members/capability";

export async function getSessionMember(): Promise<MemberInfo | null> {
  // Signal 1 — profile read. If it returns a member, we're logged in (and get name/email/avatar).
  try {
    const { member: m } = await members.getCurrentMember();
    if (m?._id) {
      return {
        id: m._id,
        name: m.profile?.nickname ?? m.profile?.slug ?? m.loginEmail ?? "Player",
        email: m.loginEmail ?? null,
        avatarUrl: m.profile?.photo?.url ?? null,
      };
    }
  } catch {
    /* profile read can fail on scope/profile even when logged in — fall through to the session check */
  }

  // Signal 2 — session token role. Catches a logged-in member whose profile read failed/was empty.
  // (loggedIn() lives on the concrete OAuthStrategy; the generic type doesn't declare it.)
  try {
    const auth = getContextualAuth() as { loggedIn?: () => boolean };
    if (auth.loggedIn?.() === true) return { id: "member", name: "Player", email: null, avatarUrl: null };
  } catch {
    /* not in an auth context */
  }
  return null; // visitor
}

