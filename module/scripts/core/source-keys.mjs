/**
 * §334 : les clés sous lesquelles un item se cherche dans les sources (content/sources.mjs et celles qu'un module enregistre), de
 * la plus précise à la plus large. Fonction pure.
 *
 * Un id d'item de créature est partagé entre créatures (« mmBite0000000000 ») : la clé « id d'acteur.id d'item » vise la capacité
 * d'une seule. L'acteur se lit dans l'uuid de la source de l'item quand elle passe par lui (« ….Actor.<a>.Item.<i> »), et sinon
 * dans l'acteur qui porte l'item : la source d'un item embarqué désigne le plus souvent le compendium des capacités
 * (« ….features.Item.<i> »), qui ne dit rien de la créature — l'acteur, lui, garde l'id de sa fiche (sa propre source de
 * compendium pour une copie dans le monde ou un token, son id dans le compendium).
 *
 * @param {object} o
 * @param {string|null} [o.itemSource]   Uuid de la source de compendium de l'item.
 * @param {string|null} [o.itemId]       Id de l'item.
 * @param {string|null} [o.actorSource]  Uuid de la source de compendium de l'acteur qui porte l'item.
 * @param {string|null} [o.actorId]      Id de cet acteur.
 * @returns {string[]}  Les clés à essayer, dans l'ordre, sans doublon.
 */
export function sourceKeys({ itemSource=null, itemId=null, actorSource=null, actorId=null }={}) {
  const parts = String(itemSource ?? "").split(".").filter(Boolean);
  const sourceItem = parts.at(-1) ?? null;
  const item = sourceItem ?? itemId;
  const keys = [];
  if ( parts.length > 3 ) keys.push(`${parts.at(-3)}.${sourceItem}`);
  const actor = String(actorSource ?? "").split(".").filter(Boolean).at(-1) ?? actorId;
  if ( actor && item ) keys.push(`${actor}.${item}`);
  if ( actorId && item && (actorId !== actor) ) keys.push(`${actorId}.${item}`);
  if ( sourceItem ) keys.push(sourceItem);
  if ( itemId ) keys.push(itemId);
  return [...new Set(keys)];
}
