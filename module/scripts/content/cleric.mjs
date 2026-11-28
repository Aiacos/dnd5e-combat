/**
 * The 2024 Player's Handbook Cleric (SPEC §27), premium module `dnd-players-handbook` 2.2.0 (pack `classes`, items `phbclc…`).
 * Already there: Turn Undead and Sear Undead (§16, content/targets.mjs, triggers.mjs), Invoke Duplicity (§16,
 * summons.mjs), Grave Domain (Ravenloft, §19.9).
 *
 * What dnd5e already does alone: Divine Spark (healing or save), Radiance of the Dawn (Emanation save), Preserve Life
 * (healing — the "half its HP" cap stays with the GM), "Veil of Nature"… and the uses of Channel Divinity.
 */

import { potentSpellcasting } from "./druid.mjs";

/**
 * Divine Strike: "once on each of your turns, when you hit a creature with an attack roll using a weapon". Not for a cleric
 * who received the Potent Spellcasting option (Manual item; gap survey, 2026-10-22) — §431: under the identifier of the Manual and
 * of dnd5e 6.0's SRD (`blessed-strikes-potent-spellcasting`) or under that of the 6.1 SRD (`potent-spellcasting`, shared with
 * the Druid: the Cleric's only).
 */
const potentOption = { any: [{ "source.hasFeature": "blessed-strikes-potent-spellcasting" },
  { "source.hasClassFeature": { id: "potent-spellcasting", class: "cleric" } }] };
const divineStrike = (formula, improved) => ({ on: "preDamageRoll", oncePerTurn: true,
  if: { all: [{ "activity.isWeapon": true }, { not: potentOption },
    improved ? { "source.hasFeature": "improved-blessed-strikes" } : { not: { "source.hasFeature": "improved-blessed-strikes" } }] },
  do: [{ type: "damage", formula, damageType: "radiant" }] });

/**
 * Potent Spellcasting, the other Blessed Strikes option: "add your Wisdom modifier to the damage of any Cleric cantrip".
 * The Cleric's progression only gives "Blessed Strikes" (Divine Strike by default); the Manual's option item ("Blessed
 * Strikes: Potent Spellcasting", `blessed-strikes-potent-spellcasting`) placed on the sheet carries the rule and removes
 * Divine Strike. §431: dnd5e 6.1's SRD item (`potent-spellcasting`) itself carries an effect that adds Wisdom to Cleric cantrips
 * (`damage` / `dnd5e.bonus` change, `item.classIdentifier` condition): no entry under that name, otherwise the bonus would
 * count twice.
 */

/** §293: Sear Undead (`phbclcSearUndead`), its "Channel Divinity: Turn Undead" activity (Manual, dnd5e 6.0 SRD). */
const SEAR_UNDEAD = "fW3U8L8Ca9a6O9Wx";
/**
 * §431: in dnd5e 6.1's SRD, the Sear Undead item no longer has an activity; it is Channel Divinity (`channel-divinity-cleric`) that
 * carries "Sear Undead" (save, same "Turned" effect as Turn Undead, plus the radiant damage), visible at Cleric level 5.
 */
const SEAR_UNDEAD_61 = "rprxorXdFoHbRERZ";
/**
 * §293: the "Turn Undead" activity of Channel Divinity (`phbclcChannelDiv`) — §431: and the 6.1 SRD's "Sear Undead", on the same
 * item. The Sear Undead offered in place of Turn Undead: the activity of the Sear Undead item (old form), otherwise that of
 * Channel Divinity if the cleric has the Sear Undead item (level 5).
 */
const TURN_UNDEAD = Object.freeze({ activities: ["aOptL5pMaj3WtR8S", SEAR_UNDEAD_61], radius: 30, units: "ft",
  upgrade: [{ item: "sear-undead", activity: SEAR_UNDEAD }, { item: "channel-divinity-cleric", activity: SEAR_UNDEAD_61, requires: "sear-undead" }] });

export const CLERIC = Object.freeze({
  // Divine Intervention (level 10) — "with a Magic action, a Cleric spell of level 5 or lower that is not cast as a
  // Reaction, cast in the same action without a slot or Material components; once per Long Rest". The item's activity
  // (the action, the use) holds the casting: the next suitable spell goes off with no slot or action cost.
  // Greater Divine Intervention (Wish) keeps its own casting activity.
  "divine-intervention": { freeCast: { activity: "dnd5eactivity000", maxLevel: 5, class: "cleric" } },
  // Warding Flare (Light 3): as a Reaction, the cleric imposes Disadvantage on the attack roll of a creature it sees within 9 m or
  // less — against itself or an ally (§34: window before the roll). The Temporary Hit Points of Improved
  // Warding Flare stay with the player.
  // C12-j: Improved Warding Flare (Light 6) — "you regain all uses of Warding Flare after a Short or Long Rest".
  "improved-warding-flare": { regainOnShortRest: ["warding-flare"] },
  "warding-flare": { triggers: [{ on: "enemyAttacks", if: { "source.nearSelf": { distance: 30, units: "ft" }, "self.seesSource": true },
    do: [{ type: "use", activity: "dnd5eactivity000" }, { type: "disadvantage" }] },
    // §438: Handbook 3.0.0 — from level 6, Radiance is the activity `6V4FAVqgjzctbpoC` (with the Temporary Hit Points of
    // improved Radiance on top) and `dnd5eactivity000` is hidden: only the activity visible at that level is offered
    // (adapter/level-gate.mjs, `levelHidden`).
    { on: "enemyAttacks", if: { "source.nearSelf": { distance: 30, units: "ft" }, "self.seesSource": true },
      do: [{ type: "use", activity: "6V4FAVqgjzctbpoC" }, { type: "disadvantage" }] }] },
  // Blessed Strikes (level 7), Divine Strike option: 1d8 radiant (necrotic or radiant at the player's choice: radiant by default);
  // 2d8 with improved Blessed Strikes (level 14).
  // Improved Blessed Strikes (level 14), Potent Spellcasting — "when you cast a Cleric cantrip and deal damage to a
  // creature with it, you can give yourself or another creature within 18 m Temporary Hit Points equal to twice your
  // Wisdom modifier".
  // Only if Potent Spellcasting is the chosen option (`requires`); the other half, Divine Strike at 2d8, is in the Blessed
  // Strikes entry.
  "improved-blessed-strikes": { cantripVitality: { class: "cleric", tempHp: "2 * @abilities.wis.mod",
    range: { value: 60, units: "ft" }, requires: ["blessed-strikes-potent-spellcasting", "potent-spellcasting"] } },
  "blessed-strikes": { triggers: [divineStrike("1d8", false), divineStrike("2d8", true)] },
  "blessed-strikes-potent-spellcasting": potentSpellcasting("cleric"),   // §431: not `potent-spellcasting` (dnd5e 6.1 handles it)
  // Supreme Healing (level 17): "use the maximum value for each die" of a spell or a Channel Divinity that heals.
  "supreme-healing": { supremeHealing: true },
  // §295: Trickster's Favor (Trickery Domain) — "until you finish a Long Rest" (the data: one round).
  // §296: Survivance — "5 × Cleric level HP divided among Bloodied creatures within 9 m (yourself included), not beyond half
  // their maximum HP": the list of Bloodied creatures, then the shared pool.
  "preserve-life": { pickTargets: { activities: ["dnd5eactivity000"], radius: 30, units: "ft", self: true, check: "allies", filter: "bloodied" },
    healPool: { activities: ["dnd5eactivity000"], cap: "halfMax", choose: true } },
  "blessing-of-the-trickster": { effectDurations: { "1PrZ25K0vYo5oLtP": { seconds: 86400 } }, effectsExpire: "longRest" },
  // §236: Avatar of Battle (War 17) — "Resistance to Bludgeoning, Piercing and Slashing damage": no effect in the data, the effect
  // is kept on the actor (runtime/speed-grants.mjs).
  "avatar-of-battle": { grantsResistances: ["bludgeoning", "piercing", "slashing"] },
  // Disciple of Life (Life 3): "2 plus the level of the slot" extra; Blessed Healer (Life 6): the same amount for the caster when
  // the spell heals another creature.
  "disciple-of-life": { discipleOfLife: true },
  "blessed-healer": { blessedHealer: true },
  // Priest of war (War 3): one more weapon or unarmed attack, at the cost of a Bonus Action —
  // the activity (Bonus Action, one use) opens a free attack, like Flurry of Blows (§24).
  "war-priest": { flurry: { activity: "dnd5eactivity000", strikes: 1, weapons: true } },
  // Trickster's Swap (Trickery 6, `phbclcTricksters`): when the Bonus Action creates or moves the illusion of Invoke Duplicity, the
  // cleric can also take its place by teleportation, the illusion taking theirs (§38.2) — an entry in the context menu of the
  // illusion and of the caster; the item's "Transpose" activity (follow-up Bonus Action) is not used.
  "tricksters-transposition": { transpose: { summon: "invoke-duplicity" } },
  // §293: Turn Undead — "each Undead of your choice within a 9 m radius": the data sets neither an area nor a list
  // (range 30 ft, targets to click one by one). A window lists the creatures within 9 m, the player ticks them; with Destroy
  // Undead (level 5), a cell offers it instead — its activity (same save, same effect, plus the radiant damage, the same use of
  // Channel Divinity) then goes out on the same targets, without its area.
  // §299: the turning "ends if you have the Incapacitated condition or if you die".
  "channel-divinity": { pickTargets: TURN_UNDEAD, endsWhen: { incapacitated: "caster" } },
  "channel-divinity-cleric": { pickTargets: TURN_UNDEAD, endsWhen: { incapacitated: "caster" } },
  "sear-undead": { pickTargets: { activities: [SEAR_UNDEAD], radius: 30, units: "ft" }, endsWhen: { incapacitated: "caster" } }
});
