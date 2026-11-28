/**
 * §365: GM alerts — what the automation of an ability leaves to the GM, signaled when the item is used (banner at the top of its
 * screen, whispered card: runtime/gm-alert.mjs). Identifier → `gmAlert` rule (`key`: the text `DND5ECOMBAT.AlerteMJ.<key>`,
 * `activities`: only when these activities are used). The items of the item survey have theirs in content/item-fixes.mjs.
 * Only what goes through a use (a spell cast, an activity) is listed here: a passive trait has no moment at which to alert.
 */

export const GM_ALERTS = Object.freeze({
  // Sorts.
  "earthquake": { key: "Seisme" },
  "delayed-blast-fireball": { key: "BouleRetardement" },
  "tsunami": { key: "Tsunami" },
  "forbiddance": { key: "Interdiction" },
  "divine-word": { key: "ParoleDivine" },
  "compulsion": { key: "Injonction" },
  "telekinesis": { key: "Telekinesie" },
  "wall-of-ice": { key: "MurSections" },
  "wall-of-stone": { key: "MurSections" },
  "antimagic-field": { key: "ChampAntimagie" },
  "antilife-shell": { key: "CoquilleAntivie" },
  "levitate": { key: "Levitation" },
  "prismatic-spray": { key: "EmbrunsPrismatiques" },
  "geas": { key: "Quete" },
  "protection-from-evil-and-good": { key: "ProtectionMalBien" },
  "greater-restoration": { key: "RestaurationSup" },
  "abjure-foes": { key: "AbjurationEnnemis" },
  "conjure-elemental": { key: "InvocationElementaire" },
  // Classes, dons, objets courants.
  "boon-of-fate": { key: "Destin" },
  "maneuvering-attack": { key: "AttaqueManoeuvrante" },
  "steps-of-the-fey": { key: "FouleeFees" },
  "potion-of-vitality": { key: "PotionVitalite" },
  "lantern-of-revealing": { key: "LanterneRevelation" },
  // Monstres.
  "gibbering": { key: "Babil" },
  "toxic-escape": { key: "FuiteToxique" },
  "ice-spear": { key: "LanceGlace" },
  // Ravenloft.
  "living-shadow": { key: "OmbreVivante" },
  "symbiotic-being": { key: "Symbiote" },
  "mist-walker": { key: "MarcheBrumes" },
  "feral-pounce": { key: "BondFeroce" },
  "ghost-walk": { key: "MarcheFantome" }
  // §447: Wild Fury no longer has an alert — the transformation (the data's enchantment) and the Prowling Reprisals are played.
});
