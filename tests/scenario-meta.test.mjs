/** The filters of the scenario runner (`--grep`, `--section`, `--scene`): tools/lib/scenario-meta.mjs. */
import { describe, it, expect } from "vitest";
import { matches, scenarioMeta } from "../tools/lib/scenario-meta.mjs";

const TEXT = `/**
 * Zone qui dure (§16.8) : Rayon de lune, fin de tour dedans.
 */
export default {
  scene: "Escalade",
  name: "zone-duree — Rayon de lune, fin de tour du Zombi dedans (§47)",
};`;

describe("scenarios: what is read without loading them", () => {
  const meta = scenarioMeta(TEXT);
  it("title, summary, scene, cited §", () => {
    expect(meta.scene).toBe("Escalade");
    expect(meta.summary).toBe("Rayon de lune, fin de tour du Zombi dedans (§47)");
    expect(meta.refs).toEqual(["§16.8", "§47"]);
  });
  it("one word, without accents or case; several words: one or the other", () => {
    expect(matches("zone-duree", meta, { words: ["ZÔNE"] })).toBe(true);
    expect(matches("zone-duree", meta, { words: ["porte", "lune"] })).toBe(true);
    expect(matches("zone-duree", meta, { words: ["porte"] })).toBe(false);
  });
  it("a § applies to its subsections, not to a number that starts the same way", () => {
    expect(matches("x", meta, { sections: ["16"] })).toBe(true);
    expect(matches("x", meta, { sections: ["4"] })).toBe(false);
    expect(matches("x", meta, { sections: ["47"] })).toBe(true);
  });
  it("the scene; \"arene\": no scene declared; the filter families add up", () => {
    expect(matches("x", meta, { scenes: ["escalade"] })).toBe(true);
    expect(matches("x", meta, { scenes: ["arene"] })).toBe(false);
    expect(matches("x", scenarioMeta("export default { name: \"a — b\" };"), { scenes: ["arene"] })).toBe(true);
    expect(matches("zone-duree", meta, { words: ["lune"], sections: ["99"] })).toBe(false);
  });
});
