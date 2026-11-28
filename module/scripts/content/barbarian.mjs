/**
 * The 2024 Player's Handbook Barbarian (SPEC §22), premium module `dnd-players-handbook` 2.2.0 (pack `classes`, items
 * `phbbrb…`). French PHB vocabulary: Rage, Reckless Attack, Instinctive Pounce, Relentless Rage, Persistent Rage, Frenzy
 * (Path of the Berserker), Divine Fury (Path of the Zealot).
 *
 * What dnd5e already does alone: the Rage effects (Resistances, melee damage bonus, Advantage on Strength), Unarmored
 * Defense, Danger Sense, Fast Movement, Feral Instinct, Mindless Rage, Primal Knowledge; Extra Attack is in
 * the budget. Duration and end of Rage, Reckless Attack: runtime/barbarian.mjs.
 */

/** A share of bonus damage, once per turn, on your turn, on a weapon or unarmed hit. */
const onceOnOwnTurn = (condition, formula, damageType) => ({
  on: "preDamageRoll", oncePerTurn: true,
  if: { "activity.isAttack": true, "activity.isWeapon": true, "source.onOwnTurn": true, ...condition },
  do: [{ type: "damage", formula, damageType }]
});

/** "Staggered" (Staggering Blow): Disadvantage on saves — the effect is empty in the data. */
const STAGGERED_SAVES = ["str", "dex", "con", "int", "wis", "cha"].map(a => ({ key: `system.abilities.${a}.save.roll.mode`, type: "add", value: "-1" }));

export const BARBARIAN = Object.freeze({
  // Rage: the item's effect (G5XZTi4zYTFiHVll), activated by "Expend Rage". "It lasts until the end of your next turn";
  // it is kept up by attacking an enemy, forcing a saving throw on an enemy, or with a Bonus Action.
  // Fast Movement (SRD 5.2): "your Speed increases by 3 m while you are not wearing heavy armor" — the data's
  // effect is unconditional (its Foundry note says to disable it by hand).
  "fast-movement": { effectWhile: { Ln2upWfCALSwthX1: { if: { notArmor: ["heavy"] } } } },
  "rage": { rage: { effect: "G5XZTi4zYTFiHVll" } },
  // §301: Retaliation (level 14) — "when you take damage from a creature within 1.50 m, your Reaction: a melee attack
  // with a weapon or unarmed against it".
  "retaliation": { triggers: [{ on: "isDamaged", if: { "target.within": { distance: 5, units: "ft" } }, do: [{ type: "use", target: "source", weapon: true }] }] },
  // Persistent Rage (level 15): "it lasts 10 minutes without you having to do anything to keep it up; it ends earlier
  // if you have the Unconscious condition (not only Incapacitated)".
  // C12-a: "when you roll Initiative, you can regain all expended uses of Rage" — once per Long Rest (the item's
  // use).
  "persistent-rage": { persistentRage: true, regainOnInitiative: { items: ["rage"], uses: true } },
  // Reckless Attack (level 2): chosen at the first attack roll of the turn; until the start of the barbarian's next turn,
  // their Strength-based attacks have Advantage, and those that target them too.
  "reckless-attack": { reckless: true },
  // C12-e: Brutal Strike (level 9) — with Reckless Attack, giving up Advantage on a Strength attack: on a hit, 1d10 (2d10 at
  // level 17: the subclass's scale) of the weapon's type and an effect. Forceful Blow: push of 4.50 m (the barbarian's
  // movement toward it stays with the player); Hamstring Blow: -4.50 m of Speed until the start of your next turn
  // ("Hamstrung"). The question, the mark and the effects: runtime/barbarian.mjs.
  // §433: dnd5e 6.1's SRD puts the four blows on this item — "Staggered" (`uacly0JAXLVwAS6y`) and "Sundered"
  // (`Q0ou16II1WEcCdyW`) are effects of Brutal Strike there, no longer of Improved Brutal Strike: their rules are restated
  // here under these identifiers. The options, for their part, are still given by Improved Brutal Strike (level 13).
  "brutal-strike": {
    // §456: the "Sundering Blow" activity also cites `tUyuyTQGmpUqMcFe`, absent from the item — the id of the same effect on the
    // SRD's pregenerated character (`actors24`), copied into the SRD 6.1 and Manual 3.0.0 compendium. Only "Sundered"
    // (`Q0ou16II1WEcCdyW`) remains.
    dataFixes: [{ path: "system.activities.MP1qQsApCj19F2M5.effects", from: [{ _id: "tUyuyTQGmpUqMcFe" }, { _id: "Q0ou16II1WEcCdyW" }],
      value: [{ _id: "Q0ou16II1WEcCdyW" }] }],
    brutalStrike: { options: { forceful: { push: { distance: 15, units: "ft" } }, hamstring: { effect: "bg9jWpPRIJ0Q2vPY" } } },
    effectEnds: { bg9jWpPRIJ0Q2vPY: "casterTurnStart", uacly0JAXLVwAS6y: "casterTurnStart", Q0ou16II1WEcCdyW: "casterTurnStart" },
    // "Hamstrung" writes to `movement.speed`, a derived value that dnd5e rewrites: the ground Speed. §433: not when the
    // effect already removes the speed through `movement.bonus` (dnd5e 6.1 SRD), otherwise −30 ft.
    effectChanges: {
      bg9jWpPRIJ0Q2vPY: [{ key: "system.attributes.movement.walk", type: "add", value: "-15", unlessKey: "system.attributes.movement.bonus" }],
      uacly0JAXLVwAS6y: STAGGERED_SAVES
    },
    noOpportunityAttacks: ["uacly0JAXLVwAS6y"],
    triggers: [
      { on: "preDamageRoll", if: { "activity.isAttack": true, "source.hasEffect": "brutal-strike" },
        // §438: 1d10, 2d10 at level 17 — read from the Barbarian level. The `@scale.barbarian.brutal-strike` scale (class, Manual
        // 2.2.0) has become `@scale.brutal-strike.damage` (the feature, Manual 3.0.0): neither exists on every sheet.
        do: [{ type: "damage", formula: "(1 + floor(@classes.barbarian.levels / 17))d10", damageType: "weapon" }] },
      { on: "preAttackRoll", via: "effect", fromEffect: "Q0ou16II1WEcCdyW",
        if: { "target.hasEffect": { item: "brutal-strike", effect: "Q0ou16II1WEcCdyW" }, not: { "target.hasEffectFrom": { item: "brutal-strike", effect: "Q0ou16II1WEcCdyW" } } },
        do: [{ type: "attackBonus", formula: "5" }, { type: "consume", side: "target" }] }
    ]
  },
  // Improved Brutal Strike (13): Staggering Blow — Disadvantage on the next save, no Opportunity Attack, until the start of
  // your next turn ("Staggered", empty in the data: all its saves until then, a simplification); Sundering Blow — +5 to the
  // next attack by another creature against it ("Sundered", consumed).
  "improved-brutal-strike": {
    // §433: the option's effect, under this item's identifier (Player's Handbook, SRD up to dnd5e 6.0) or under that of Brutal
    // Strike (dnd5e 6.1 SRD) — the first that one of the actor's Brutal Strike items carries.
    brutalStrike: { options: { staggering: { effect: ["L9N4evZo1jt46dap", "uacly0JAXLVwAS6y"] }, sundering: { effect: ["tUyuyTQGmpUqMcFe", "Q0ou16II1WEcCdyW"] } } },
    effectEnds: { L9N4evZo1jt46dap: "casterTurnStart", tUyuyTQGmpUqMcFe: "casterTurnStart" },
    effectChanges: { L9N4evZo1jt46dap: STAGGERED_SAVES },
    noOpportunityAttacks: ["L9N4evZo1jt46dap"],
    triggers: [{ on: "preAttackRoll", via: "effect", fromEffect: "tUyuyTQGmpUqMcFe",
      if: { "target.hasEffect": "improved-brutal-strike", not: { "target.hasEffectFrom": "improved-brutal-strike" } },
      do: [{ type: "attackBonus", formula: "5" }, { type: "consume", side: "target" }] }]
  },
  // Improved Brutal Strike (17): two different effects per Brutal Strike.
  "improved-brutal-strike-2": { brutalStrike: { count: 2 } },
  // Instinctive Pounce (level 7): "as part of the Bonus Action to enter Rage, you can move up to half your
  // Speed" — saying nothing about Opportunity Attacks.
  "instinctive-pounce": { movesAfter: { item: "rage", disengage: false } },
  // §236: Indomitable Might (level 18) — "if your total for a Strength check or saving throw is less than your Strength score,
  // you can use that score in place of the total" (runtime/feats.mjs: the d20 minimum).
  "indomitable-might": { scoreFloor: ["str"] },
  // §299 (pass C4) — features held by Rage (`duringRage`, runtime/barbarian.mjs):
  // Mindless Rage (Berserker): "Immunity to Charmed and Frightened while Raging; such a condition ends when you enter Rage".
  "mindless-rage": { duringRage: { enable: ["Y9LOXK6Q4vot2cxi"], cures: ["charmed", "frightened"] } },
  // Predator's Rage (Wild Heart): the chosen option only applies during the Rage — the copies its activities place fall with it.
  // (The item's "Rage of the Bear" effect is an activity effect: dnd5e 6.0.6 never transfers it, despite the active data.)
  // Core#98: "choose one of the following options" on entering Rage — a second option during the same Rage is refused (forceable).
  "rage-of-the-wilds": { duringRage: { copiesEnd: true, oneOption: true } },
  // Primal Knowledge: "while Raging, these checks are made with Strength".
  "primal-knowledge": { duringRage: { post: ["ufbJRsGGW3REMmJm"] } },
  // Vitality of the Tree (World Tree): "when you enter Rage, you gain Temporary Hit Points equal to your Barbarian level".
  "vitality-of-the-tree": { duringRage: { onStart: "HA6qXLiCmMuEq6r1" } },
  // §295 (pass): Intimidating Presence — Frightened "for 1 minute" (the data: one round), the save repeated at the end of
  // each of its turns (content/triggers.mjs).
  "intimidating-presence": { effectDurations: { "3LofAPFLZJMQJirN": { seconds: 60 } } },
  // §295: Aspect of the Wilds, Owl — the data's key has no `system.` prefix: no Darkvision. The aspect stays at the
  // player's choice (effect enabled by hand); only the change is rewritten.
  "aspect-of-the-wilds": { effectWhile: { CKLB1VHUlPsgOJxp: { changes: [{ key: "system.attributes.senses.ranges.darkvision", type: "add", value: "60" }] } } },
  // Fanatical Focus (Zealot 6): "once per active Rage, if you fail a saving throw, you can reroll it with
  // a bonus equal to your Rage damage, and you must use the new roll" — the saves that the engine reads.
  "fanatical-focus": { rollBonus: { on: ["save"], reroll: { bonus: "@scale.barbarian.rage-damage", during: "rage" } } },
  // Relentless Rage (level 11): "if you drop to 0 HP while Raging without dying outright, a DC 10 Constitution save: on a
  // success, your HP become twice your Barbarian level; the DC increases by 5 each use" — the item's save
  // (dnd5eactivity100, DC "10 + uses × 5").
  "relentless-rage": { relentless: { activity: "dnd5eactivity100" } },
  // Frenzy (Berserker 3): "if you use Reckless Attack while Raging, the first hit on your turn with a Strength attack deals
  // as many extra d6 as your Rage damage bonus, of the weapon's type".
  "frenzy": { triggers: [onceOnOwnTurn({ all: [{ "source.hasEffect": "rage" }, { "source.hasEffect": "reckless-attack" }] },
    "(@scale.barbarian.rage-damage)d6", "weapon")] },
  // Divine Fury (Zealot 3): while Raging, once per barbarian turn, their first weapon or unarmed hit adds 1d6 + half
  // their Barbarian level, necrotic or radiant — radiant here; the item can change it in its `triggers` flag.
  "divine-fury": { triggers: [onceOnOwnTurn({ "source.hasEffect": "rage" }, "1d6 + floor(@classes.barbarian.levels / 2)", "radiant")] }
});
