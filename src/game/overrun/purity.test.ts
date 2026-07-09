// src/game/overrun/purity.test.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The determinism guard the roadmap demands: no wall-clock or ambient randomness
 * in the sim core. net/ (wire boundary — session mints the seed) and render/
 * (engine adapter) are exempt; test files are exempt.
 */
const CORE_DIR = join(__dirname);
const BANNED = [/Math\.random/, /Date\.now/, /new Date\(/, /performance\.now/];

describe("overrun sim core purity", () => {
  it("contains no clocks or ambient RNG in top-level core files", () => {
    const files = readdirSync(CORE_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(8);
    for (const f of files) {
      const src = readFileSync(join(CORE_DIR, f), "utf8");
      for (const rx of BANNED) {
        expect(src, `${f} must not use ${rx}`).not.toMatch(rx);
      }
    }
  });

  it("core files import nothing from net/ or render/ or engines", () => {
    const files = readdirSync(CORE_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    for (const f of files) {
      const src = readFileSync(join(CORE_DIR, f), "utf8");
      expect(src, `${f} must stay engine/transport-free`).not.toMatch(/from ["']\.\/(net|render)\//);
      expect(src, `${f} must stay engine/transport-free`).not.toMatch(/from ["']phaser["']/i);
    }
  });

  it("no overrun file — including tests — imports from arena/: Arena and Overrun are separate games", () => {
    // Recursively collect all .ts files under overrun/ (including net/, render/, and tests)
    const allFiles: string[] = [];
    function walkDir(dir: string, relPath = "") {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relFilePath = relPath ? `${relPath}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walkDir(fullPath, relFilePath);
        } else if (entry.name.endsWith(".ts")) {
          allFiles.push(fullPath);
        }
      }
    }
    walkDir(CORE_DIR);
    expect(allFiles.length).toBeGreaterThan(8);
    for (const filePath of allFiles) {
      const src = readFileSync(filePath, "utf8");
      const shortName = filePath.replace(CORE_DIR + "/", "");
      expect(src, `${shortName} must not import from arena/`).not.toMatch(/from ["'][^"']*arena/);
    }
  });
});
