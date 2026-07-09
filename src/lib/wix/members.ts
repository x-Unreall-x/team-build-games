/**
 * Server-side read of the current Wix member (impure Wix adapter). Returns a normalized
 * `MemberInfo` or `null` for anonymous visitors — the pure capability model lives in
 * `../members/capability`.
 *
 * Login/logout themselves need NO code here: Wix's Astro integration provides built-in
 * `/api/auth/login` and `/api/auth/logout` endpoints (see the account page + `<LockedFeature>`).
 *
 * NOTE: real member login still needs (owner, Wix dashboard) the **Members Area** app installed on
 * the site + the return URLs added to the allowed authorization redirect URIs. Until then
 * `getCurrentMember()` yields no member and this returns `null` (anonymous) — the correct degraded
 * state; anonymous play is unaffected.
 */

import { members } from "@wix/members";
import type { MemberInfo } from "../members/capability";

export async function getSessionMember(): Promise<MemberInfo | null> {
  try {
    const { member: m } = await members.getCurrentMember({ fieldsets: ["FULL"] });
    if (!m?._id) return null;
    return {
      id: m._id,
      name: m.profile?.nickname ?? m.profile?.slug ?? "Player",
      avatarUrl: m.profile?.photo?.url ?? null,
    };
  } catch {
    return null; // visitor, or Members Area app not yet installed
  }
}
