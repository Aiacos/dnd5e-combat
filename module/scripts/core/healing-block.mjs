/**
 * §334, §505 : qui un item à `blocksHealing: true` empêche de regagner des points de vie. Pur : aucune dépendance à Foundry.
 *
 *  - un item qui pose des effets (Contact glacial) : les porteurs de ces effets — pas son propriétaire, qui n'est que le lanceur ;
 *  - un trait sans aucun effet (Nuée : « The swarm can't regain Hit Points ») : la créature qui porte le trait. Sans effet à poser,
 *    la règle ne peut parler que d'elle.
 */

/**
 * Le trait bloque-t-il les soins de la créature qui le porte ?
 * @param {{rule?: true|string[]|null, effects?: number}} trait  `rule` : `blocksHealing` de l'item ; `effects` : ses effets.
 * @returns {boolean}
 */
export function traitBlocksHealing({ rule = null, effects = 0 } = {}) {
  return (rule === true) && !(Number(effects) > 0);
}
