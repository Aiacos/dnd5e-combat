/**
 * M7 (SPEC §18.11): monster auras that act, by dnd5e identifier (Monster Manual 2024). The radius is that of the
 * activity's template (or its range); "unless it has the Incapacitated condition", "other than a …" and the Immunity after a
 * successful save are read in the original English text (core/emanation.mjs).
 */

export const EMANATIONS = Object.freeze({
  // "At the end of each of its turns, each creature of its choice in the Emanation takes …": Salamanders, Azers (the latter:
  // "unless it has the Incapacitated condition").
  "fire-aura": { on: "ownTurnEnd", affects: "enemy" },
  // Same identifier "fire-aura", but "each creature" (SRD 5.2): the Fire Elemental and the Balor burn their own allies too.
  // The Balor: an Emanation of 1.50 m (5 ft), whereas its activity's template says 10 (content/sources.mjs).
  "mm-fire-aura-each": { on: "ownTurnEnd" },
  "mm-balor-fire-aura": { on: "ownTurnEnd", radius: 5, units: "ft" },
  // Same form, each creature: Remorhaz, Brass Gorgon.
  "heat-aura": { on: "ownTurnEnd" },
  "flame-aura": { on: "ownTurnEnd" },
  // Save of each creature in the Emanation at the end of the bearer's turn: Manes (vaporous).
  "sickening-vapors": { on: "ownTurnEnd" },
  // Save of a creature that starts its turn in the Emanation.
  "stench": { on: "turnStart" },             // Ghast, Hezrou, Troglodyte
  "fetid-aura": { on: "turnStart" },         // Swarm of Dretches
  "fear-aura": { on: "turnStart", affects: "enemy" },   // Pit Fiend: "any enemy that starts its turn in the aura"
  "gibbering": { on: "turnStart" },          // Bouche gibbering : la sauvegarde seule, la table d1d8 reste au MJ
  "vile-appearance": { on: "turnStart", sees: true },   // Sea Hag: "and can see the hag's true form"
  // K1 (§322), Ravenloft creatures: same form, "any creature (any enemy) that starts its turn in the Emanation" — Zombie Clot,
  // Unspeakable Horror ("while it is not Incapacitated", 24-hour Immunity, read in the text), Plague Spreader.
  "deathly-stench": { on: "turnStart" },
  "terrifying-aura": { on: "turnStart", affects: "enemy" },
  "viral-aura": { on: "turnStart" },
  // M8 (§18.14): on its death, the Emanation goes off by itself — Mephits, Flaming Skeleton, Spore Fungus, Magmin.
  "death-burst": { on: "death" },
  "death-throes": { on: "death" }                       // Balor: "explodes when it dies"
});

/** M8 (§18.13): Regeneration — Trolls, Slaadi, Oni, Shield Guardian, Revenant (the text says the rest). */
export const REGENERATIONS = Object.freeze(["regeneration"]);

/**
 * §65: basic actions of a Monster Manual trait, through a Bonus Action (single activity, same id throughout the MM):
 * "takes the Disengage or Hide action" (Nimble Escape: goblins, Panther, Tiger, Saber-Toothed Tiger), "takes the
 * Dash or Disengage action" (Immortal's Agility: vampire spawn and familiars), "takes the Hide action" (Shadow Stealth:
 * Shadow, shadow dragons…).
 */
export const MONSTER_BASIC_ACTIONS = Object.freeze({
  "nimble-escape": { CcMi6Alf0pup7o81: { choose: ["disengage", "hide"] } },
  "deathless-agility": { dlHNkpwbTgwm1UwG: { choose: ["dash", "disengage"] } },
  "shadow-stealth": { ydslIM9mBqNRGOnq: "hide" }
});

/** §61: Undead Fortitude — Zombie, Ogre Zombie, Beholder Zombie (core/fortitude.mjs). */
export const FORTITUDES = Object.freeze(["undead-fortitude"]);

/** M8 (§18.15): does not provoke an Opportunity Attack (adapter/opportunity.mjs). */
/**
 * M8 (§18.16): drain of the HP maximum. "bite" and "slam" are shared identifiers: only the item whose English text
 * says the reduction drains (adapter/drain.mjs).
 */
export const DRAINS = Object.freeze(["life-drain", "proboscis", "slam", "bite", "fell-word", "draining-kiss", "sanguine-drain", "energy-drain", "draining-swipe"]);

/**
 * §105: sharing another creature's cell. "enter": entering the cell of any creature and stopping there
 * (Air, Fire, Water Form; Gaseous Form, through its effect); "mutual": the reverse too, any creature can enter
 * its cell ("and vice versa": Swarms; Mist Form, the 2014 vampiric mist).
 */
export const SPACE_SHARERS = Object.freeze({
  "air-form": "enter", "fire-form": "enter", "water-form": "enter", "gaseous-form": "enter",
  "swarm": "mutual", "misty-form": "mutual"
});

/** M8 (§18.17) : Avaler / Engloutir (adapter/swallow.mjs). */
export const SWALLOWS = Object.freeze(["swallow", "engulf"]);

export const NO_OPPORTUNITY = Object.freeze({
  "agile": "always",                 // Cerf, Rat
  "flyby": "flying",                 // Owl, Giant Owl, Gargoyle, Hippogriff, Giant Wasp, Peryton, Pteranodon…
  // Actions: "moves up to its Speed without provoking Opportunity Attacks" (the text must say so, see Engulf).
  "feral-strike": "afterUse", "frenzied-rush": "afterUse", "smelting-charge": "afterUse", "trampling-charge": "afterUse",
  "entangling-trail": "afterUse", "stomp": "afterUse", "rumbling-movement": "afterUse", "engulf": "afterUse",
  "bubble-dash": "afterUse", "watery-rush": "afterUse", "swoop": "afterUse", "blazing-movement": "afterUse",
  "charging-horn": "afterUse", "tactical-charge": "afterUse", "prowl": "afterUse"
});
