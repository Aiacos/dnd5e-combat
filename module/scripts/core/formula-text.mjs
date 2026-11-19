/**
 * Une formule de jet telle qu'on la montre à un joueur : ses références `@chemin` remplacées par leur valeur quand les données du
 * jet la donnent (« @scale.bard.inspiration » → « 1d10 »). Une référence sans valeur reste telle quelle. Fonction pure.
 * @param {string} formula
 * @param {object} data  les données de jet de l'acteur ou de l'activité
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
