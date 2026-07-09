import type { APIRoute } from "astro";
import { auth } from "@wix/essentials";
import { collections, items } from "@wix/data";
import { mergeTopScores, parseTopJson, scoreRowId, validateSquidResult } from "../../lib/squid/scores";
import type { ScoreEntry } from "../../lib/squid/scores";

const COLLECTION_ID = "GameScores";

/** First write auto-creates the collection; writes stay server-only (elevated), so every role is ADMIN. */
async function createScoresCollection(): Promise<void> {
  const TEXT = collections.Type.TEXT;
  const ADMIN = collections.Role.ADMIN;
  await auth.elevate(collections.createDataCollection)({
    _id: COLLECTION_ID,
    displayName: "Game Scores",
    fields: ["gameId", "stageId", "topJson"].map((key) => ({ key, type: TEXT })),
    permissions: { insert: ADMIN, update: ADMIN, remove: ADMIN, read: ADMIN },
  });
}

function isMissingCollection(e: unknown): boolean {
  const text = `${(e as Error)?.message ?? ""} ${JSON.stringify((e as { details?: unknown })?.details ?? "")}`;
  return /not[_ ]?found|does not exist|WDE0025/i.test(text);
}

const bad = (status: number) => new Response(null, { status });

/**
 * Trusted squid score write: the round HOST posts { stageId, timeMs, playerNames[] } on finish.
 * Server validates (stage allowlist + sanity bounds) and merges into the per-stage top-10 doc
 * with elevated creds — clients never write Wix Data directly. A cheating host can mis-report;
 * accepted for casual play (same posture as the roadmap's match-result route).
 */
export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad(400);
  }
  const result = validateSquidResult(body);
  if (!result) return bad(400);

  const entry: ScoreEntry = { timeMs: result.timeMs, names: result.names, at: new Date().toISOString() };
  const _id = scoreRowId(result.stageId);

  const readTop = async (): Promise<ScoreEntry[]> => {
    try {
      const item = await auth.elevate(items.getDataItem)(_id, { dataCollectionId: COLLECTION_ID });
      return parseTopJson(item?.data?.topJson);
    } catch {
      return []; // row (or collection) doesn't exist yet
    }
  };
  const save = (top: ScoreEntry[]) =>
    auth.elevate(items.saveDataItem)({
      dataCollectionId: COLLECTION_ID,
      dataItem: { _id, data: { _id, gameId: "squid", stageId: result.stageId, topJson: JSON.stringify(top) } },
    });

  try {
    await save(mergeTopScores(await readTop(), entry));
  } catch (e) {
    if (!isMissingCollection(e)) return bad(500);
    try {
      await createScoresCollection();
      await save(mergeTopScores([], entry));
    } catch {
      return bad(500);
    }
  }
  return new Response(null, { status: 204 });
};
