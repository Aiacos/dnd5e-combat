/**
 * §501 (B21) — "if it would lose its reactions, it loses only one": `reactions: { perRound: 3, loseOne: true }`. Test arena:
 * Zombie (synthetic actor of the token) and Fighter, in a scenario combat. A test trait is lent to the Zombie; its rule is
 * in the world overlay (`overrideContent`, never in an item flag).
 *  1. At the start of combat: 3 reactions, it can react.
 *  2. Incapacitated: it keeps the ability to react, one reaction fewer (2), notice at the table.
 *  3. Stunned (2 s later, another blow): one fewer (1), it can still react.
 *  4. Without `loseOne` (rule reset to `{ perRound: 3 }`), still Incapacitated: it can no longer react, the budget stays.
 * Conditions removed first and at the end (synthetic actor), trait, overlay, combat restored. No window expected.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(r => setTimeout(r, ms));

const IDENTIFIER = "das-essai-reaction-perdue";
// Name as a constant: the bench and the reference take the first "name:" indented by two spaces as the scenario's title.
const ITEM_NAME = "Essai : réactions multiples";
const RULE = { reactions: { perRound: 3, loseOne: true } };

const LEND = `
const actor = canvas.scene.tokens.get(args.tokenId).actor;
for ( const i of actor.items.filter(i => i.system?.identifier === args.identifier) ) await i.delete();
if ( args.remove ) return true;
const [item] = await actor.createEmbeddedDocuments("Item", [{ name: args.name, type: "feat", img: "icons/svg/clockwork.svg",
  system: { identifier: args.identifier, type: { value: "monster" }, description: { value: "<p>Essai §501.</p>" } } }]);
return { itemId: item.id };
`;
/** The Zombie's reaction budget in the scenario's combat. */
const BUDGET = `
const combat = game.combats.get(args.combatId);
const c = combat?.combatants.find(x => x.tokenId === args.tokenId);
return c ? (c.getFlag("${MODULE_ID}", "turn")?.reaction ?? null) : null;
`;

export default {
  name: "reaction-perdue — réactions multiples : Neutralisé ou Étourdi ne lui ôtent qu'une réaction chacun, avec un avis ; sans la règle, il ne réagit plus (§501, brique B21)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Zombi", "Guerrier"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const zombie = await ctx.token("Zombi");
    const fighter = await ctx.token("Guerrier");
    const script = async (code, args={}) => (await ctx.call("run-script", { code, args, waitMs: 20000 }))?.result ?? null;

    const STATUSES = ["incapacitated", "stunned", "paralyzed"];
    const clear = async () => { for ( const s of STATUSES ) await ctx.removeStatusEffects(zombie, s).catch(() => {}); };
    await clear();
    ctx.restore(clear);
    const lent = await script(LEND, { tokenId: zombie.id, identifier: IDENTIFIER, name: ITEM_NAME });
    ctx.restore(() => script(LEND, { tokenId: zombie.id, identifier: IDENTIFIER, remove: true }).catch(() => {}));
    if ( !ctx.expect(!!lent?.itemId, "trait prêté au Zombi") ) return;
    const { before } = await ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: RULE });
    ctx.restore(() => ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: before }).catch(() => {}));
    await pause(500);

    const combat = await ctx.startCombat([zombie, fighter]);
    if ( !ctx.expect(!!ctx.ownCombat, `combat du scénario lancé (${JSON.stringify(combat)?.slice(0, 120)})`) ) return;
    await pause(1000);

    const state = async () => {
      const s = await ctx.engine("stats", { tokenId: zombie.id });
      return { budget: await script(BUDGET, { combatId: ctx.ownCombat, tokenId: zombie.id }), canReact: !s?.reaction?.incapacitated,
        available: !!s?.reaction?.reactionAvailable, statuses: s?.statuses ?? [] };
    };
    const pose = async status => {
      const since = await ctx.lastMessageId();
      await ctx.call("set-status", { tokenId: zombie.id, statusId: status, active: true });
      await pause(2500);   // beyond the engine's "same blow" window (1.5 s)
      return { ...(await state()), since };
    };

    try {
      const s0 = await state();
      ctx.expect((s0.budget ?? 3) === 3 && s0.canReact && s0.available, `début du combat : 3 réactions, peut réagir (${JSON.stringify(s0)})`);

      const s1 = await pose("incapacitated");
      ctx.expect(s1.statuses.includes("incapacitated"), "Neutralisé posé");
      ctx.expect(s1.budget === 2, `Neutralisé : une réaction de moins (${s1.budget})`);
      ctx.expect(s1.canReact && s1.available, `il peut encore réagir (${JSON.stringify(s1)})`);
      ctx.log((await ctx.engineLog().catch(() => [])).filter(l => /Reaction/.test(l)).slice(-2).join(" | "));

      const s2 = await pose("stunned");
      ctx.expect(s2.budget === 1, `Étourdi : une de moins (${s2.budget})`);
      ctx.expect(s2.canReact, "il peut encore réagir");

      await ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: { reactions: { perRound: 3 } } });
      await pause(800);
      const s3 = await state();
      ctx.expect(!s3.canReact, `sans « loseOne », Neutralisé : il ne peut plus réagir (${JSON.stringify(s3)})`);
      ctx.expect(s3.budget === s2.budget, `et le budget ne bouge pas (${s3.budget})`);
    } finally {
      await clear();
    }
    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
