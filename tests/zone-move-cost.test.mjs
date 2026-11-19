/**
 * Déplacer une zone déplaçable (`movable`) coûte l'activation de son sort — sauf quand la règle la fait suivre le déplacement du
 * lanceur (`cost: "none"`). Vu en jeu : déplacer le Cylindre d'Invocation de céleste (SRD 5.2) prenait l'action du lanceur.
 */
import { describe, it, expect } from "vitest";
import { zoneMoveCost } from "../module/scripts/core/turn.mjs";
import { MOVABLES } from "../module/scripts/content/movables.mjs";

describe("zoneMoveCost", () => {
  it("l'activation du sort par défaut ; rien quand la règle déclare un coût nul", () => {
    expect(zoneMoveCost({ distance: 60, units: "ft" }, "action")).toBe("action");
    expect(zoneMoveCost({ distance: 60, units: "ft" }, "bonus")).toBe("bonus");
    expect(zoneMoveCost({ distance: 30, units: "ft", cost: "none" }, "action")).toBeNull();
    expect(zoneMoveCost({ distance: 30, units: "ft" }, "minute")).toBeNull();
    expect(zoneMoveCost(null, "action")).toBe("action");
  });
  it("le contenu livré : Invocation de céleste suit le déplacement, Rayon de lune et Nuée de dagues prennent l'action", () => {
    expect(MOVABLES["conjure-celestial"]).toEqual({ distance: 30, units: "ft", cost: "none" });
    expect(zoneMoveCost(MOVABLES["conjure-celestial"], "action")).toBeNull();
    expect(zoneMoveCost(MOVABLES.moonbeam, "action")).toBe("action");
    expect(zoneMoveCost(MOVABLES["cloud-of-daggers"], "action")).toBe("action");
  });
});
