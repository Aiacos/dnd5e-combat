/**
 * Les sorts et objets que le SRD 2024 renomme gardent l'id de document du livre, pas son identifiant : l'entrée écrite sous l'un
 * des deux identifiants doit valoir pour l'autre. Vu : le Coffre secret (entrée sous `secret-chest`) ne recevait rien quand l'item
 * venait du Manuel des joueurs (`leomunds-secret-chest`).
 */
import { describe, it, expect } from "vitest";
import { SHIPPED, SRD_ALIASES } from "../module/scripts/content/index.mjs";

describe("identifiants du SRD et du livre : une entrée, les deux noms", () => {
  it("le Coffre secret du Manuel reçoit l'entrée écrite sous l'identifiant du SRD", () => {
    expect(SHIPPED["secret-chest"]?.summon?.initiative).toBe("none");
    expect(SHIPPED["leomunds-secret-chest"]).toBe(SHIPPED["secret-chest"]);
  });
  it("aucune paire de la table n'a l'entrée d'un seul côté", () => {
    const oneSided = Object.entries(SRD_ALIASES).filter(([srd, book]) => !!SHIPPED[srd] !== !!SHIPPED[book]);
    expect(oneSided).toEqual([]);
  });
  it("l'entrée écrite sous l'identifiant du livre vaut toujours pour celui du SRD", () => {
    expect(SHIPPED["black-tentacles"]).toBe(SHIPPED["evards-black-tentacles"]);
  });
});
