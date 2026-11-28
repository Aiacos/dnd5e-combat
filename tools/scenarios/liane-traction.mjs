/**
 * §502 (B22) — pull toward the summon and a single grappled creature: `move { mode: "pull", toward: "summon" }` at the
 * `hit` moment,
 * `grapples: { one: true, by: "summon" }`. Arène de test: Zombi (the author, synthetic actor), Fighter and Bandit (the targets).
 * A test feature is lent to the Zombi: an attack (+50 to hit, 1 bludgeoning) whose effect makes Grappled. A test "vine" is
 * placed three cells east of the Zombi, marked as summoned by this feature (`flags.dnd5e.summon.origin`); the rule is in the
 * world overlay (`overrideContent`, never in an item flag).
 *  1. The Zombi hits the Fighter: the Fighter is grappled and pulled toward the vine (its distance to the vine drops); 2 s later,
 *     the grapple still holds (held by the vine, not judged against the Zombi's reach).
 *  2. The Zombi hits the Bandit: the Bandit is grappled, the Fighter released (no more Grappled from this feature),
 *     notice `Empoignade.UneSeule`.
 *  3. The vine removed: the Bandit's grapple ends.
 * A natural 1 misses: each attack is replayed up to three times. Positions restored by the caster; Grappled, feature, vine, overlay
 * removed. Any "do it anyway" window is accepted ("go"), any other closed.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(r => setTimeout(r, ms));

const IDENTIFIER = "das-essai-liane-traction";
const ACTIVITY = "dasEssaiLianeAtq";
const EFFECT = "dasEssaiLianeAgr";
// Name in a constant: the test bench and the reference take the first "name:" indented by two spaces as the scenario title.
const ITEM_NAME = "Essai : liane qui tire";
const VINE = "Essai : liane";
const RULE = { grapples: { one: true, by: "summon" },
  triggers: [{ on: "hit", do: [{ type: "move", mode: "pull", distance: 30, units: "ft", toward: "summon" }] }] };

const SETUP = `
const z = canvas.scene.tokens.get(args.attacker);
const actor = z.actor;
for ( const i of actor.items.filter(i => i.system?.identifier === args.identifier) ) await i.delete();
const [item] = await actor.createEmbeddedDocuments("Item", [{ name: args.name, type: "feat", img: "icons/magic/nature/root-vine-entangled-hand.webp",
  system: { identifier: args.identifier, type: { value: "monster" }, description: { value: "<p>Essai §502.</p>" },
    activities: { [args.activity]: { _id: args.activity, type: "attack", activation: { type: "action", value: 1 },
      range: { value: "60", units: "ft", override: true }, target: { affects: { type: "creature", count: "1" } },
      attack: { type: { value: "ranged", classification: "spell" }, bonus: "50", flat: true },
      damage: { parts: [{ number: 1, denomination: 0, bonus: "1", types: ["bludgeoning"] }] }, effects: [{ _id: args.effect }] } } },
  effects: [{ _id: args.effect, name: args.name + " : agrippé", img: "icons/svg/net.svg", transfer: false, statuses: ["grappled"] }] }], { keepEmbeddedIds: true });
const g = canvas.scene.grid.size;
const vine = await Actor.implementation.create({ name: args.vine, type: "npc", img: "icons/magic/nature/root-vine-entangled-hand.webp",
  prototypeToken: { name: args.vine, actorLink: true, disposition: z.disposition },
  system: { attributes: { hp: { value: 10, max: 10 } } }, flags: { dnd5e: { summon: { origin: item.uuid } }, "${MODULE_ID}": { scenario: "liane-traction" } } });
const proto = (await vine.getTokenDocument({ x: z._source.x + 3 * g, y: z._source.y })).toObject();
const [vt] = await canvas.scene.createEmbeddedDocuments("Token", [proto]);
return { itemId: item.id, vineActor: vine.id, vineToken: vt.id };
`;
const CLEANUP = `
const actor = canvas.scene.tokens.get(args.attacker)?.actor;
for ( const i of actor?.items.filter(i => i.system?.identifier === args.identifier) ?? [] ) await i.delete();
for ( const s of game.scenes ) {
  const ids = s.tokens.filter(t => (t.id === args.vineToken) || (t.actorId === args.vineActor)).map(t => t.id);
  if ( ids.length ) await s.deleteEmbeddedDocuments("Token", ids);
}
await game.actors.get(args.vineActor)?.delete();
return true;
`;
const REMOVE_VINE = `
const t = canvas.scene.tokens.get(args.vineToken);
if ( t ) await t.delete();
return true;
`;
/** For each target: Grappled by this feature? distance (in cells) to the vine. */
const READ = `
const vine = canvas.scene.tokens.get(args.vineToken);
const g = canvas.scene.grid.size;
const out = {};
for ( const id of args.ids ) {
  const t = canvas.scene.tokens.get(id);
  const held = (t?.actor?.effects ?? []).some(e => !e.disabled && e.statuses?.has("grappled") && e.name === args.name + " : agrippé");
  out[id] = { held, toVine: vine ? Math.max(Math.abs(t._source.x - vine._source.x), Math.abs(t._source.y - vine._source.y)) / g : null };
}
return out;
`;

export default {
  name: "liane-traction — Liane avide : la cible touchée est tirée vers la liane invoquée et agrippée par elle ; une seule à la fois, l'ancienne relâchée (§502, brique B22)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Zombi", "Guerrier", "Bandit"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const zombie = await ctx.token("Zombi");
    const fighter = await ctx.token("Guerrier");
    const bandit = await ctx.token("Bandit");
    const script = async (code, args={}) => (await ctx.call("run-script", { code, args, waitMs: 20000 }))?.result ?? null;

    // --- Windows on the GM's side: none stays unanswered -----------------------------------------------------------------
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

    // --- Own targets, feature, vine, rule -------------------------------------------------------------------------------------
    const clear = async () => { for ( const t of [fighter, bandit] ) await ctx.removeStatusEffects(t, "grappled").catch(() => {}); };
    await clear();
    ctx.restore(clear);
    const set = await script(SETUP, { attacker: zombie.id, identifier: IDENTIFIER, name: ITEM_NAME, activity: ACTIVITY, effect: EFFECT, vine: VINE });
    if ( !ctx.expect(!!set?.vineToken, `trait prêté au Zombi, liane posée (${JSON.stringify(set)})`) ) return;
    ctx.restore(() => script(CLEANUP, { attacker: zombie.id, identifier: IDENTIFIER, ...set }).catch(() => {}));
    const { before } = await ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: RULE });
    ctx.restore(() => ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: before }).catch(() => {}));
    await pause(1000);

    const ids = [fighter.id, bandit.id];
    const read = () => script(READ, { vineToken: set.vineToken, ids, name: ITEM_NAME });
    /** An attack of the feature on `target`, replayed on a natural 1; returns true if it hit. */
    const strike = async target => {
      for ( let shot = 1; shot <= 3; shot++ ) {
        const used = await ctx.use({ tokenId: zombie.id, itemId: set.itemId, activityType: "attack", targetTokenIds: [target.id] });
        await sweep(500);
        const r = await ctx.settle(used.usageMessageId).catch(err => { ctx.log(err.message); return null; });
        await pause(2500);
        await sweep(300);
        if ( r?.targets?.[0]?.hit ) return true;
        ctx.log(`attaque ${shot} sur ${target.name} : ratée (${r?.attack?.roll?.total ?? "?"})`);
      }
      return false;
    };

    try {
      const s0 = await read();
      const hitF = await strike(fighter);
      if ( !ctx.expect(hitF, "le Zombi touche le Guerrier") ) return;
      const s1 = await read();
      ctx.expect(s1[fighter.id].held, "le Guerrier est agrippé");
      ctx.expect(s1[fighter.id].toVine < s0[fighter.id].toVine, `tiré vers la liane : ${s0[fighter.id].toVine} → ${s1[fighter.id].toVine} cases`);
      await pause(2000);
      ctx.expect((await read())[fighter.id].held, "l'empoignade tient (tenue par la liane, loin de l'allonge du Zombi)");

      const hitB = await strike(bandit);
      if ( !ctx.expect(hitB, "le Zombi touche le Bandit") ) return;
      const s2 = await read();
      ctx.expect(s2[bandit.id].held, "le Bandit est agrippé");
      ctx.expect(!s2[fighter.id].held, "le Guerrier est relâché (une seule créature à la fois)");
      const log = await ctx.engineLog().catch(() => []);
      ctx.expect(log.some(l => /holds only one creature/.test(l)), `le moteur l'a dit (${log.filter(l => /grapple/.test(l)).slice(-2).join(" | ")})`);

      await script(REMOVE_VINE, { vineToken: set.vineToken });
      await pause(2500);
      ctx.expect(!(await read())[bandit.id].held, "la liane retirée : l'empoignade cesse");
    } finally {
      await clear();
    }
    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
