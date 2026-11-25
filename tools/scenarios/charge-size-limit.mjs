/**
 * PR #260 — a charge variant ("Moving Attack") only counts against a target of at most the size the attack states. Boar, Gore
 * (Monster Manual 2024 / SRD 5.2): "If the target is a Medium or smaller creature and the boar moved 20+ feet straight toward it
 * immediately before the hit…". The Boar's Gore is lent to the Wolf (Medium), as in `variantes-attaque` (§18.8).
 *  1. After a 20+ ft straight run toward an Ogre (Large): no variant, the base attack is used.
 *  2. Same run toward the Zombie (Medium): the "Moving Attack" variant (control — the run did count as a charge).
 * The variant is read from the resolution's plan (`plan.variant`), hit or miss.
 */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ACTOR = id => `Compendium.dnd-monster-manual.actors.Actor.${id}`;

export default {
  name: "charge-size-limit — Boar's Gore: no charge variant against a Large target (PR #260)",

  async run(ctx) {
    await ctx.cast({ "Loup": "mmWolf0000000000", "Ogre": "mmOgre0000000000" }, { near: "Zombi" });
    const { tokens } = await ctx.scene();
    if ( !["Loup", "Zombi", "Ogre"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Wolf, Zombie or Ogre missing: not applicable"); return; }
    const wolf = await ctx.token("Loup");
    const zombi = await ctx.token("Zombi");
    const ogre = await ctx.token("Ogre");
    const grid = await ctx.gridSize();
    for ( const t of [wolf, zombi, ogre] ) {
      const home = await ctx.position(t);
      ctx.restore(() => ctx.call("move-token", { tokenId: t.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
      const hp = await ctx.hp(t);
      ctx.restore(() => ctx.setHp(t, hp));
      ctx.restore(() => ctx.removeStatusEffects(t, "prone"));
    }
    const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: wolf.id });

    // The Boar's Gore, lent to the Wolf under an identifier of its own.
    const { data } = await ctx.call("get-compendium-entry", { uuid: ACTOR("mmBoar0000000000") });
    const { _id, folder, ownership, _stats, ...itemData } = data.items.find(i => i.system?.identifier === "gore");
    itemData.system.identifier = "charge-size-gore";
    const up = await ctx.call("upsert-actor-item", { actorId: tok.actorId, itemData, match: { path: "system.identifier", value: "charge-size-gore" } });
    const goreId = up.itemId ?? up.id ?? up.item?._id ?? (await ctx.itemId(wolf.id, "charge-size-gore"));
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: tok.actorId, itemId: goreId }).catch(() => {}));
    const names = itemData.flags?.babele?.originalPayload?.activities ?? {};
    const moving = Object.keys(itemData.system.activities).find(id => /moving/i.test(names[id]?.name ?? itemData.system.activities[id].name ?? ""));
    if ( !ctx.expect(!!moving, "the Gore has a \"Moving Attack\" activity") ) return;

    await ctx.startCombat([wolf, zombi, ogre]);
    const current = async () => {
      const state = await ctx.combat();
      const combat = state.combat ?? state.combats?.[0] ?? state;
      return combat.combatants?.find(c => c.id === combat.currentCombatantId)?.tokenId ?? null;
    };
    const toWolf = async () => { for ( let i = 0; (i < 4) && ((await current()) !== wolf.id); i++ ) { await ctx.nextTurn(); await sleep(800); } };
    await toWolf();
    const at = await ctx.position(wolf);

    // A free line: the target on one side of the Wolf, four free cells on the other (tokens move between runs of the bench).
    const others = (await ctx.call("list-scene-objects", { types: ["Token"] })).objects.Token.filter(t => ![wolf.id, zombi.id, ogre.id].includes(t.id));
    const occupied = (x, y, w=1) => others.some(t => (x < t.x + (t.width ?? 1) * grid) && (x + w * grid > t.x) && (y < t.y + (t.height ?? 1) * grid) && (y + w * grid > t.y));
    const dir = [[-1, 0], [1, 0], [0, -1], [0, 1]].find(([dx, dy]) => !occupied(at.x - (dx > 0 ? 2 : dx < 0 ? -1 : 0) * grid, at.y - (dy > 0 ? 2 : dy < 0 ? -1 : 0) * grid, 2)
      && [1, 2, 3, 4].every(k => !occupied(at.x + k * dx * grid, at.y + k * dy * grid))) ?? [1, 0];
    const cell = k => ({ x: at.x + k * dir[0] * grid, y: at.y + k * dir[1] * grid });
    // Adjacent spot on the far side of the run for a creature `size` cells wide (its top-left corner).
    const adjacent = size => ({ x: at.x - (dir[0] > 0 ? size : dir[0] < 0 ? -1 : 0) * grid, y: at.y - (dir[1] > 0 ? size : dir[1] < 0 ? -1 : 0) * grid });
    const park = { x: at.x + 8 * grid, y: at.y + 8 * grid };

    /** The Wolf runs four cells away, a turn passes, then it comes straight back next to `target` and gores it. */
    const chargeAt = async target => {
      await ctx.call("move-token", { tokenId: wolf.id, ...cell(4), elevation: at.elevation });
      await ctx.nextTurn(); await sleep(600); await toWolf();   // the turn's movement history starts from there
      await ctx.call("update-scene-object", { type: "Token", objectId: wolf.id, data: { x: at.x, y: at.y } });
      await sleep(1200);
      await ctx.setHp(target, 100);
      const used = await ctx.use({ tokenId: wolf.id, itemId: goreId, activityType: "attack", targetTokenIds: [target.id] });
      return ctx.settle(used.usageMessageId).catch(() => null);
    };
    const variantOf = r => String(r?.plan?.variant?.activity ?? "").split(".").pop() || null;

    // 1. Toward the Ogre (Large), the Zombie parked away.
    await ctx.call("move-token", { tokenId: zombi.id, ...park, elevation: at.elevation });
    await ctx.call("move-token", { tokenId: ogre.id, ...adjacent(2), elevation: at.elevation });
    await sleep(800);
    const large = await chargeAt(ogre);
    if ( !ctx.expect(!!large?.targets?.length, "the Gore against the Ogre is resolved") ) return;
    ctx.expect(!variantOf(large), `20 ft straight toward the Ogre (Large): no charge variant (${variantOf(large) ?? "base attack"})`);
    await ctx.removeStatusEffects(ogre, "prone");

    // 2. Same run toward the Zombie (Medium): the variant.
    await ctx.call("move-token", { tokenId: ogre.id, ...park, elevation: at.elevation });
    await ctx.call("move-token", { tokenId: zombi.id, ...adjacent(1), elevation: at.elevation });
    await ctx.nextTurn(); await sleep(600); await toWolf();
    const medium = await chargeAt(zombi);
    ctx.expect(variantOf(medium) === moving, `20 ft straight toward the Zombie (Medium): "Moving Attack" variant (${variantOf(medium)})`);
  }
};
