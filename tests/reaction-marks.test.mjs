import { describe, it, expect, vi, afterEach } from "vitest";
import { markReactionDamage, takeReactionDamage, markReactionAdvantage, takeReactionAdvantage } from "../module/scripts/adapter/marks.mjs";

// §438 continued: the timer of an old mark must not erase the mark that replaced it (a missed Riposte, then a Riposte
// that hits less than a minute later: the superiority die disappeared from the damage).
describe("reaction marks: timers", () => {
  afterEach(() => vi.useRealTimers());

  it("a new damage mark survives the old one's timer", () => {
    vi.useFakeTimers();
    markReactionDamage("A", "1d8", "Riposte");          // missed Riposte: the mark stays
    vi.advanceTimersByTime(50000);
    markReactionDamage("A", "1d8", "Riposte");          // nouvelle Riposte
    vi.advanceTimersByTime(20000);                      // the old timer (60 s) would have expired here
    expect(takeReactionDamage("A")).toEqual({ formula: "1d8", name: "Riposte" });
  });

  it("a mark with no roll expires by itself, a taken mark does not come back", () => {
    vi.useFakeTimers();
    markReactionDamage("B", "1d8", "Riposte");
    vi.advanceTimersByTime(60001);
    expect(takeReactionDamage("B")).toBeNull();
    markReactionAdvantage("C", "Riposte");
    expect(takeReactionAdvantage("C")).toBe("Riposte");
    expect(takeReactionAdvantage("C")).toBeNull();
  });

  it("same for advantage", () => {
    vi.useFakeTimers();
    markReactionAdvantage("D", "x");
    vi.advanceTimersByTime(25000);
    markReactionAdvantage("D", "y");
    vi.advanceTimersByTime(10000);
    expect(takeReactionAdvantage("D")).toBe("y");
  });
});

import { noteReactionAttack } from "../module/scripts/adapter/marks.mjs";

describe("reaction marks: missed Riposte", () => {
  it("missed then saved by a reroll (Lucky): the die stays for that attack's damage", () => {
    markReactionDamage("E", "1d8", "Riposte");
    expect(noteReactionAttack("E")).toBe(false);       // missed roll; the reroll does not make a new attack roll
    expect(takeReactionDamage("E")).toEqual({ formula: "1d8", name: "Riposte" });
  });
  it("hit: the die waits for that attack's damage", () => {
    markReactionDamage("F", "1d8", "Riposte");
    expect(noteReactionAttack("F")).toBe(false);
    expect(takeReactionDamage("F")).toEqual({ formula: "1d8", name: "Riposte" });
  });
  it("really missed, then the same weapon's next blow: the die drops before its damage", () => {
    markReactionDamage("G", "1d8", "Riposte");
    noteReactionAttack("G");
    expect(noteReactionAttack("G")).toBe(true);
    expect(takeReactionDamage("G")).toBeNull();
  });
  it("an attack with another weapon does not touch the mark", () => {
    markReactionDamage("H", "1d8", "Riposte");
    expect(noteReactionAttack("autre")).toBe(false);
    expect(takeReactionDamage("H")).not.toBeNull();
  });
});
