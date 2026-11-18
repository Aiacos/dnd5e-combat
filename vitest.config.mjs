// Les tests du moteur seulement : `tools/contract/core-contract.test.mjs` est le modèle que les modules voisins copient chez eux.
// Délai d'un test : 30 s au lieu des 5 s par défaut. Une quinzaine de tests importent dans leur corps un fichier d'`adapter/` ou
// de `runtime/`, ce qui charge plus de 150 fichiers : 0,6 à 3,7 s dans la passe complète selon la charge de la machine, donc plus
// de 5 s dès que les cœurs sont pris (CI). Même cause, et même remède, que le délai de `tests/load.test.mjs`.
export default { test: { include: ["tests/**/*.test.mjs"], testTimeout: 30000 } };
