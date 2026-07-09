import { defineConfig } from "vitest/config";

/**
 * Tests are grouped PER GAME / area so each can run in isolation:
 *   npm test              → every main-tree suite
 *   npm run test:arena    → Arena (sim + netcode) only
 *   npm run test:members  → members-area helpers only
 *   npm run test:squid    → Squid (sim + net + score helpers) only
 *
 * `exclude` drops build output, deps, and git worktrees under `.claude/worktrees/*`
 * (those hold OTHER branches' full checkouts). Without a config in THIS tree, vitest
 * walks up to the main checkout's config, whose excludes silently skip this tree's tests.
 */
const exclude = ["**/node_modules/**", "**/dist/**", "**/.astro/**", "**/.claude/**", "**/.git/**"];

export default defineConfig({
  test: {
    exclude,
    projects: [
      {
        test: {
          name: "arena",
          environment: "node",
          exclude,
          include: ["src/game/arena/**/*.test.ts", "src/game/net/**/*.test.ts", "src/game/audio/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "members",
          environment: "node",
          exclude,
          include: ["src/lib/members/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "squid",
          environment: "node",
          exclude,
          include: ["src/game/squid/**/*.test.ts", "src/lib/squid/**/*.test.ts"],
        },
      },
    ],
  },
});
