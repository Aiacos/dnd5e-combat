/**
 * §439 : les notes de version du moteur, de la plus récente à la plus ancienne — ce que le message de mise à jour montre au MJ à la
 * première ouverture d'un monde après une mise à jour (ui/release-notes.mjs, règles dans core/release-notes.mjs).
 *
 * UNE ENTRÉE PAR VERSION PUBLIÉE, ajoutée en tête au moment du changement de version de `module/module.json`
 * (tests/release-notes.test.mjs échoue sinon) :
 *  - `version`    : celle de `module.json`.
 *  - `highlights` : les nouveautés, quelques-unes. Chaque id a son texte `DND5ECOMBAT.Nouveautes.Point.<id>` dans module/lang/
 *                   (en, fr, pt-BR) : une phrase pour un MJ, pas pour un développeur.
 *  - `tested`     : avec quoi cette version a été jouée sur le banc de test (les versions du résumé de la dernière passe complète) —
 *                   `foundry`, `system` (dnd5e), `books` (modules premium, par id), `modules` (le reste de la suite DAS, par id :
 *                   la version la plus ancienne avec laquelle cette version du moteur a été testée). Ces ids sont des données
 *                   d'affichage : le moteur ne demande rien à ces modules.
 *  - `risks`      : les risques de compatibilité écrits à la main, `{ id, when? }` — textes `Nouveautes.Risque.<id>.Titre` / `.Texte`.
 *  - `checks`     : les vérifications du Diagnostic du monde conseillées, `{ id, when? }` (id de runtime/diagnostic/checks.mjs).
 *  `when` : `{ module, min?, below? }` (ce module est actif, à partir de `min`, avant `below`) et / ou `{ system: "6.1.0" }`.
 */

const PHB = "dnd-players-handbook";

export const RELEASES = Object.freeze([
  {
    // EN PRÉPARATION (module.json n'est pas encore à cette version : cette note n'est montrée à personne avant le changement de version).
    // À la release : compléter `highlights`, recopier `tested` du dernier résumé du banc, revoir `risks` et `checks`.
    version: "0.288.0",
    highlights: ["grillesMonde"],
    tested: {
      foundry: "14.370",
      system: "6.1.1",
      books: { [PHB]: "3.0.0", "dnd-monster-manual": "1.4.0", "dnd-dungeon-masters-guide": "2.0.0", "dnd-ravenloft-horrors-within": "2.0.0" },
      modules: {
        "darsh-dnd-ui": "0.36.1", "darsh-loot": "0.22.2", "dnd5e-lumiere": "0.15.1", "darsh-animations": "0.16.1",
        "darsh-homebrew": "0.3.2", "darsh-npc": "0.8.0", "darsh-controller": "0.1.0"
      }
    },
    risks: [],
    checks: []
  },
  {
    version: "0.287.0",
    highlights: ["sensDeclares", "detectionMagie", "tenebresPosees", "champsDeVue", "modesTiers", "optionsSens", "correctifs3"],
    tested: {
      foundry: "14.370",
      system: "6.1.1",
      books: { [PHB]: "3.0.0", "dnd-monster-manual": "1.4.0", "dnd-dungeon-masters-guide": "2.0.0", "dnd-ravenloft-horrors-within": "2.0.0" },
      modules: {
        "darsh-dnd-ui": "0.36.1", "darsh-loot": "0.22.2", "dnd5e-lumiere": "0.15.1", "darsh-animations": "0.16.1",
        "darsh-homebrew": "0.3.2", "darsh-npc": "0.8.0", "darsh-controller": "0.1.0"
      }
    },
    risks: [{ id: "modesTiers" }],
    checks: []
  },
  {
    version: "0.286.0",
    highlights: ["securiteToutes", "cartesMidi", "egideDdb", "vibrations", "ethere", "correctifs2", "italienComplet"],
    tested: {
      foundry: "14.370",
      system: "6.1.1",
      books: { [PHB]: "3.0.0", "dnd-monster-manual": "1.4.0", "dnd-dungeon-masters-guide": "2.0.0", "dnd-ravenloft-horrors-within": "2.0.0" },
      modules: {
        "darsh-dnd-ui": "0.36.1", "darsh-loot": "0.22.2", "dnd5e-lumiere": "0.15.1", "darsh-animations": "0.16.1",
        "darsh-homebrew": "0.3.2", "darsh-npc": "0.8.0", "darsh-controller": "0.1.0"
      }
    },
    risks: [
      { id: "lootSecurite2", when: { module: "darsh-loot", below: "0.22.2" } },
      { id: "ddbEgide", when: { module: "ddb-importer" } },
      { id: "vibrations" }
    ],
    checks: [{ id: "data-fixes" }]
  },
  {
    version: "0.285.0",
    highlights: ["securiteRequetes", "lignesParCible", "critiqueAmeliore", "suiteDeSort", "correctifsAiacos"],
    tested: {
      foundry: "14.370",
      system: "6.1.1",
      books: { [PHB]: "3.0.0", "dnd-monster-manual": "1.4.0", "dnd-dungeon-masters-guide": "2.0.0", "dnd-ravenloft-horrors-within": "2.0.0" },
      modules: {
        "darsh-dnd-ui": "0.36.1", "darsh-loot": "0.22.1", "dnd5e-lumiere": "0.15.1", "darsh-animations": "0.16.1",
        "darsh-homebrew": "0.3.2", "darsh-npc": "0.8.0", "darsh-controller": "0.1.0"
      }
    },
    risks: [{ id: "lootSecurite", when: { module: "darsh-loot", below: "0.22.1" } }],
    checks: [{ id: "data-fixes" }]
  },
  {
    version: "0.284.0",
    highlights: ["phb3Fiches", "grille", "furtiviteOff", "teleportations", "mortSansDegats", "avisDebogueur", "italien"],
    tested: {
      foundry: "14.370",
      system: "6.1.1",
      books: { [PHB]: "3.0.0", "dnd-monster-manual": "1.4.0", "dnd-dungeon-masters-guide": "2.0.0", "dnd-ravenloft-horrors-within": "2.0.0" },
      modules: {
        "darsh-dnd-ui": "0.36.1", "darsh-loot": "0.22.0", "dnd5e-lumiere": "0.15.1", "darsh-animations": "0.16.1",
        "darsh-homebrew": "0.3.2", "darsh-npc": "0.8.0", "darsh-controller": "0.1.0"
      }
    },
    checks: [{ id: "phb3-items", when: { module: PHB, min: "3.0.0" } }]
  },
  {
    version: "0.283.0",
    highlights: ["dnd61", "antimagie", "phb3", "ravenloft", "multiattaque", "tokensVideo", "doublonsSorts", "ptBR"],
    tested: {
      foundry: "14.370",
      system: "6.1.0",
      books: { [PHB]: "3.0.0", "dnd-monster-manual": "1.4.0", "dnd-dungeon-masters-guide": "2.0.0", "dnd-ravenloft-horrors-within": "2.0.0" },
      modules: {
        "darsh-dnd-ui": "0.35.0", "darsh-loot": "0.22.0", "dnd5e-lumiere": "0.15.0", "darsh-animations": "0.16.0",
        "darsh-homebrew": "0.3.2", "darsh-npc": "0.8.0", "darsh-controller": "0.1.0"
      }
    },
    risks: [{ id: "phb3Fiches", when: { module: PHB, min: "3.0.0" } }],
    checks: [
      { id: "phb3-subclasses", when: { module: PHB, min: "3.0.0" } },
      { id: "phb3-items", when: { module: PHB, min: "3.0.0" } },
      { id: "modify-item", when: { system: "6.1.0" } },
      { id: "data-fixes" },
      { id: "magical-effects", when: { system: "6.1.0" } },
      { id: "spell-duplicates" }
    ]
  },
  {
    version: "0.282.1",
    highlights: ["niveauDeLancement", "visionDuDiable"],
    tested: {
      foundry: "14.370",
      system: "6.0.6",
      books: { [PHB]: "2.2.0", "dnd-monster-manual": "1.4.0", "dnd-dungeon-masters-guide": "2.0.0" },
      modules: {}
    }
  }
]);
