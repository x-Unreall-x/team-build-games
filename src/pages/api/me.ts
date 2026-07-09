import type { APIRoute } from "astro";
import { getSessionMember, debugAuth } from "../../lib/wix/members";
import { capabilityOf } from "../../lib/members/capability";

/** Current auth state for client islands (Arena etc.) to drive avatars + `<LockedFeature>`. */
export const GET: APIRoute = async ({ url }) => {
  // Temporary diagnostic: /api/me?debug=1 surfaces how member identity resolves in this context.
  if (url.searchParams.get("debug") === "1") {
    return new Response(JSON.stringify(await debugAuth()), {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
  const member = await getSessionMember();
  // `paid` (an active plan) arrives with Track B B3; today a signed-in member is `member`.
  const capability = capabilityOf(member);
  return new Response(JSON.stringify({ member, capability }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};
