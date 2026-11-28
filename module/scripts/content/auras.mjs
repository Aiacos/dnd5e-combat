/**
 * Passive auras shipped with the module (adapter/auras.mjs). An item can correct its own
 * in `flags["dnd5e-combat"].aura`; without `effect`, it is the item's first transferred effect
 * that is copied onto allies.
 */

/** "Advantage on attack rolls and saving throws": one source of advantage per ability (dnd5e 6's AdvantageModeField). */
const ADVANTAGE_ATTACKS_AND_SAVES = ["str", "dex", "con", "int", "wis", "cha"].flatMap(a => [
  { key: `system.abilities.${a}.attack.roll.mode`, value: "1", type: "add" },
  { key: `system.abilities.${a}.save.roll.mode`, value: "1", type: "add" }
]);

/** "Advantage on all saving throws". */
const ADVANTAGE_SAVES = ["str", "dex", "con", "int", "wis", "cha"].map(a => ({ key: `system.abilities.${a}.save.roll.mode`, value: "1", type: "add" }));

export const AURAS = Object.freeze({
  // Weapon of Warning (SRD 5.2): "you and allies within a 9 m radius have […] Advantage on Initiative rolls" — the
  // data's enchantment only gives it to the weapon's bearer (transferred effect); the aura carries it to
  // allies.
  "weapon-of-warning-enchanted": { includeSelf: false, affects: "ally", radius: 30, units: "ft",
    changes: [{ key: "system.attributes.init.roll.mode", value: "1", type: "add" }] },
  // §403: Conjure Animals — "you have Advantage on Strength saving throws while within 1.50 m of the pack":
  // the pack's "Grant Save Advantage" item (PHB, `phbSpectralAnima`) carries the effect; it goes only to the summoner.
  "grant-save-advantage": { radius: 5, units: "ft", affects: "summoner", effect: "gUQO2xiVpjFo7gDz" },
  // §86: Holy Aura (PHB 2024) — "you emit an aura (9 m Emanation): creatures of your choice in it have Advantage on
  // all their saving throws"; the data's "Holy Protection" effect is empty and "Create Aura" has no template.
  // The attackers' Disadvantage and the save of a Fiend or an Undead: content/triggers.mjs.
  "holy-aura": { whileActive: true, includeSelf: true, affects: "ally", radius: 30, units: "ft", changes: ADVANTAGE_SAVES },
  // Seen in play on 2026-09-20: the item of the premium PHB 2.2.0 module (5.x format) has NO activity,
  // unlike the system 6.0 one. The radius therefore cannot always be read from a
  // template: it is taken from the class scale (10 ft, 30 ft at level 18), 10 ft by default.
  "aura-of-protection": { includeSelf: false, affects: "ally", radiusFormula: "@scale.paladin.aura", radius: 10, units: "ft" },
  // §16.47: Pass without Trace (PHB 2024) — "you and each creature of your choice within 9 m of you": an aura
  // held as long as the spell is (`whileActive`); dnd5e places its +10 only once, on the cast's targets.
  "pass-without-trace": { whileActive: true, includeSelf: true, affects: "ally", radius: 30, units: "ft" },
  // §159 (spell survey, batch 3): spell auras placed once on the cast's targets by the data — held as long as the spell
  // is, they follow the caster (9 m Emanation) and apply to the allies who enter.
  "crusaders-mantle": { whileActive: true, includeSelf: true, affects: "ally", radius: 30, units: "ft", effect: "A0Ygu7lYccaS4Q1K" },
  "aura-of-life": { whileActive: true, includeSelf: true, affects: "ally", radius: 30, units: "ft", effect: "GV4hKah5zwQ3Bisx" },
  "aura-of-purity": { whileActive: true, includeSelf: true, affects: "ally", radius: 30, units: "ft", effect: "oKsHTNzigUbEVvxo" },
  "circle-of-power": { whileActive: true, includeSelf: true, affects: "ally", radius: 30, units: "ft", effect: "WuYsg2mftQltuDIK" },
  // §18.12: Monster Manual bonus auras whose effect is missing, empty or wrong — the changes are declared here.
  // Aura of Authority (Hobgoblin Captain and Warlord): the hobgoblin itself and its allies within 3 m — no effect in the MM.
  "aura-of-authority": { includeSelf: true, affects: "ally", changes: ADVANTAGE_ATTACKS_AND_SAVES },
  // Marshal Undead (Death Knights): the Undead it designates, except itself, within 18 m — "Adv: Attacks & Saves"
  // effect with no change at all in the MM.
  "marshal-undead": { affects: "ally", types: ["undead"], changes: ADVANTAGE_ATTACKS_AND_SAVES },
  // Aura of Courage (Questing Knight): Immunity to Charmed and Frightened — the MM effect ALSO places these two conditions.
  "aura-of-bravery": { includeSelf: true, affects: "ally", changes: [
    { key: "system.traits.ci.value", value: "charmed", type: "add" },
    { key: "system.traits.ci.value", value: "frightened", type: "add" }
  ] }
});
