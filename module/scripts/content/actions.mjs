/**
 * Basic actions shipped as items (SPEC §15.2, decided on 2026-09-23: items rather than
 * cells added by the engine — an item goes through the same legality and the same budget as the rest,
 * and the sheet, the action bar and the menu show it with nothing more). The engine creates them on the
 * players' characters (runtime/basics.mjs); it recognizes them by `flags["dnd5e-combat"].basicAction`.
 * Names and texts in lang/ (`DND5ECOMBAT.Action.<clé>`), from the 2024 Player's Handbook in French.
 *
 * `turnFlag`: the turn state that the action sets (core/turn.mjs, `basicAction`). Without it, the action
 * costs what its activation says, like any item.
 */

export const BASIC_ACTIONS = Object.freeze({
  dash: { img: "icons/svg/wingfoot.svg", activityId: "dnd5eCombatDash0" },
  disengage: { img: "icons/svg/door-exit.svg", activityId: "dnd5eCombatDseng" },
  dodge: { img: "icons/svg/shield.svg", activityId: "dnd5eCombatDodge" },
  // Escaping a grapple (runtime/grapple.mjs): an action, Athletics or Acrobatics check.
  escape: { img: "icons/svg/net.svg", activityId: "dnd5eCombatEscap" },
  // Ready: the action is spent, the "Ready" state shown; the trigger is left to the player.
  ready: { img: "icons/svg/clockwork.svg", activityId: "dnd5eCombatReady" },
  // §213: Improvised Weapon — no cost by itself: it asks the GM, then the attack with the temporary weapon costs like a weapon
  // attack (runtime/improvised.mjs). `attack`: a familiar does not receive it.
  improvised: { attack: true, img: "icons/svg/hanging-sign.svg", activityId: "dnd5eCombatImpro", activity: { activation: { type: "special" } } },
  // Hide: Stealth DC 15, out of sight of every enemy (runtime/hide.mjs).
  hide: { img: "icons/svg/cowled.svg", activityId: "dnd5eCombatHide0" },
  // Search: Wisdom (Perception) against Hidden creatures, light included (runtime/search.mjs).
  search: { img: "icons/svg/eye.svg", activityId: "dnd5eCombatSrch0" },
  // Help, attack part: on an enemy within 1.50 m (runtime/help.mjs).
  help: { img: "icons/svg/aura.svg", activityId: "dnd5eCombatHelp0",
    activity: { target: { affects: { type: "creature", count: "1" }, prompt: false }, range: { override: true, units: "touch" } } },
  // 2024 Unarmed Strike (from dnd5e 6's Barbarian item, classes24/barbarian/class-features/
  // unarmed-strike.yml): an attack (1 + Str, bludgeoning) and "Grapple / Shove", a Strength or Dexterity saving
  // throw (the target's better) against 8 + Str + proficiency. An item with identifier
  // `unarmed-strike` already present (Monk, Barbarian) stands in for ours.
  // `attack`: an attack — a familiar does not receive it ("a familiar cannot attack", §107).
  unarmed: {
    attack: true,
    img: "icons/skills/melee/unarmed-punch-fist-yellow-red.webp",
    identifier: "unarmed-strike",
    activityId: "dnd5eCombatUnarm",
    saveActivityId: "dnd5eCombatGrShv",
    // Three exclusive effects (content/choices.mjs): Grappled, Prone, pushed. The last is
    // never placed: the engine reads it as a push (runtime/engine.mjs).
    effects: {
      grappled: { id: "dnd5eCombatGrapl", status: "grappled", img: "systems/dnd5e/icons/svg/statuses/grappled.svg" },
      prone: { id: "dnd5eCombatProne", status: "prone", img: "systems/dnd5e/icons/svg/statuses/prone.svg" },
      pushed: { id: "dnd5eCombatPush0", push: { distance: 5, units: "ft" }, img: "icons/svg/thrust.svg" }
    }
  }
});
