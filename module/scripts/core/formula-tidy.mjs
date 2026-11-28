/**
 * §438: a readable dice formula. The Handbook 3.0.0 removed scales that the content replaces with formulas on the class
 * level (`2d(6 + 2 * min(1, floor(@classes.ranger.levels / 11)))`): once the data is substituted, each group of numbers in
 * parentheses (with `floor`, `ceil`, `round`, `min`, `max`) is computed — `2d(6 + 2 * min(1, floor(5 / 11)))` → `2d6`. Nothing else
 * changes (dice, remaining `@`, text). Pure.
 */

const GROUP = /(floor|ceil|round|min|max)?\(([\d\s+\-*/.,]*)\)/;

/** A computable group: "min(1, 2)" → 1; "(6 + 2)" → 8; null if it is not. */
function evaluate(fn, inner) {
  const parts = inner.split(",").map(p => p.trim());
  if ( parts.some(p => !/^[\d\s+\-*/.]+$/.test(p)) ) return null;
  let values;
  try { values = parts.map(p => Function(`"use strict"; return (${p});`)()); } catch { return null; }
  if ( values.some(v => !Number.isFinite(v)) ) return null;
  if ( !fn ) return (values.length === 1) ? values[0] : null;
  if ( (fn === "min") || (fn === "max") ) return Math[fn](...values);
  return (values.length === 1) ? Math[fn](values[0]) : null;
}

export function tidyDice(formula) {
  let text = String(formula ?? "");
  for ( let guard = 0; guard < 50; guard++ ) {
    let changed = false;
    text = text.replace(new RegExp(GROUP.source, "g"), (all, fn, inner) => {
      const v = evaluate(fn, inner);
      if ( v === null ) return all;
      changed = true;
      return String(Number.isInteger(v) ? v : Math.round(v * 1000) / 1000);
    });
    if ( !changed ) break;
  }
  return text;
}
