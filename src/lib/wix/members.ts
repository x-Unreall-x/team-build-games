/**
 * Server-side read of the current Wix member (impure Wix adapter). Returns a normalized
 * `MemberInfo` or `null` for anonymous visitors — the pure capability model lives in
 * `../members/capability`.
 *
 * Login/logout themselves need NO code here: Wix's Astro integration provides built-in
 * `/api/auth/login` and `/api/auth/logout` endpoints (see the account page + `<LockedFeature>`).
 *
 * ⚠️ The live member read is currently STUBBED to `null` (anonymous) because:
 *   1. `@wix/members` isn't installed yet — this environment has no npm-registry access
 *      (`npm install @wix/members` failed: `npm.dev.wixpress.com` unreachable). Install it in an
 *      environment that can reach the Wix registry.
 *   2. Real member login also needs the Wix **Members Area** app installed on the site + the
 *      return URLs added to the allowed authorization redirect URIs (Wix dashboard — owner action).
 * Returning `null` until then is the correct degraded state: everyone reads as anonymous, anonymous
 * play is unaffected, and member-only UI shows its locked/sign-in hint.
 *
 * TO ENABLE (once the two items above are done): delete the stub body and use this verbatim —
 *
 *   import { members } from "@wix/members";
 *   export async function getSessionMember(): Promise<MemberInfo | null> {
 *     try {
 *       const m = await members.getCurrentMember({ fieldsets: ["FULL"] });
 *       if (!m?._id) return null;
 *       return {
 *         id: m._id,
 *         name: m.profile?.nickname ?? m.profile?.slug ?? "Player",
 *         avatarUrl: m.profile?.photo?.url ?? null,
 *       };
 *     } catch {
 *       return null; // visitor, or Members Area app not installed
 *     }
 *   }
 */

import type { MemberInfo } from "../members/capability";

export async function getSessionMember(): Promise<MemberInfo | null> {
  // TODO(Track B / B0): enable the real read above once `@wix/members` is installed
  // and the Wix Members Area app + redirect URIs are configured.
  return null;
}
