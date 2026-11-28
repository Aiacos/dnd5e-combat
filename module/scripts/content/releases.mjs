/**
 * §439: the engine's release notes, from newest to oldest — what the update message shows the GM the first time a world
 * is opened after an update (ui/release-notes.mjs, rules in core/release-notes.mjs).
 *
 * ONE ENTRY PER PUBLISHED VERSION, added at the top when the version of `module/module.json` changes
 * (tests/release-notes.test.mjs fails otherwise):
 *  - `version`    : that of `module.json`.
 *  - `highlights` : what is new, a few items. Each id has its text `DND5ECOMBAT.Nouveautes.Point.<id>` in module/lang/
 *                   (en, fr, pt-BR): one sentence for a GM, not for a developer.
 *  - `tested`     : what this version was played with on the test bench (the versions in the summary of the last full pass) —
 *                   `foundry`, `system` (dnd5e), `books` (premium modules, by id), `modules` (the rest of the DAS suite, by id:
 *                   the oldest version this engine version was tested with). These ids are display
 *                   data: the engine asks nothing of these modules.
 *  - `risks`      : the compatibility risks written by hand, `{ id, when? }` — texts `Nouveautes.Risque.<id>.Titre` / `.Texte`.
 *  - `checks`     : the recommended World Diagnostic checks, `{ id, when? }` (id from runtime/diagnostic/checks.mjs).
 *  `when`: `{ module, min?, below? }` (that module is active, from `min`, before `below`) and / or `{ system: "6.1.0" }`.
 */

const PHB = "dnd-players-handbook";

export const RELEASES = Object.freeze([
  {
    version: "0.295.0",
    highlights: ["fenetreDegatsDnd5e", "sautVaincus", "pastilleFile", "finDeCombat", "noteGithub"],
    tested: {
      foundry: "14.370",
      system: "6.1.1",
      books: { [PHB]: "3.0.0", "dnd-monster-manual": "1.4.0", "dnd-dungeon-masters-guide": "3.0.0", "dnd-ravenloft-horrors-within": "2.0.0" },
      modules: {
        "darsh-dnd-ui": "0.39.0", "darsh-loot": "0.23.0", "dnd5e-lumiere": "0.15.1", "darsh-animations": "0.16.4",
        "darsh-homebrew": "0.3.2", "darsh-npc": "0.8.0", "darsh-controller": "0.1.0"
      }
    },
    risks: [{ id: "fenetreDegats" }, { id: "sautVaincus" }],
    checks: []
  },
  {
    version: "0.294.0",
    highlights: ["critiquesCibles", "monstresAiacos", "lameDeFeu", "zonesInvocations", "des3d", "liensOrigine"],
    tested: {
      foundry: "14.370",
      system: "6.1.1",
      books: { [PHB]: "3.0.0", "dnd-monster-manual": "1.4.0", "dnd-dungeon-masters-guide": "3.0.0", "dnd-ravenloft-horrors-within": "2.0.0" },
      modules: {
        "darsh-dnd-ui": "0.38.0", "darsh-loot": "0.22.6", "dnd5e-lumiere": "0.15.1", "darsh-animations": "0.16.4",
        "darsh-homebrew": "0.3.2", "darsh-npc": "0.8.0", "darsh-controller": "0.1.0"
      }
    },
    risks: [],
    checks: [{ id: "source-links" }]
  },
  {
    version: "0.293.0",
    highlights: ["cheminRapide", "maitreTacticien", "sensLocalise", "sortsNovembre", "reglagesNovembre", "invocationsFactions"],
    tested: {
      foundry: "14.370",
      system: "6.1.1",
      books: { [PHB]: "3.0.0", "dnd-monster-manual": "1.4.0", "dnd-dungeon-masters-guide": "3.0.0", "dnd-ravenloft-horrors-within": "2.0.0" },
      modules: {
        "darsh-dnd-ui": "0.37.1", "darsh-loot": "0.22.4", "dnd5e-lumiere": "0.15.1", "darsh-animations": "0.16.4",
        "darsh-homebrew": "0.3.2", "darsh-npc": "0.8.0", "darsh-controller": "0.1.0"
      }
    },
    risks: [{ id: "auraEffects", when: { module: "auraeffects" } }],
    checks: []
  },
  {
    version: "0.292.0",
    highlights: ["degatsJoueurs", "chanceToucherJoueurs", "tueurMages", "monstresCorrections", "effetsCavaliers"],
    tested: {
      foundry: "14.370",
      system: "6.1.1",
      books: { [PHB]: "3.0.0", "dnd-monster-manual": "1.4.0", "dnd-dungeon-masters-guide": "3.0.0", "dnd-ravenloft-horrors-within": "2.0.0" },
      modules: {
        "darsh-dnd-ui": "0.37.1", "darsh-loot": "0.22.4", "dnd5e-lumiere": "0.15.1", "darsh-animations": "0.16.4",
        "darsh-homebrew": "0.3.2", "darsh-npc": "0.8.0", "darsh-controller": "0.1.0"
      }
    },
    risks: [],
    checks: []
  },
  {
    version: "0.291.0",
    highlights: ["fenetres", "sauvagerieChoix", "metamagie", "aptitudesClasses", "objetsSrd2", "rapportBug"],
    tested: {
      foundry: "14.370",
      system: "6.1.1",
      books: { [PHB]: "3.0.0", "dnd-monster-manual": "1.4.0", "dnd-dungeon-masters-guide": "3.0.0", "dnd-ravenloft-horrors-within": "2.0.0" },
      modules: {
        "darsh-dnd-ui": "0.37.0", "darsh-loot": "0.22.4", "dnd5e-lumiere": "0.15.1", "darsh-animations": "0.16.3",
        "darsh-homebrew": "0.3.2", "darsh-npc": "0.8.0", "darsh-controller": "0.1.0"
      }
    },
    risks: [{ id: "sauvagerieQuestion" }],
    checks: [{ id: "data-fixes" }]
  },
  {
    version: "0.290.0",
    highlights: ["potionsMaison", "guide3", "sortsPrepares", "abriDexterite", "objetsSrd", "forceCache"],
    tested: {
      foundry: "14.370",
      system: "6.1.1",
      books: { [PHB]: "3.0.0", "dnd-monster-manual": "1.4.0", "dnd-dungeon-masters-guide": "3.0.0", "dnd-ravenloft-horrors-within": "2.0.0" },
      modules: {
        "darsh-dnd-ui": "0.37.0", "darsh-loot": "0.22.3", "dnd5e-lumiere": "0.15.1", "darsh-animations": "0.16.2",
        "darsh-homebrew": "0.3.2", "darsh-npc": "0.8.0", "darsh-controller": "0.1.0"
      }
    },
    risks: [
      { id: "sortsPrepares" },
      { id: "marteauTonnerre", when: { module: "dnd-dungeon-masters-guide", min: "3.0.0" } }
    ],
    checks: [{ id: "data-fixes" }]
  },
  {
    version: "0.289.0",
    highlights: ["opportunitePourquoi", "avantageManuel", "briquesMonstres"],
    tested: {
      foundry: "14.370",
      system: "6.1.1",
      books: { [PHB]: "3.0.0", "dnd-monster-manual": "1.4.0", "dnd-dungeon-masters-guide": "2.0.0", "dnd-ravenloft-horrors-within": "2.0.0" },
      modules: {
        "darsh-dnd-ui": "0.36.1", "darsh-loot": "0.22.3", "dnd5e-lumiere": "0.15.1", "darsh-animations": "0.16.2",
        "darsh-homebrew": "0.3.2", "darsh-npc": "0.8.0", "darsh-controller": "0.1.0"
      }
    },
    risks: [],
    checks: []
  },
  {
    version: "0.288.0",
    highlights: ["bottesPlaces", "lumiereVive", "grillesMonde"],
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
