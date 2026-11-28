/**
 * The 2024 Player's Handbook cantrips (SPEC §23), by dnd5e identifier (the same in the system's `spells24` and in
 * the premium module). Activity and effect ids taken from the `spells` pack of the premium module 2.2.0.
 *
 * Already complete elsewhere (§16): Blade Ward, Dancing Lights, Eldritch Blast, Guidance, Light, Produce Flame, Resistance,
 * Shillelagh, Spare the Dying, Starry Wisp, Thorn Whip, Vicious Mockery. Settled by dnd5e's data (the
 * engine only resolves): Acid Splash, Fire Bolt, Poison Spray, Sacred Flame (the engine never adds
 * Cover to saving throws), Sorcerous Burst (d8s that explode, type of choice), Thunderclap and Word of Radiance (Emanations
 * that spare the caster; Word of Radiance, "of your choice": the enemies). No effect in combat: Druidcraft,
 * Elementalism, Mending, Message, Prestidigitation, Thaumaturgy.
 *
 * `effectEnds`: the effect ends at the start or end of a specific turn — dnd5e gives them "1 round" or "1 turn", which it
 * expires at the start of any turn; the engine removes them at their time (runtime/cantrips.mjs).
 */

export const CANTRIPS = Object.freeze({
  // Chill Touch: "it cannot regain Hit Points until the end of your next turn" — "Blocked Healing" effect.
  "chill-touch": { blocksHealing: true, effectEnds: { zwks0mAqBHGZC1Pk: "casterTurnEnd" } },
  // Ray of Frost: "its Speed is reduced by 3 m until the start of your next turn" — "Reduced Movement" effect.
  "ray-of-frost": { effectEnds: { "7dnnwBMWLykrVJub": "casterTurnStart" } },
  // Mind Sliver: -1d4 on the target's next save, until the end of the caster's next turn — the "Slivered" effect
  // (-1d4 on saves) falls at the first save, otherwise at the end of the caster's next turn.
  "mind-sliver": { breaksOn: ["save"], effectEnds: { DMjD7IpAZuoVPCXY: "casterTurnEnd" } },
  // Shocking Grasp: "it cannot make Opportunity Attacks until the start of its next turn" — "Shocked" effect.
  "shocking-grasp": { noOpportunityAttacks: true, effectEnds: { DQCAm67ck1GEKHtE: "bearerTurnStart" } },
  // Vicious Mockery (§16.12): "… its next attack before the end of your next turn" — the "Mocked" effect.
  // §295 (pass): "its next attack before the end of ITS next turn" — the target's turn, not the caster's.
  "vicious-mockery": { effectEnds: { suEeAQQXl0X2JqzF: "bearerTurnEnd" } },
  // Toll the Dead: 1d8 necrotic, or 1d12 against an already wounded target — the item's two activities; the
  // right one is played based on the target, whichever was chosen.
  // §295: the Heroes of the Borderlands copy says "personal" on both activities (same ids as the Manual): 18 m, as the text.
  "toll-the-dead": { byWounds: { healthy: "LFXYm5sLg6D3ZilN", wounded: "w9KUTNVoj3K8XSlv" },
    ranges: { LFXYm5sLg6D3ZilN: { value: 60, units: "ft" }, w9KUTNVoj3K8XSlv: { value: 60, units: "ft" } } },
  // §295: "Star Dust" — "until the end of your next turn" (the data: one turn, at the start of any turn).
  "starry-wisp": { effectEnds: { T9kBIL7LS3j0Upwz: "casterTurnEnd" } },
  // Friends: no effect on a target that is not Humanoid; damage taken by the target ends the spell; §366: it also ends
  // when the caster makes an attack roll, deals damage or forces a saving throw (`breaksOnOrigin`). §402: "the target
  // succeeds automatically if it is not Humanoid, if you are fighting it" (`saveAutoSuccess.fighting`); if the caster cast it on it
  // within 24 h: up to the GM.
  "friends": { targets: { types: ["humanoid"] }, breaksOnOrigin: ["attack", "damage", "forcesSave"], saveAutoSuccess: { fighting: true },
    triggers: [{ on: "isDamaged", via: "effect", do: [{ type: "remove" }] }] },
  // Mage Hand, Minor Illusion: neither acts in combat.
  "mage-hand": { summon: { initiative: "none" } },
  "minor-illusion": { summon: { initiative: "none" } },
  // True Strike: "you make an attack with the weapon used to cast the spell" — a personal weapon, enchanted (spellcasting ability,
  // radiant damage of choice, extra radiant dice); the attack is granted at once, at no cost, and the enchantment
  // ends after it.
  "true-strike": { enchantTarget: "ownWeapon", oneAttack: true }
});
