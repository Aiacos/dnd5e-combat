/**
 * §296 (pass C2): the pools of healing or Temporary Hit Points "distributed among creatures of your choice" ("Survival", "Group
 * Healing", "Mechanical Cavalcade", "Exalting Smite"). Pure: no dependency on Foundry.
 */

/**
 * Shares of a pool — equal shares, each share capped (`caps`); what a creature cannot take goes back to the others.
 * Pure. Returns the amounts in the order of the caps.
 */
export function splitPool(total, caps) {
  const shares = caps.map(() => 0);
  let left = Math.max(0, Math.floor(total));
  let open = caps.map((c, i) => i).filter(i => caps[i] > 0);
  while ( (left > 0) && open.length ) {
    const each = Math.max(1, Math.floor(left / open.length));
    for ( const i of [...open] ) {
      if ( left <= 0 ) break;
      const give = Math.min(each, caps[i] - shares[i], left);
      shares[i] += give; left -= give;
    }
    open = open.filter(i => shares[i] < caps[i]);
  }
  return shares;
}

