/**
 * Pirate Captain's Riposte (SRD 5.2): "the pirate adds 3 to its AC against that attack". The item's "+3 AC" effect lasts a round
 * in its data. The item already has its own identifier, `mm-riposte` (K6, §327: not the Battle Master's manoeuvre).
 */
import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { SOURCE_IDENTIFIERS } from "../module/scripts/content/sources.mjs";

describe("Pirate Captain's Riposte", () => {
  it("keeps its own identifier, apart from the Battle Master's riposte", () => {
    expect(SOURCE_IDENTIFIERS.mmRiposte0000000).toBe("mm-riposte");
    expect(CONTENT.riposte.triggers[0].on).toBe("isMissed");
    expect(CONTENT["mm-riposte"].triggers).toBeUndefined();
  });

  it("the effect placed on the pirate holds for the triggering attack only", () => {
    expect(CONTENT["mm-riposte"]).toEqual({ forOneAttack: true });
    expect(validateEntry(CONTENT["mm-riposte"])).toEqual([]);
  });
});
