/**
 * §357, batch O9d of the item pass: locks and tools. A locked door placed four cells from the Fighter (DC 15 / 20).
 *  1. Without thieves' tools, the door's menu does not offer Pick Lock, and a requested lockpicking is refused (nothing is cast).
 *  2. Thieves' tools lent: Pick Lock returns to the menu.
 *  3. Force: the Fighter carries a Crowbar — its Strength (Athletics) check is rolled with Advantage.
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const MODULE_ID = "dnd5e-combat";
const LOCKED = 2;

export default {
  name: "repasse-o9d — crocheter sans outils de voleur, forcer avec un Pied-de-biche",

  async run(ctx) {
    const fighter = await ctx.token("Guerrier").catch(() => null);
    if ( !fighter ) { ctx.log("Guerrier absent : non applicable"); return; }
    const { data: ftok } = await ctx.call("get-scene-object", { type: "Token", objectId: fighter.id });
    const items = (await ctx.call("get-actor", { actorId: ftok.actorId })).items ?? [];
    if ( items.some(i => (i.type === "tool") && (i.system?.type?.baseItem === "thief")) ) { ctx.log("le Guerrier a déjà des outils de voleur : non applicable"); return; }
    const crowbar = items.some(i => i.system?.identifier === "crowbar");
    const grid = await ctx.gridSize();
    const home = await ctx.position(fighter);
    const doorX = home.x + (4 * grid);
    const created = await ctx.call("create-walls", { walls: [{ c: [doorX, home.y, doorX, home.y + grid], preset: "door" }] });
    const wallId = created?.walls?.[0]?.id ?? created?.walls?.[0]?._id ?? null;
    if ( !wallId ) throw new Error("porte non créée");
    const failure = await ctx.engine("setting", { key: "lockFailure", value: "free" });
    ctx.restore(async () => {
      await ctx.engine("setting", { key: "lockFailure", value: failure.before }).catch(() => {});
      await ctx.call("delete-scene-object", { type: "Wall", objectId: wallId }).catch(() => {});
      const now = await ctx.position(fighter);
      if ( (now.x !== home.x) || (now.y !== home.y) ) await ctx.call("move-token", { tokenId: fighter.id, ...home }).catch(() => {});
    });
    await ctx.call("update-scene-object", { type: "Wall", objectId: wallId,
      data: { ds: LOCKED, [`flags.${MODULE_ID}.lock`]: { pickDc: 15, forceDc: 20, unforceable: false, key: "" } } });
    await pause(800);
    const methods = r => (r?.entries ?? []).map(e => e.method).join(", ");

    // 1. Sans outils.
    const refused = await ctx.engine("lock", { tokenId: fighter.id, wallId, method: "pick" });
    ctx.expect(!(refused?.entries ?? []).some(e => e.method === "pick"), `sans outils de voleur : menu « ${methods(refused)} »`);
    ctx.expect((refused?.outcome === null) && (refused?.state === "locked"), `crochetage refusé (${refused?.outcome}, ${refused?.state})`);

    // 2. Tools lent.
    await ctx.ensureItem(fighter, "Compendium.dnd-players-handbook.equipment.Item.phbtulThievesToo");
    await pause(500);
    const tooled = await ctx.engine("lock", { tokenId: fighter.id, wallId, method: "pick", total: 1 });
    ctx.expect((tooled?.entries ?? []).some(e => e.method === "pick"), `avec les outils : menu « ${methods(tooled)} »`);

    // 3. Force with the Crowbar.
    if ( !crowbar ) await ctx.ensureItem(fighter, "Compendium.dnd-players-handbook.equipment.Item.phbagCrowbar0000");
    const mark = await ctx.lastMessageId();
    await ctx.engine("lock", { tokenId: fighter.id, wallId, method: "force" });
    await pause(1500);
    const roll = (await ctx.messagesSince(mark)).flatMap(m => m.rolls ?? []).find(r => /d20/.test(r.formula ?? ""));
    ctx.expect(!!roll && (/2d20(kh|adv)/.test(roll.formula) || (roll.options?.advantageMode === 1)), `forcer avec le Pied-de-biche : Avantage (${roll?.formula ?? "pas de jet"})`);
  }
};
