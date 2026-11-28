#!/usr/bin/env node
/**
 * §393: sets up (or restores) the "Summons Arena" of a test world, through the connector — a scene dedicated to
 * targeting summons: a corpse to raise (Finger of Death, Animate Dead on a body, darsh-loot), a dead beast that does not
 * rise, a weapon bearer (Elemental Weapon, object enchantments), a victim at 1 HP. Used by the scenario
 * `invocations-ciblees` and, with `CIBLEES=1`, by the `balayage-invocations` sweep.
 *
 *   node tools/arene-invocations.mjs     creates what is missing, resets actors, conditions and tokens to their reference state
 *
 * Positions in cells: `ARENE_INVOCATIONS` (tools/lib/stages.mjs), restored by the scenario runner before each scenario.
 */
import { buildArena } from "./lib/arena.mjs";
import { ARENE_INVOCATIONS } from "./lib/stages.mjs";

const PHB = "Compendium.dnd-players-handbook.actors.";
const SLOTS = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`spell${i + 1}`, { value: 9, override: 9 }]));
const sturdy = { attributes: { hp: { value: 999, max: 999 }, ac: { flat: 12, calc: "flat" } } };

const ACTORS = {
  "Lanceur": { base: "mmArchmage000000", disposition: 1, system: {
    abilities: { int: { value: 20 }, wis: { value: 20 }, cha: { value: 20 }, con: { value: 14 } },
    attributes: { hp: { value: 999, max: 999 }, ac: { flat: 15, calc: "flat" }, spellcasting: "int", spell: { level: 20 } },
    spells: SLOTS, details: { cr: 12 } } },
  "Héros": { pack: PHB, base: "phbprgBarbarian0", keepItems: true, disposition: 1, system: { attributes: { hp: { value: 999, max: 999 } } } },
  // A dead commoner: Medium Humanoid, 0 HP, "Dead" condition — a corpse for darsh-loot.
  "Cadavre": { base: "mmCommoner000000", disposition: -1, statuses: ["dead"], system: { attributes: { hp: { value: 0, max: 4 } } } },
  // A dead wolf: a Beast, which neither Animate Dead nor Finger of Death raise.
  "Bête morte": { base: "mmWolf0000000000", disposition: -1, statuses: ["dead"], system: { attributes: { hp: { value: 0, max: 11 } } } },
  // A living victim at 1 HP: a spell that kills then raises (Finger of Death) turns it from living to corpse.
  "Victime": { base: "mmCommoner000000", disposition: -1, system: { ...sturdy, attributes: { ...sturdy.attributes, hp: { value: 1, max: 4 } } } }
};

await buildArena({ stage: ARENE_INVOCATIONS, folder: "DAS · Arène des invocations", flag: "invocations", actors: ACTORS });
