/**
 * Riposte du Capitaine pirate (SRD 5.2) : « the pirate adds 3 to its AC against that attack ». L'effet « +3 CA » de la donnée dure
 * un round ; sous l'identifiant partagé « riposte », l'item recevait en outre la manœuvre du Maître de bataille.
 */
import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { SOURCE_IDENTIFIERS } from "../module/scripts/content/sources.mjs";

describe("Riposte du Capitaine pirate", () => {
  it("a son identifiant propre, hors de « riposte » (la manœuvre du Maître de bataille)", () => {
    expect(SOURCE_IDENTIFIERS["mmPirateCaptain0.mmRiposte0000000"]).toBe("mm-pirate-captain-riposte");
    expect(CONTENT.riposte.triggers[0].on).toBe("isMissed");
    expect(CONTENT["mm-pirate-captain-riposte"].triggers).toBeUndefined();
  });

  it("l'effet posé sur le pirate ne vaut que pour l'attaque qui a ouvert la Réaction", () => {
    expect(CONTENT["mm-pirate-captain-riposte"]).toEqual({ forOneAttack: true });
    expect(validateEntry(CONTENT["mm-pirate-captain-riposte"])).toEqual([]);
  });
});
