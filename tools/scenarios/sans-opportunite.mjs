/**
 * M8 (SPEC §18.15) — does not provoke an Opportunity Attack. World `ravenloft`, in combat, the Wolf next to Bramo moves away
 * on foot (writing x/y: a real `walk` move, which goes through `preMoveToken`; `move-token` moves with `displace`,
 * which the engine treats as a teleport):
 *  1. "Agile" (Rat) lent to the Wolf: nothing is offered;
 *  2. witness, "Agile" removed: Bramo's Opportunity Attack is offered — so Bramo's Reaction was available at the
 *     "Agile" test. ⚠️ a Reaction window opens on the GM's side, and closes by itself after the delay ("no");
 *  3. on the Wolf's next turn (Bramo has played in the meantime: his Reaction is back), "Prowl" (Weretiger) lent and used:
 *     the rest of the turn, nothing is offered.
 */
const RAT = "Compendium.dnd-monster-manual.actors.Actor.mmRat00000000000";
const WERETIGER = "Compendium.dnd-monster-manual.actors.Actor.mmWeretiger00000";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "sans attaque d'opportunité — Agile, Rôder",

  async run(ctx) {
    // Absent from `dnd-6`: placed for the scenario from their sheet (Monster Manual 2024, otherwise the dnd5e SRD 2024).
    await ctx.cast({ "Loup": "mmWolf0000000000" }, { near: "Zombi" });
    const { tokens } = await ctx.scene();
    if ( !["Loup", "Bramo"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Loup ou Bramo absent : non applicable"); return; }
    const wolf = await ctx.token("Loup");
    const bramo = await ctx.token("Bramo");
    const grid = await ctx.gridSize();
    for ( const t of [wolf, bramo] ) {
      const home = await ctx.position(t);
      ctx.restore(() => ctx.call("move-token", { tokenId: t.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
    }
    const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: wolf.id });
    const lend = async (uuid, identifier) => {
      const { data: source } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = source.items.find(i => i.system?.identifier === identifier);
      const up = await ctx.call("upsert-actor-item", { actorId: tok.actorId, itemData, match: { path: "system.identifier", value: identifier } });
      const itemId = up.itemId ?? up.id ?? up.item?._id ?? (await ctx.itemId(wolf.id, identifier));
      const remove = () => ctx.call("remove-embedded-item", { documentType: "Actor", id: tok.actorId, itemId }).catch(() => {});
      ctx.restore(remove);
      return { itemId, remove };
    };

    const at = await ctx.position(bramo);
    await ctx.startCombat([wolf, bramo]);
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const combat = await state();
    for ( const [token, value] of [[wolf, 20], [bramo, 10]] ) {
      await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === token.id).id, value, combatId: ctx.ownCombat });
    }
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    for ( let i = 0; (i < 3) && ((await current()) !== wolf.id); i++ ) { await ctx.nextTurn(); await sleep(1000); }
    if ( !ctx.expect((await current()) === wolf.id, "tour du Loup") ) return;

    /** The Wolf is placed next to Bramo (without provoking), then moves away on foot by three cells. Returns true if an OA was offered. */
    const walkAway = async wait => {
      await ctx.call("move-token", { tokenId: wolf.id, x: at.x + grid, y: at.y, elevation: at.elevation });
      await sleep(800);
      // The engine's log is not emptied by reading it: we count the offers before and after.
      const proposed = async () => (await ctx.engineLog()).filter(l => /attaque d'opportunité proposée|Opportunity Attack offered/.test(l) && /Loup/.test(l)).length;
      const before = await proposed();
      await ctx.call("update-scene-object", { type: "Token", objectId: wolf.id, data: { x: at.x + 4 * grid, y: at.y } });
      await sleep(wait);
      return (await proposed()) > before;
    };

    // 1. Agile.
    const agile = await lend(RAT, "agile");
    await sleep(500);
    ctx.expect(!(await walkAway(3000)), "Agile : rien n'est proposé");
    await agile.remove();
    await sleep(500);

    // 2. Witness.
    ctx.expect(await walkAway(14000), "témoin (Agile retiré) : l'attaque d'opportunité est proposée — Bramo pouvait réagir");

    // 3. Prowl, on the Wolf's next turn.
    for ( let i = 0; (i < 3) && ((await current()) === wolf.id); i++ ) { await ctx.nextTurn(); await sleep(1000); }
    for ( let i = 0; (i < 3) && ((await current()) !== wolf.id); i++ ) { await ctx.nextTurn(); await sleep(1000); }
    if ( !ctx.expect((await current()) === wolf.id, "tour suivant du Loup") ) return;
    const prowl = await lend(WERETIGER, "prowl");
    await ctx.use({ tokenId: wolf.id, itemId: prowl.itemId });
    await sleep(1500);
    ctx.expect(!(await walkAway(3000)), "Rôder utilisé : rien n'est proposé le reste du tour");
  }
};
