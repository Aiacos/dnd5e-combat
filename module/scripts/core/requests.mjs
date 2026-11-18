/**
 * Ce qu'une requête reçue d'un autre client a le droit de demander (§471). Une requête du cœur V14 (`User#query`) arrive avec
 * son expéditeur ; ses données sont celles que ce client a envoyées. Règles pures :
 * runtime/cure.mjs et adapter/reactions.mjs les appliquent. Un refus ici est de la sécurité, pas une règle du jeu : il ne se force pas
 * (le MJ garde ses moyens, une requête qu'il envoie lui-même passe telle quelle).
 */

/**
 * Faut-il vérifier cette requête ? Non pour un appel local (pas d'expéditeur : c'est ce client qui la fait), ni pour soi-même ou un MJ.
 * @param {{isGM?: boolean, isSelf?: boolean}|null|undefined} user  l'expéditeur, tel que le cœur le passe au gestionnaire
 */
export const needsCheck = user => !!user && !user.isSelf && !user.isGM;

/**
 * La requête `cure` : la règle de contenu de l'objet utilisé permet-elle cet acte sur la cible ?
 * @param {object|null} entry  le contenu de l'objet de la carte d'utilisation (`contentOf(item).entry`)
 * @param {string} status      l'acte demandé (`hp`, `temphp`, `curses`, `exhaustion`, `exhaustion-1`, `standReaction`, ou un état)
 * @param {*} value
 */
export function cureAllowed(entry, status, value=null) {
  if ( !entry ) return false;
  const ends = [...(entry.cures ?? []), ...(entry.curesAll ?? [])];
  switch ( status ) {
    case "hp": return !!(entry.healPool || entry.revivesFull);
    case "temphp": return !!(entry.healPool?.temp || entry.tempHpPool);
    case "curses": return Array.isArray(value) && (value.length > 0) && value.every(id => (entry.endsCurses ?? []).includes(id));
    case "exhaustion": return (entry.curesAll ?? []).includes("exhaustion");
    case "exhaustion-1": return ends.includes("exhaustion");
    case "standReaction": return !!entry.standsWithReaction;
    default: return (typeof status === "string") && ends.includes(status);
  }
}

/**
 * Des PV demandés par un autre client : un soin ne blesse jamais et ne dépasse pas le maximum.
 * @param {*} value
 * @param {{current: number, max: number}} hp
 * @returns {number}
 */
export function healedHp(value, { current, max }) {
  const wanted = Number(value);
  if ( !Number.isFinite(wanted) ) return current;
  return Math.max(current, Math.min(max, Math.floor(wanted)));
}

/**
 * Des PV temporaires demandés par un autre client : positifs, et au plus `ceiling` quand on le connaît (la réserve de la règle, le jet).
 * @param {*} value
 * @param {number} [ceiling]
 * @returns {number}
 */
export function grantedTempHp(value, ceiling=Infinity) {
  const wanted = Math.floor(Number(value));
  if ( !Number.isFinite(wanted) || (wanted <= 0) ) return 0;
  return Math.min(wanted, ceiling);
}

/**
 * Ce qu'une option de réaction venue d'un autre client peut changer à l'utilisation : seulement les formes que le moteur envoie
 * lui-même — le niveau d'un sort contré (`scaling`, runtime/gates.mjs), le sort préparé déjà payé (`spell.slot`,
 * `consume.spellSlot: false`, `readiedRelease`, adapter/ready.mjs), Égide projetée (`consume: false`). Le reste tombe.
 * @param {object} usage
 */
function plainUsage(usage) {
  if ( !usage || (typeof usage !== "object") ) return null;
  const out = {};
  if ( Number.isInteger(usage.scaling) && (usage.scaling >= 0) && (usage.scaling <= 9) ) out.scaling = usage.scaling;
  if ( /^(?:spell|pact)\d*$/.test(String(usage.spell?.slot ?? "")) ) out.spell = { slot: usage.spell.slot };
  if ( usage.consume?.spellSlot === false ) out.consume = { spellSlot: false };
  return Object.keys(out).length ? out : null;
}

/**
 * La requête `reaction` venue d'un client à qui l'on ne fait pas confiance (`needsCheck`) : la fenêtre est toujours posée (`auto` est
 * l'outil de scénario du MJ), et chaque option ne garde, de ce qui change l'utilisation, que les formes légitimes (`plainUsage`). Ce qui
 * dépend des documents (l'activité est-elle à ce réacteur, que supprime `drop`) se revérifie sur le receveur (adapter/reactions.mjs).
 * @param {object} payload
 * @returns {object}
 */
export function plainReaction(payload) {
  const options = (Array.isArray(payload?.options) ? payload.options : []).map(o => {
    const { usage, flags, consume, ...rest } = o ?? {};
    const kept = { ...rest, usage: plainUsage(usage) };
    if ( consume === false ) kept.consume = false;
    if ( flags?.readiedRelease === true ) kept.flags = { readiedRelease: true };
    return kept;
  });
  return { ...payload, options, auto: false };
}
