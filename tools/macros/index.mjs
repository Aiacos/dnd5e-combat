/**
 * The "GM Tools" compendium (`outils` pack, SPEC §56): the repair and initialization macros of a world, in the order
 * to run them. The `.js` files of this folder are its source; `npm run packs` builds the compendium (the GitHub release also
 * builds it, `.github/workflows/release.yml`). Every macro of this folder must appear here (`tests/macros.test.mjs`).
 */
export const MACROS = [
  { file: "nettoyage-midi.js", name: "1. Clean Midi-QOL, DAE and CPR from sheets",
    img: "icons/tools/laboratory/bowl-liquid-black.webp" },
  { file: "reparer-effets-phb.js", name: "2. Repair Player's Handbook effects",
    img: "icons/magic/life/ankh-gold-blue.webp" },
  { file: "reparer-objets.js", name: "3. Repair items (lost effects)",
    img: "icons/tools/smithing/anvil.webp" },
  { file: "reprendre-parchemins.js", name: "4. Update spell scrolls",
    img: "icons/sundries/scrolls/scroll-bound-blue-brown.webp" },
  { file: "nettoyage-tas-item-piles.js", name: "5. Remove basic actions from Item Piles piles",
    img: "icons/containers/bags/case-leather-tan.webp" },
  { file: "reparer-creatures.js", name: "6. Repair creature sheets (identifiers, CPR basic actions)",
    img: "icons/creatures/abilities/paw-print-pair-purple.webp" },
  { file: "phb3-sous-classes.js", name: "7. Update subclasses to Player's Handbook 3.0.0",
    img: "icons/sundries/documents/document-sealed-signatures-red.webp" },
  { file: "phb3-objets.js", name: "8. Update features and spells to Player's Handbook 3.0.0 (preview)",
    img: "icons/sundries/books/book-red-exclamation.webp" },
  { file: "doublons-sorts.js", name: "9. Repair duplicate spells",
    img: "icons/magic/symbols/runes-star-blue.webp" },
  { file: "enchantements-aptitudes.js", name: "10. Repair feature enchantments (dnd5e 6.1)",
    img: "icons/magic/symbols/rune-sigil-black-pink.webp" },
  { file: "basculer-ethere.js", name: "Toggle Ethereal Plane (selected tokens)",
    img: "systems/dnd5e/icons/svg/statuses/ethereal.svg" },
  { file: "lancer-combat.js", name: "Start a combat",
    img: "icons/skills/melee/weapons-crossed-swords-black-gray.webp" }
];
