/**
 * Ce que d'autres modules automatisent aussi (SPEC §16.11, §156) : la règle appartient au moteur, qui doit marcher sans eux ; un
 * module d'animations ne garde que ses images et ses sons.
 *
 * BLFX (Boss Loot, « boss-loot-assets-premium » 3.5.2, scripts/macros/spell/customSpells2.js, `wardingBondCreateAE`) : le Lien
 * protecteur pose sur l'effet `flags["boss-loot-assets-premium"].blfxCustom` avec `trigger: "applyDamage"`, et son hook
 * `dnd5e.applyDamage` (scripts/hooks.js:710, `_applyDamage`) fait alors subir au lanceur les dégâts du porteur
 * (`wardingBondApplyDamage`). Le moteur partageant lui-même, ce déclencheur est désarmé : sa valeur change, le reste de la marque
 * (rayon persistant, retrait) est gardé. Rien n'est patché : on écrit un flag sur l'effet, comme BLFX lui-même.
 */

import { MODULE_ID } from "../constants.mjs";

const BLFX = "boss-loot-assets-premium";

/** La valeur que prend le déclencheur désarmé : `_applyDamage` ne retient que `"applyDamage"`. */
export const DISARMED_TRIGGER = `${MODULE_ID}:applyDamage`;

/**
 * Un autre module ferait-il aussi subir au lanceur les dégâts que cet effet partage ? Rend son nom, ou null.
 * @param {ActiveEffect} effect
 */
export function foreignDamageShare(effect) {
  if ( !effect ) return null;
  if ( game.modules.get(BLFX)?.active && (effect.flags?.[BLFX]?.blfxCustom?.trigger === "applyDamage") ) return "BLFX";
  return null;
}

/**
 * Désarme le partage de dégâts d'un autre module sur cet effet. MJ actif.
 * @param {ActiveEffect} effect
 * @returns {Promise<string|null>}  Le module désarmé, ou null.
 */
export async function disarmForeignDamageShare(effect) {
  const owner = foreignDamageShare(effect);
  if ( owner !== "BLFX" ) return null;
  await effect.update({ [`flags.${BLFX}.blfxCustom.trigger`]: DISARMED_TRIGGER });
  return owner;
}

/**
 * §474 : DDB Importer (« ddb-importer », src/effects/enhancers/DDBEnhancers.ts, `_preUpdateActorHooks`) branche à son chargement,
 * si ses réglages de monde `allow-arcane-ward-enhancer` / `allow-warding-bond-enhancer` (vrais par défaut, cachés) le permettent, un
 * `preUpdateActor` qui refait l'Égide arcanique de tout magicien abjurateur (ClassFeatures/Wizard/ArcaneWard.ts, `applyDamage`) : il
 * relit la mise à jour des PV, déjà diminuée par l'égide du moteur (adapter/absorb.mjs), et la fait absorber une seconde fois par la
 * même réserve, que le moteur ne dépense qu'après l'écriture. Ce qui passait l'égide n'atteignait jamais le magicien. Même chose pour
 * le Lien protecteur que DDB pose lui-même (Spells/WardingBond.ts). Le moteur tenant ces règles, ces deux réglages sont coupés ;
 * DDB ne les relit qu'au chargement suivant. DDB déclare ses réglages après le `ready` du moteur (vu sur le banc le 2026-11-19 :
 * `game.settings.get` y lève encore) : on attend qu'ils existent.
 */
const DDB = "ddb-importer";
const DDB_ENHANCERS = Object.freeze(["allow-arcane-ward-enhancer", "allow-warding-bond-enhancer"]);

/** Les réglages de DDB Importer qui doublent une règle du moteur et sont encore actifs. */
export function foreignEnhancers() {
  if ( !game.modules.get(DDB)?.active ) return [];
  return DDB_ENHANCERS.filter(key => {
    try { return game.settings.get(DDB, key) === true; } catch { return false; }
  });
}

/**
 * Coupe ces réglages, une fois que DDB les a déclarés (au plus `waitMs`). MJ actif.
 * @returns {Promise<string[]>}  Les réglages coupés.
 */
export async function disarmForeignEnhancers({ waitMs=30000, stepMs=500 }={}) {
  if ( !game.modules.get(DDB)?.active ) return [];
  const declared = () => DDB_ENHANCERS.every(key => game.settings.settings.has(`${DDB}.${key}`));
  for ( const stop = Date.now() + waitMs; !declared() && (Date.now() < stop); ) await new Promise(r => setTimeout(r, stepMs));
  const keys = foreignEnhancers();
  for ( const key of keys ) await game.settings.set(DDB, key, false);
  return keys;
}
