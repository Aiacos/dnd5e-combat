import { describe, expect, it } from "vitest";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("Antipathie/sympathie (SRD 5.2) : l'une ou l'autre, au choix du lanceur", () => {
  it("les deux marques de l'activité « Cast » s'excluent", () => {
    expect(CONTENT["antipathy-sympathy"].choice).toEqual({ effects: "one" });
    expect(validateEntry(CONTENT["antipathy-sympathy"])).toEqual([]);
  });
});
