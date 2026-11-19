/**
 * Sens de livres sans module officiel pour Foundry, sur le bloc générique `sense` (core/senses.mjs) : par identifiant dnd5e, celui
 * que portent les objets importés. Chaque entrée dit son livre et sa page ; le texte de la règle n'est pas recopié. À part des
 * tables des modules officiels : tout ce fichier se retire sans rien changer au reste.
 */
export const OTHER_BOOKS_SENSES = Object.freeze({
  // Life Sense (Vampiric Mist, MPMM p. 250 ; MTF p. 246) : la position de toute créature à 60 ft, sauf Artificiels, Morts-vivants.
  // La règle ne parle pas d'abri : les murs ne l'arrêtent pas. Un sens naturel : rien ne protège de lui.
  "life-sense": { sense: { kind: "locate", range: 60, units: "ft", walls: false,
    detects: { not: { "target.creatureType": ["construct", "undead"] } } } },
  // Ghostly Gaze (manifestation occulte, XGE p. 56) : voir à travers les objets solides à 30 ft, pendant 1 minute — une vue que les
  // murs n'arrêtent pas, portée par l'effet que la manifestation pose sur son utilisateur. C'est une vue des yeux : éteinte pour un
  // utilisateur Aveuglé, et une créature Invisible reste non vue. La vision dans le noir qu'elle donne est laissée à l'effet.
  "ghostly-gaze": { sense: { kind: "sight", range: 30, units: "ft", via: "effect", walls: false, needs: "sight" } }
});
