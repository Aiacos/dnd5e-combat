#!/usr/bin/env node
/**
 * §414: sets up (or restores) the "Abjuration Arena" of a test world, through the connector — the scene of the scenario
 * `egide-abjurateur`: Arcane Ward under realistic play conditions, borrowing nothing from the shared tokens of the Test
 * Arena (a Fighter left Prone, a Wizard lent to other scenarios skewed `reduction`, 2026-11-12).
 *
 *  - Abjurer: the Player's Handbook pregenerated Wizard raised to level 6 (Int 18: the level 4 Ability Score Improvement),
 *    Abjurer subclass, with Arcane Ward, Projected Ward (level 6), Shield and Protective Bond; 40 HP;
 *    spell slots 4 / 3 / 3 full. Expected ward reserve: 2 × 6 + 4 = 16.
 *  - Protected: the pregenerated Fighter, 60 HP, ally, 10 ft from the Abjurer.
 *  - Ogre: the Monster Manual Ogre (club 2d8 + 4), hostile, which hits both without moving; 999 HP.
 *
 *   node tools/arene-abjuration.mjs     creates what is missing, resets actors, levels, slots and tokens to their reference state
 *
 * Positions in cells: `ARENE_ABJURATION` (tools/lib/stages.mjs), restored by the scenario runner before each scenario.
 */
import { buildArena } from "./lib/arena.mjs";
import { connect } from "./lib/connector.mjs";
import { ARENE_ABJURATION } from "./lib/stages.mjs";

const PHB = "Compendium.dnd-players-handbook.actors.";
const CLASSES = "Compendium.dnd-players-handbook.classes.Item.";
const SPELLS = "Compendium.dnd-players-handbook.spells.Item.";
const LEVEL = 6;

const ACTORS = {
  "Abjurateur": { pack: PHB, base: "phbprgWizard0000", keepItems: true, disposition: 1,
    items: [CLASSES + "phbwzdAbjurer000", CLASSES + "phbwzdArcaneWard", CLASSES + "phbwzdProjectedW", SPELLS + "phbsplShield0000", SPELLS + "phbsplWardingBon"],
    system: { abilities: { int: { value: 18 } }, attributes: { hp: { value: 40, max: 40, temp: 0 } } } },
  "Protégé": { pack: PHB, base: "phbprgFighter000", keepItems: true, disposition: 1,
    system: { attributes: { hp: { value: 60, max: 60, temp: 0 } } } },
  "Ogre": { base: "mmOgre0000000000", keepItems: true, disposition: -1, system: { attributes: { hp: { value: 999, max: 999 } } } }
};

const { actorIds } = await buildArena({ stage: ARENE_ABJURATION, folder: "DAS · Arène de l'abjuration", flag: "abjuration", actors: ACTORS });

// The Wizard at level 6 (the pregenerated class is level 1), Arcane Ward and Projected Ward ready to use, slots full.
const mcp = await connect();
try {
  const r = await mcp.call("run-script", { code: `
    const a = game.actors.get(args.id);
    const cls = a.items.find(i => i.type === "class" && i.system.identifier === "wizard");
    if ( cls && (cls.system.levels !== args.level) ) await cls.update({ "system.levels": args.level });
    // Égide pas encore créée (son activité de création, une fois par repos long) et réserve pleine.
    const ward = a.items.find(i => i.system.identifier === "arcane-ward");
    if ( ward ) {
      const create = ward.system.activities.get("Hha69hPMTYWhDE4A");
      const upd = { "system.uses.spent": 0 };
      if ( create ) upd["system.activities.Hha69hPMTYWhDE4A.uses.spent"] = 0;
      await ward.update(upd);
    }
    // Emplacements remis au maximum que dnd5e calcule pour un magicien de ce niveau.
    const spells = {};
    for ( const [k, s] of Object.entries(a.system.spells) ) if ( /^spell\\d$/.test(k) && (s.max > 0) ) spells[k + ".value"] = s.max;
    if ( Object.keys(spells).length ) await a.update(Object.fromEntries(Object.entries(spells).map(([k, v]) => ["system.spells." + k, v])));
    const w = a.items.find(i => i.system.identifier === "arcane-ward");
    return { levels: a.items.find(i => i.type === "class")?.system.levels, subclass: a.items.find(i => i.type === "subclass")?.name,
      intMod: a.system.abilities.int.mod, hp: a.system.attributes.hp.value + "/" + a.system.attributes.hp.max,
      slots: Object.fromEntries(Object.entries(a.system.spells).filter(([k, s]) => /^spell\\d$/.test(k) && s.max).map(([k, s]) => [k, s.value + "/" + s.max])),
      ward: w ? { max: w.system.uses.max, value: w.system.uses.value } : null };
  `, args: { id: actorIds["Abjurateur"], level: LEVEL } });
  console.log(`Abjurateur : ${JSON.stringify(r?.result ?? r)}`);
}
finally { await mcp.close?.(); }
