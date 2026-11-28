/**
 * Spell defenses (SPEC §16.46), texts of the 2024 PHB (FR):
 *  - Resistance: "when the creature takes damage of the chosen type before the spell ends, it reduces the damage taken by
 *    1d4; the same creature can benefit from this spell only once per turn" — 11 "Protection: …" profiles without any
 *    change; the id of each one says its type (`_stats.duplicateSource` of the applied effect).
 *  - Arcane Vigor: the caster spends one or two Hit Dice and regains their total plus their spellcasting modifier;
 *    +1 die per slot level above 2nd — activity
 *    "Incanter" (`5paXkJ6hEw07yl8g`); the five healing activities by die size of dnd5e spend two dice by default.
 */

export const DAMAGE_SHIELDS = Object.freeze({
  "resistance": {
    formula: "1d4", oncePerTurn: true,
    effects: {
      u2mf5JowVgwqCARq: "acid", XYOXUUgKLjXXGt9W: "bludgeoning", Wpc5zvXyw2FSCJSD: "cold", S7XVvtgRT8uEP1iw: "fire",
      E8jlVJoTlfjKcz1r: "lightning", "2TZhhhCDUC2pqqNg": "necrotic", iR95ZjBkbXXD3Ena: "piercing", KZdzty5DTXdpGukZ: "poison",
      "9EhogBhAM9yIoREK": "radiant", sBrdZmXfn33LhYwh: "slashing", jP1TZyrEYtskdWXf: "thunder"
    }
  }
});

export const HIT_DICE_HEALS = Object.freeze({ "arcane-vigor": { activity: "5paXkJ6hEw07yl8g", base: 2 } });
