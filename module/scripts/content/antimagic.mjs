/**
 * §436: dnd5e 6.1's antimagic (runtime/antimagic.mjs, adapter/antimagic.mjs).
 *  - `MAGICAL`: monster abilities that are magical without being spells — no data distinguishes them (dnd5e has no Magic
 *    action), hence this list, compiled from the 2024 Monster Manual (text that calls the ability magical, teleportation,
 *    passing into the Ethereal Plane, possession, charm). A "cast a spell" activity (`cast`) always is, with no list. Added
 *    at the user's request (2026-11-14) despite the doubt: the Shape-Shifting of lycanthropes and vampires (`shape-shift`)
 *    and `roar` (identifier carried by several monsters, which the Manual calls magical for only one: all count as magical).
 *  - `ANTIMAGIC_ZONES`: the items whose region becomes a system antimagic field when their activity places none.
 *  - `ANTIMAGIC_ZONE_LASTS`: the Antimagic Cone lasts until the start of the beholder's next turn (one round).
 */

export const MAGICAL = Object.freeze(Object.fromEntries([
  "eye-rays", "darkness-aura", "negative-energy-cone", "hunger-of-yeenoghu", "luring-song", "weird-insight", "lordly-presence",
  "animate-trees", "mind-corrosion", "possession", "teleport", "deathly-teleport", "shadowy-teleport", "radiant-teleport", "etherealness",
  "ethereal-stride", "ethereal-jaunt", "warding-charm", "captains-charm", "telekinetic-thrust", "shape-shift", "roar"
].map(id => [id, true])));

export const ANTIMAGIC_ZONES = Object.freeze({ "antimagic-field": true, "antimagic-cone": true });

export const ANTIMAGIC_ZONE_LASTS = Object.freeze({ "antimagic-cone": Object.freeze({ seconds: 6 }) });
