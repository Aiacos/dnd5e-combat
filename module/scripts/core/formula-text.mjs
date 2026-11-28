/**
 * A roll formula as shown to a player: its `@chemin` references replaced by their value when the roll data
 * provides it ("@scale.bard.inspiration" → "1d10"). A reference with no value stays as it is. Pure function.
 * @param {string} formula
 * @param {object} data  the roll data of the actor or of the activity
 * @returns {string}
 */
export function formulaShown(formula, data) {
  return String(formula ?? "").replace(/@([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)/g, (whole, path) => {
    let value = data;
    for ( const key of path.split(".") ) value = (value === null || value === undefined) ? undefined : value[key];
    if ( (value === null) || (value === undefined) ) return whole;
    const text = String(value);
    return (text && (text !== "[object Object]")) ? text : whole;
  });
}
