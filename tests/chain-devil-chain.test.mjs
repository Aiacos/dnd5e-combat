/**
 * The Chain Devil's Chain (SRD 5.2): an attack whose dnd5e identifier, "chain", is also that of the chain of the adventuring gear
 * (binding a creature: `contest`). A source gives it an identifier of its own.
 */
import { describe, it, expect } from "vitest";
import { CONTENT, SOURCES } from "../module/scripts/content/index.mjs";

describe("The Chain Devil's Chain: not the entry of the adventuring gear", () => {
  it("the attack has its own identifier, without an entry; the gear's chain keeps its own", () => {
    expect(SOURCES["mmChainDevil0000.mmChain000000000"]).toBe("mm-chain-devil-chain");
    expect(CONTENT["mm-chain-devil-chain"]).toBeUndefined();
    expect(CONTENT.chain?.contest).toBeTruthy();
  });
});
