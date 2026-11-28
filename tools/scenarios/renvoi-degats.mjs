/**
 * §499 (B19) — return to the attacker the amount of damage taken: `damage { to: "source", same: "resisted" }` at the
 * `isDamaged` moment of a carried effect, filtered by `activity.isMelee`; and the effect that disappears on radiant
 * damage (`remove`, `damage.hasType`).
 * Test arena: Fighter (the attacker, his melee weapon), Wizard (a ranged attack, if he has one), Zombie (the
 * bearer, synthetic actor of the token). A test trait is lent to the Zombie and its effect placed on it (Resistance to
 * slashing damage, origin: the trait); the rule is in the world overlay (`overrideContent`, never in an item flag).
 * The damage is applied by the GM's client as the button of a damage card does (`applyDamage` with an in-memory origin
 * message naming the author and its activity): exact amounts, no roll, no window.
 *  1. 10 slashing from the Fighter's weapon: the Zombie takes 5 (Resistance), the Fighter 5 slashing in return (card `returned`).
 *  2. 6 fire from the same weapon: nothing is returned (damage not resisted).
 *  3. 10 slashing with no author (token bar): nothing is returned.
 *  4. 10 slashing from a ranged attack of the Wizard (if he has one): nothing is returned (`activity.isMelee`).
 *  5. 1 radiant: the effect disappears.
 * Effect and trait removed, Zombie's and Fighter's HP restored, overlay given back.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(r => setTimeout(r, ms));

const IDENTIFIER = "das-essai-renvoi-degats";
// Name as a constant: the bench and the reference take the first "name:" indented by two spaces as the scenario's title.
const ITEM_NAME = "Essai : linceul qui renvoie";
const RULE = { triggers: [
  { on: "isDamaged", via: "effect", if: { "activity.isMelee": true }, do: [{ type: "damage", to: "source", same: "resisted" }] },
  { on: "isDamaged", via: "effect", if: { "damage.hasType": "radiant" }, do: [{ type: "remove" }] }
] };

/** Lends the trait to the Zombie (synthetic actor) and places its effect; returns their ids. */
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
 * Applies `damages` to the Zombie like a card's button: in-memory origin message (author: the token `from`, activity `activity`).
 * Without `from`: no author, like the token bar.
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
/** Tokens' HP, test effect still there, melee and ranged attack activities of their weapons. */
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

    // --- Windows on the GM's side: none is left unanswered ---------------------------------------------------------------------
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

    // --- Reading, starting HP, restoration ---------------------------------------------------------------------------------------
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

    /** One blow: `damages` applied to the Zombie; returns each one's lost HP and the return card, if there is one. */
    const hit = async (damages, from=null, activity=null) => {
      // Full HP before each blow: the Zombie never falls (its Undead Fortitude does not come into play).
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
