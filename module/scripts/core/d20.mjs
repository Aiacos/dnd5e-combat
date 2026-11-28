/**
 * Issue #47: what a d20 rolled with Advantage or Disadvantage produced — the kept dice and the discarded dice.
 * The results are those of a Foundry die term (`{ result, active, discarded, rerolled }`): a rerolled die (Halfling
 * Lucky) is replaced, not discarded; it is neither kept nor discarded.
 * @param {Array<{result: number, active?: boolean, discarded?: boolean, rerolled?: boolean}>} results
 * @param {number} advantageMode  The mode retained by dnd5e: 1 Advantage, -1 Disadvantage, 0 normal roll.
 * @returns {{mode: number, kept: number[], dropped: number[]}|null}  null when nothing was discarded (normal roll).
 */
export function keptAndDropped(results, advantageMode=0) {
  const rolled = (results ?? []).filter(r => Number.isFinite(r?.result) && !r.rerolled);
  const dropped = rolled.filter(r => r.discarded).map(r => r.result);
  if ( !dropped.length ) return null;
  const kept = rolled.filter(r => !r.discarded && (r.active !== false)).map(r => r.result);
  if ( !kept.length ) return null;
  // With no known mode (old message), the dice speak: a discarded die higher than the kept die means Disadvantage.
  const mode = (advantageMode === 1) || (advantageMode === -1) ? advantageMode : ((Math.max(...dropped) > Math.max(...kept)) ? -1 : 1);
  return { mode, kept, dropped };
}

/**
 * §435: the keep of a d20 rolled with Advantage or Disadvantage, read from its modifiers. dnd5e 6 writes `adv` / `dis` (`adv2`:
 * Elven Accuracy; `D20Die#applyAdvantage`), a hand-written die `kh` / `kl`; the mode noted by dnd5e (`options.advantageMode`:
 * 1 Advantage, -1 Disadvantage) wins when it is known.
 * @param {string[]} modifiers
 * @param {number} [advantageMode]
 * @returns {"kh"|"kl"|null}  `kh`: the highest counts; `kl`: the lowest; null: no keep.
 */
export function d20Keep(modifiers, advantageMode) {
  if ( advantageMode === 1 ) return "kh";
  if ( advantageMode === -1 ) return "kl";
  for ( const m of modifiers ?? [] ) {
    if ( /^(?:kh|adv)/.test(m) ) return "kh";
    if ( /^(?:kl|dis)/.test(m) ) return "kl";
  }
  return null;
}
