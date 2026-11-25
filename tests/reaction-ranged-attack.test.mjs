/**
 * §334 : « Trigger: The giant is hit by a ranged attack roll and takes Bludgeoning, Piercing, or Slashing damage from it »
 * (Parade de projectiles du Géant des pierres, SRD 5.2) — la Réaction n'est proposée que pour une attaque à distance : un
 * coup d'épée ne l'ouvrait pas moins.
 */
import { describe, it, expect } from "vitest";
import { monsterReactionWindow } from "../module/scripts/core/monster-text.mjs";
import { holds } from "../module/scripts/core/triggers.mjs";

describe("Réaction de monstre : « hit by a ranged attack roll and takes … damage »", () => {
  const html = "<p><strong>Trigger:</strong> The giant is hit by a ranged attack roll and takes Bludgeoning, Piercing, or Slashing "
    + "damage from it. <strong>Response:</strong> The giant reduces the damage it takes from the attack by 11.</p>";
  const [declared] = monsterReactionWindow(html, [], false, "a".repeat(16));
  const facts = ({ attack, melee, types }) => ({ "activity.isAttack": want => attack === want,
    "activity.isMelee": want => melee === want, "damage.hasType": want => [want].flat().some(t => types.includes(t)) });

  it("la fenêtre : blessé, par ces types de dégâts, d'une attaque qui n'est pas au corps à corps", () => {
    expect(declared).toEqual({ on: "isDamaged", do: [{ type: "use", activity: "a".repeat(16) }],
      if: { "damage.hasType": ["bludgeoning", "piercing", "slashing"], "activity.isAttack": true, "activity.isMelee": false } });
  });

  it("une flèche l'ouvre ; un coup d'épée, une sauvegarde, des dégâts de feu ne l'ouvrent pas", () => {
    expect(holds(declared.if, facts({ attack: true, melee: false, types: ["piercing"] }))).toBe(true);
    expect(holds(declared.if, facts({ attack: true, melee: true, types: ["slashing"] }))).toBe(false);
    expect(holds(declared.if, facts({ attack: false, melee: false, types: ["bludgeoning"] }))).toBe(false);
    expect(holds(declared.if, facts({ attack: true, melee: false, types: ["fire"] }))).toBe(false);
  });

  it("sans « ranged attack roll », rien ne change (« takes Piercing or Slashing damage »)", () => {
    const plain = monsterReactionWindow("<p><strong>Trigger:</strong> The shoggoth takes Piercing or Slashing damage.</p>");
    expect(plain).toEqual([{ on: "isDamaged", if: { "damage.hasType": ["piercing", "slashing"] }, do: [{ type: "use" }] }]);
  });
});
