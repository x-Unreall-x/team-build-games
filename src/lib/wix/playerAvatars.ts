/**
 * Server-side adapter for the `PlayerAvatars` collection (per-game avatar overrides).
 *
 * The collection is ADMIN-only, so every call is elevated — clients never read/write it directly
 * (writes go through `/api/avatar`, reads happen during SSR / API routes). We key each row by a
 * DETERMINISTIC id `<gameSlug>-<memberId>`, which makes get/upsert O(1) by id and avoids a query
 * (queries + `auth.elevate` don't compose cleanly, since a query builder's HTTP fires later).
 */

import { auth } from "@wix/essentials";
import { items } from "@wix/data";

const COLLECTION = "PlayerAvatars";

/** Stable row id for a (member, game) pair. Games use short alnum slugs; member ids are GUIDs. */
export function playerAvatarId(memberId: string, gameId: string): string {
  const slug = gameId.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return `${slug}-${memberId}`;
}

/** The member's per-game avatar URL, or null when no override is set. */
export async function getGameAvatarUrl(memberId: string, gameId: string): Promise<string | null> {
  try {
    const item = await auth.elevate(items.getDataItem)(playerAvatarId(memberId, gameId), {
      dataCollectionId: COLLECTION,
    });
    const url = item?.data?.url;
    return typeof url === "string" && url.trim() !== "" ? url : null;
  } catch {
    return null; // not found (no override) or transient — caller falls back to the global avatar
  }
}

/** Insert or replace the member's per-game avatar URL (server-authoritative, elevated). */
export async function setGameAvatarUrl(memberId: string, gameId: string, url: string): Promise<void> {
  const _id = playerAvatarId(memberId, gameId);
  await auth.elevate(items.saveDataItem)({
    dataCollectionId: COLLECTION,
    dataItem: { _id, data: { _id, memberId, gameId, url } },
  });
}
