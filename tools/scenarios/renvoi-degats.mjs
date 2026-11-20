/**
 * §499 (B19) — renvoyer à l'attaquant le montant de dégâts subi : `damage { to: "source", same: "resisted" }` au moment `isDamaged`
 * d'un effet porté, filtré par `activity.isMelee` ; et l'effet qui disparaît sur des dégâts radiants (`remove`, `damage.hasType`).
 * Arène de test : Guerrier (l'attaquant, son arme de corps à corps), Magicien (une attaque à distance, s'il en a une), Zombi (le
 * porteur, acteur synthétique du token). Un trait d'essai est prêté au Zombi et son effet posé sur lui (Résistance aux dégâts
 * tranchants, origine : le trait) ; la règle est dans la surcouche du monde (`overrideContent`, jamais en drapeau d'item).
 * Les dégâts sont appliqués par le client du MJ comme le fait le bouton d'une carte de dégâts (`applyDamage` avec un message d'origine
 * en mémoire qui nomme l'auteur et son activité) : montants exacts, aucun jet, aucune fenêtre.
 *  1. 10 tranchants de l'arme du Guerrier : le Zombi en subit 5 (résistance), le Guerrier 5 tranchants en retour (carte `returned`).
 *  2. 6 de feu de la même arme : rien n'est renvoyé (dégâts non résistés).
 *  3. 10 tranchants sans auteur (barre du token) : rien n'est renvoyé.
 *  4. 10 tranchants d'une attaque à distance du Magicien (s'il en a une) : rien n'est renvoyé (`activity.isMelee`).
 *  5. 1 radiant : l'effet disparaît.
 * Effet et trait retirés, PV du Zombi et du Guerrier remis, surcouche rendue.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(r => setTimeout(r, ms));

const IDENTIFIER = "das-essai-renvoi-degats";
// Nom en constante : le banc et la référence prennent le premier « name: » indenté de deux espaces pour le titre du scénario.
const ITEM_NAME = "Essai : linceul qui renvoie";
const RULE = { triggers: [
  { on: "isDamaged", via: "effect", if: { "activity.isMelee": true }, do: [{ type: "damage", to: "source", same: "resisted" }] },
  { on: "isDamaged", via: "effect", if: { "damage.hasType": "radiant" }, do: [{ type: "remove" }] }
] };

/** Prête le trait au Zombi (acteur synthétique) et pose son effet ; rend leurs ids. */
const SETUP = `
const t = canvas.scene.tokens.get(args.tokenId);
const actor = t.actor;
for ( const i of actor.items.filter(i => i.system?.identifier === args.identifier) ) await i.delete();
for ( const e of actor.effects.filter(e => e.name === args.name) ) await e.delete();
const [item] = await actor.createEmbeddedDocuments("Item", [{ name: args.name, type: "feat", img: "icons/magic/unholy/energy-smoke-pink.webp",
  system: { identifier: args.identifier, type: { value: "monster" }, description: { value: "<p>Essai §499.</p>" } } }]);
const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [{ name: args.name, img: "icons/magic/unholy/energy-smoke-pink.webp",
  origin: item.uuid, transfer: false, changes: [{ key: "system.traits.dr.value", type: "add", value: "slashing" }] }]);
return { itemId: item.id, effectId: effect.id };
`;
const CLEANUP = `
const actor = canvas.scene.tokens.get(args.tokenId)?.actor;
if ( !actor ) return false;
for ( const e of actor.effects.filter(e => e.name === args.name) ) await e.delete();
for ( const i of actor.items.filter(i => i.system?.identifier === args.identifier) ) await i.delete();
return true;
`;
/**
 * Applique `damages` au Zombi comme le bouton d'une carte : message d'origine en mémoire (auteur : le token `from`, activité `activity`).
 * Sans `from` : sans auteur, comme la barre du token.
 */
const HURT = `
const target = canvas.scene.tokens.get(args.tokenId).actor;
let options = {};
if ( args.from ) {
  const from = canvas.scene.tokens.get(args.from);
  const message = new ChatMessage.implementation({ speaker: { scene: canvas.scene.id, token: from.id, actor: from.actorId, alias: from.name },
    flags: { dnd5e: { activity: { uuid: args.activity } } } });
  options = { originatingMessage: message };
}
await target.applyDamage(args.damages.map(d => ({ ...d, properties: new Set() })), options);
return true;
`;
/** PV des tokens, effet d'essai encore là, activités d'attaque de corps à corps et à distance de leurs armes. */
const READ = `
const out = {};
for ( const id of args.tokenIds ) {
  const t = canvas.scene.tokens.get(id);
  out[id] = { hp: t?.actor?.system?.attributes?.hp?.value ?? null, max: t?.actor?.system?.attributes?.hp?.max ?? null, effect: !!t?.actor?.effects.find(e => e.name === args.name) };
}
const find = (id, kind) => {
  const actor = canvas.scene.tokens.get(id)?.actor;
  for ( const item of actor?.items ?? [] ) for ( const a of item.system?.activities ?? [] ) {
    if ( a.type !== "attack" ) continue;
    const melee = a.attack?.type?.value === "melee";
    if ( (kind === "melee") === melee ) return a.uuid;
  }
  return null;
};
out.melee = args.melee ? find(args.melee, "melee") : null;
out.ranged = args.ranged ? find(args.ranged, "ranged") : null;
return out;
`;

export default {
  name: "renvoi-degats — linceul : l'attaquant au corps à corps subit le même montant de dégâts résistés, rien à distance ni sans auteur, effet dissipé par des dégâts radiants (§499, brique B19)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Guerrier", "Zombi"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const fighter = await ctx.token("Guerrier");
    const zombie = await ctx.token("Zombi");
    const mage = tokens.some(t => t.name === "Magicien") ? await ctx.token("Magicien") : null;
    const script = async (code, args={}) => (await ctx.call("run-script", { code, args, waitMs: 20000 }))?.result ?? null;
    const args = { tokenId: zombie.id, identifier: IDENTIFIER, name: ITEM_NAME };

    // --- Fenêtres chez le MJ : aucune ne reste sans réponse --------------------------------------------------------------
    const seen = new Set(((await ctx.call("list-dialogs", {})).windows ?? []).map(w => w.id));
    const sweep = async (ms=800) => {
      const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: [...seen], waitMs: ms, details: true }).catch(() => null);
      for ( const w of r?.windows ?? [] ) {
        seen.add(w.id);
        const go = (w.buttons ?? []).find(b => b.action === "go");
        const button = go ? "go" : ((w.buttons ?? []).find(b => ["cancel", "no", "none"].includes(b.action))?.action ?? null);
        ctx.log(`fenêtre « ${w.title} » : ${button ?? "fermée"}`);
        await ctx.call("answer-dialog", { id: w.id, ...(button ? { button } : {}) }).catch(() => {});
      }
    };

    // --- Lecture, PV de départ, remise en état --------------------------------------------------------------------------------
    const ids = [fighter.id, zombie.id];
    const read = () => script(READ, { tokenIds: ids, name: ITEM_NAME, melee: fighter.id, ranged: mage?.id ?? null });
    const start = await read();
    if ( !ctx.expect(!!start?.melee, `le Guerrier a une attaque de corps à corps (${start?.melee})`) ) return;
    ctx.restore(() => ctx.setHp(fighter, start[fighter.id].hp).catch(() => {}));
    ctx.restore(() => ctx.setHp(zombie, start[zombie.id].hp).catch(() => {}));
    await script(CLEANUP, args);
    ctx.restore(() => script(CLEANUP, args).catch(() => {}));
    const { before } = await ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: RULE });
    ctx.restore(() => ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: before }).catch(() => {}));
    const lent = await script(SETUP, args);
    if ( !ctx.expect(!!lent?.effectId, `trait prêté au Zombi, effet posé (${JSON.stringify(lent)})`) ) return;
    await pause(800);

    /** Un coup : `damages` appliqués au Zombi ; rend les PV perdus de chacun et la carte de renvoi, s'il y en a une. */
    const hit = async (damages, from=null, activity=null) => {
      // PV pleins avant chaque coup : le Zombi ne tombe jamais (sa Ténacité de mort-vivant n'entre pas en jeu).
      await ctx.setHp(zombie, start[zombie.id].max);
      await ctx.setHp(fighter, start[fighter.id].max);
      await pause(400);
      const before = await read();
      const since = await ctx.lastMessageId();
      await script(HURT, { tokenId: zombie.id, damages, from, activity });
      await pause(2500);
      await sweep(300);
      const after = await read();
      const card = (await ctx.messagesSince(since)).find(m => m.flags?.[MODULE_ID]?.returned)?.flags?.[MODULE_ID]?.returned ?? null;
      return { bearerLost: before[zombie.id].hp - after[zombie.id].hp, attackerLost: before[fighter.id].hp - after[fighter.id].hp,
        card, effect: after[zombie.id].effect };
    };
    const part = async (label, fn) => {
      try { await fn(); }
      catch(err) { ctx.expect(false, `${label} : ${err.message}`); }
      await sweep(300);
    };

    await part("corps à corps, tranchant résisté", async () => {
      const r = await hit([{ value: 10, type: "slashing" }], fighter.id, start.melee);
      ctx.expect(r.bearerLost === 5, `le Zombi subit 5 (résistance) : ${r.bearerLost}`);
      ctx.expect(r.card?.amount === 5 && r.card.damages?.[0]?.type === "slashing", `carte : 5 tranchants renvoyés (${JSON.stringify(r.card)})`);
      ctx.expect(r.attackerLost > 0 && r.attackerLost <= 5, `le Guerrier perd ses PV en retour (${r.attackerLost} sur 5, ses propres résistances comprises)`);
    });
    await part("corps à corps, feu non résisté", async () => {
      const r = await hit([{ value: 6, type: "fire" }], fighter.id, start.melee);
      ctx.expect(r.bearerLost === 6 && !r.card && r.attackerLost === 0, `rien n'est renvoyé (${JSON.stringify(r)})`);
    });
    await part("sans auteur", async () => {
      const r = await hit([{ value: 10, type: "slashing" }]);
      ctx.expect(r.bearerLost === 5 && !r.card && r.attackerLost === 0, `rien n'est renvoyé (${JSON.stringify(r)})`);
    });
    if ( start.ranged ) await part("attaque à distance", async () => {
      const r = await hit([{ value: 10, type: "slashing" }], mage.id, start.ranged);
      ctx.expect(r.bearerLost === 5 && !r.card, `rien n'est renvoyé (${JSON.stringify(r)})`);
    });
    else ctx.log("pas d'attaque à distance au Magicien : cas 4 sauté");
    await part("dégâts radiants", async () => {
      const r = await hit([{ value: 1, type: "radiant" }], fighter.id, start.melee);
      ctx.expect(r.effect === false && !r.card, `l'effet disparaît, rien n'est renvoyé (${JSON.stringify(r)})`);
    });
    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
