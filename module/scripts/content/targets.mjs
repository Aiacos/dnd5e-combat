/**
 * Who an action can affect (SPEC §16.8, key `targets` of core/content.mjs), by dnd5e identifier. The dnd5e activity
 * data only say "creature": the type required by the rule text is declared here.
 *   types         the creature types allowed: a target of another type is not affected (neither save nor
 *                 effect), and legality says so before use
 *   unaffectedIf  a condition (facts from adapter/facts.mjs, the target as `target`) that leaves it out of reach
 * Immunities to conditions are not declared: they are read from the sheet (`traits.ci`).
 *
 * Texts checked in packs/_source/spells24 of dnd5e 6.0.3.
 */

export const TARGETS = Object.freeze({
  // "Choose a Humanoid…", "A Humanoid you can see…", "Each Humanoid in a Sphere…"
  "hold-person": { types: ["humanoid"] },
  // §157: Shield — "you take no damage from Magic Missile" while it holds.
  // O2 (§336): the Brooch of Shielding "Immunity to damage from the Magic Missile spell", worn and attuned (transferred effect).
  "magic-missile": { unaffectedIf: { any: [{ "target.hasEffect": "shield" }, { "target.hasEffect": "brooch-of-shielding" }] } },
  "charm-person": { types: ["humanoid"] },
  "dominate-person": { types: ["humanoid"] },
  "calm-emotions": { types: ["humanoid"] },
  // §19: Crown of Madness — no effect on a creature that is not a Humanoid.
  "crown-of-madness": { types: ["humanoid"] },
  // Cause Fear (Xanathar's): no hold on Constructs and Undead.
  "cause-fear": { unaffectedIf: { "target.creatureType": ["construct", "undead"] } },
  // "A Beast you can see…"
  "dominate-beast": { types: ["beast"] },
  // §65: Holy Water (PHB 2024, and the 2014 vial) — radiant damage only counts against a Fiend or an Undead.
  "holy-water": { types: ["fiend", "undead"] },
  "flask-of-holy-water": { types: ["fiend", "undead"] },
  "animal-friendship": { types: ["beast"] },
  // Sleep 2024: "creatures that don't sleep, such as elves, or that have Immunity to the Exhaustion condition
  // automatically succeed on saving throws against this spell". Immunity is read; "doesn't sleep" (elves) is not.
  // §302: elves (Trance, Eternal Elf) are read through their trait.
  // §447: Ravenloft — "magic can't put you to sleep" (Grave-Marked, Deathless of the Reborn).
  "sleep": { unaffectedIf: { any: [{ "target.immuneTo": "exhaustion" }, { "target.hasFeature": "trance" },
    { "target.hasFeature": "grave-touched" }, { "target.hasFeature": "everlasting" }] } },
  // §302: Hypnotic Pattern — "each creature in the Cube that sees the pattern": a Blinded creature is not affected.
  "hypnotic-pattern": { unaffectedIf: { "target.hasStatus": "blinded" } },
  // §16.47: Spare the Dying — "a creature at 0 Hit Points that isn't dead".
  "spare-the-dying": { unaffectedIf: { any: [{ "target.atZero": false }, { "target.isDead": true }] } },
  // Turn Undead (§16.25): "each Undead of your choice within 9 m". Cleric's Channel Divinity
  // (PHB and dnd5e 6: `channel-divinity` / `channel-divinity-cleric`): the only "Turn Undead" activity; Divine Spark
  // targets anyone. Sear Undead replaces Turn Undead (same save, same effect, plus the damage).
  // §431: the dnd5e 6.1 SRD puts "Sear Undead" (rprxorXdFoHbRERZ) on Channel Divinity — Undead only, as well.
  "channel-divinity": { unaffectedIf: { "activity.id": ["aOptL5pMaj3WtR8S", "rprxorXdFoHbRERZ"], not: { "target.creatureType": "undead" } } },
  "channel-divinity-cleric": { unaffectedIf: { "activity.id": ["aOptL5pMaj3WtR8S", "rprxorXdFoHbRERZ"], not: { "target.creatureType": "undead" } } },
  "sear-undead": { types: ["undead"] },
  // Prayer of Healing 2024 (§16.38): "a creature can't be affected by this spell again until it finishes a Long
  // Rest" — the "Healed by prayer" effect that the spell places is the mark (and drops at Long Rest, EFFECT_EXPIRIES below).
  "prayer-of-healing": { unaffectedIf: { "target.hasEffect": "prayer-of-healing" } }
});

/**
 * Usage limits (§16.40, `usageLimits`). Wild Resurgence (Druid 5, PHB 2024): "once on each of your turns, if you have no
 * uses of Wild Shape left, you can regain one by expending a spell slot" — "Wild Shape Regain" activity (`7nAgPNN2dth7SR0D`).
 * The other ("Spell Slot Regain", once per Long Rest) is held by the item's uses, dnd5e checks it.
 */
export const USAGE_LIMITS = Object.freeze({
  // `lowestSlot`: the PHB lets you choose the level with a "Scaling Value" slider — it changes nothing.
  // "Spell Slot Regain" (`dnd5eactivity000`): one Wild Shape for a level 1 slot, nothing to choose.
  "wild-resurgence": {
    "7nAgPNN2dth7SR0D": { oncePerTurn: true, whenEmpty: "wild-shape", lowestSlot: true },
    "dnd5eactivity000": { noDialog: true }
  },
  // Flame Blade (§16.41): the attack of the summoned blade has nothing to choose (neither slot nor Concentration) — no window.
  "flame-blade": { "dnd5eactivity000": { noDialog: true } },
  // Produce Flame (§16.42): "Casting Time: Bonus Action" (PHB 2024; the data say "action"); "hurl flames"
  // (Magic action) has nothing to choose.
  "produce-flame": { "MModRd17Oi6hhztj": { cost: "bonus" }, "tqKlIEdglRYdqHrp": { noDialog: true } },
  // Shillelagh: "Casting Time: Bonus Action" (PHB 2024; the data say "action").
  "shillelagh": { "B4nxtIzrCEGEzq1T": { cost: "bonus" } }
});

/**
 * The enchantment targets the weapon of a chosen creature (§16.41, `enchantTarget`). Elemental Weapon (PHB 2024): makes a
 * touched non-magical weapon magical — dnd5e "enchant" activity (15 profiles: 5 elements × +1/+2/+3 depending on
 * level), which dnd5e applies by dragging and dropping the weapon onto the card.
 */
// C12-a: Magic Weapon — "a nonmagical weapon" touched, one's own or an ally's (like Elemental Weapon).
export const ENCHANT_TARGETS = Object.freeze({ "elemental-weapon": "weapon", "magic-weapon": "weapon", "pact-of-the-blade": "ownWeapon" });

/**
 * Pact of the Blade (§16.45, `pact`). PHB 2024: as a Bonus Action, the Warlock conjures a melee weapon in hand
 * (Simple or Martial, of its choice) or bonds with a touched magic weapon; it uses its Charisma for the attack and damage,
 * whose type can be necrotic, psychic, radiant or the weapon's; a new summoning makes the
 * previous one disappear. "Forge Pact Weapon" activity (`8MSXmrGSgc6xHotB`).
 */
export const PACTS = Object.freeze({ "pact-of-the-blade": { damageTypes: ["necrotic", "psychic", "radiant"], ability: "spellcasting" } });

/** The item's effects end at this rest of the bearer (§16.38, `effectsExpire`): dnd5e does not set it on the effect. */
export const EFFECT_EXPIRIES = Object.freeze({ "prayer-of-healing": "longRest" });
