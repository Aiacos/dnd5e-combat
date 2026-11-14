import { describe, it, expect, vi, afterEach } from "vitest";
import { markReactionDamage, takeReactionDamage, markReactionAdvantage, takeReactionAdvantage } from "../module/scripts/adapter/marks.mjs";

// §438 suite : le minuteur d'une marque ancienne ne doit pas effacer la marque qui l'a remplacée (Riposte ratée, puis Riposte
// qui touche moins d'une minute après : le dé de supériorité disparaissait des dégâts).
describe("marques de réaction : minuteurs", () => {
  afterEach(() => vi.useRealTimers());

  it("une nouvelle marque de dégâts survit au minuteur de l'ancienne", () => {
    vi.useFakeTimers();
    markReactionDamage("A", "1d8", "Riposte");          // Riposte ratée : la marque reste
    vi.advanceTimersByTime(50000);
    markReactionDamage("A", "1d8", "Riposte");          // nouvelle Riposte
    vi.advanceTimersByTime(20000);                      // l'ancien minuteur (60 s) serait tombé ici
    expect(takeReactionDamage("A")).toEqual({ formula: "1d8", name: "Riposte" });
  });

  it("une marque sans jet tombe d'elle-même, une marque prise ne revient pas", () => {
    vi.useFakeTimers();
    markReactionDamage("B", "1d8", "Riposte");
    vi.advanceTimersByTime(60001);
    expect(takeReactionDamage("B")).toBeNull();
    markReactionAdvantage("C", "Riposte");
    expect(takeReactionAdvantage("C")).toBe("Riposte");
    expect(takeReactionAdvantage("C")).toBeNull();
  });

  it("même chose pour l'avantage", () => {
    vi.useFakeTimers();
    markReactionAdvantage("D", "x");
    vi.advanceTimersByTime(25000);
    markReactionAdvantage("D", "y");
    vi.advanceTimersByTime(10000);
    expect(takeReactionAdvantage("D")).toBe("y");
  });
});

import { noteReactionAttack } from "../module/scripts/adapter/marks.mjs";

describe("marques de réaction : Riposte ratée", () => {
  it("ratée : le dé tombe, le coup suivant de la même arme ne l'a pas", () => {
    markReactionDamage("E", "1d8", "Riposte");
    expect(noteReactionAttack("E", { missed: true })).toBe(true);
    expect(takeReactionDamage("E")).toBeNull();
  });
  it("touchée : le dé attend les dégâts de cette attaque", () => {
    markReactionDamage("F", "1d8", "Riposte");
    expect(noteReactionAttack("F")).toBe(false);
    expect(takeReactionDamage("F")).toEqual({ formula: "1d8", name: "Riposte" });
  });
  it("issue inconnue puis une nouvelle attaque sans dégâts entre-temps : le dé tombe", () => {
    markReactionDamage("G", "1d8", "Riposte");
    noteReactionAttack("G");
    expect(noteReactionAttack("G")).toBe(true);
    expect(takeReactionDamage("G")).toBeNull();
  });
  it("une attaque d'une autre arme ne touche pas à la marque", () => {
    markReactionDamage("H", "1d8", "Riposte");
    expect(noteReactionAttack("autre", { missed: true })).toBe(false);
    expect(takeReactionDamage("H")).not.toBeNull();
  });
});
