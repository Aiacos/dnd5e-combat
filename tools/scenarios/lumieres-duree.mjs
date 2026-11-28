/**
 * §121: duration and fuel of carried sources, on a character who has a Lamp (world `ravenloft`: Alara; `dnd-6`: the
 * first token that carries one). The torch and the flask of oil are lent from the Player's Handbook.
 *  1. Lamp lit by its activity, consumption requested: nothing is spent by dnd5e, the effect lasts 6 h.
 *  2. An hour passes, it is put out: 5 h noted on the lamp; relit: the effect resumes at 5 h.
 *  3. Five more hours: the effect expires, the lamp is empty (0), a message says so.
 *  4. Relit: the flask of oil is taken (the last one: the item leaves), 6 h.
 *  5. Empty and without oil: refused, nothing lights.
 *  6. Torch (2) lit without an activity (inventory menu): 1 h, equipped; a candle in the other hand; the lamp, no free hand
 *     left: refused; the extinguished candle returns to the bag. An hour passes: one torch fewer, the next one extinguished,
 *     new, stowed.
 * Hands: equipped weapons and shields are stowed for the length of the scenario (a lit source is held in hand), then
 * re-equipped.
 * Restores the world time, the lamp's flags and the effects.
 */
const MODULE_ID = "dnd5e-combat";
const TORCH = "Compendium.dnd-players-handbook.equipment.Item.phbagTorch000000";
const OIL = "Compendium.dnd-players-handbook.equipment.Item.phbagOil00000000";
const CANDLE = "Compendium.dnd-players-handbook.equipment.Item.phbagCandle00000";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "lumières portées — durée, extinction, huile, torche consumée",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    let token = null, lampId = null;
    for ( const t of tokens ) {
      if ( !t.actorId ) continue;
      const id = await ctx.itemId(t.id, "lamp").catch(() => null);
      if ( id ) { token = await ctx.token(t.name); lampId = id; break; }
    }
    if ( !token ) { ctx.log("aucun token avec une Lampe : non applicable"); return; }
    const actorId = token.actorId;
    const state = itemId => ctx.engine("lightState", { actorId, itemId });
    const advance = async seconds => { await ctx.engine("advanceTime", { seconds }); await pause(2500); };
    const effects = async () => (await ctx.effects(token)).filter(e => e.flags?.[MODULE_ID]?.carriedLightOf);
    const lamp = async () => ((await ctx.call("get-actor", { actorId })).items ?? []).find(i => i._id === lampId);
    const start = (await ctx.engine("advanceTime", { seconds: 0 })).worldTime;
    ctx.restore(async () => {
      const now = (await ctx.engine("advanceTime", { seconds: 0 })).worldTime;
      await ctx.engine("advanceTime", { seconds: start - now });
      for ( const e of await effects() ) await ctx.call("remove-embedded-effect", { documentType: "Actor", id: actorId, effectId: e._id }).catch(() => null);
      await ctx.call("upsert-actor-item", { actorId, itemData: { [`flags.${MODULE_ID}.-=burnLeft`]: null, "system.uses.spent": 0 }, match: { path: "_id", value: lampId } });
    });
    // A lamp already lit by the party: we start from an extinguished, filled lamp.
    if ( (await state(lampId))?.lit ) await ctx.engine("toggleLight", { actorId, itemId: lampId, on: false });
    await ctx.call("upsert-actor-item", { actorId, itemData: { [`flags.${MODULE_ID}.-=burnLeft`]: null, "system.uses.spent": 0 }, match: { path: "_id", value: lampId } });
    const H = 3600;
    const item = async id => ((await ctx.call("get-actor", { actorId })).items ?? []).find(i => i._id === id);
    const setItem = (id, data) => ctx.call("upsert-actor-item", { actorId, itemData: data, match: { path: "_id", value: id } });
    // Free hands: weapons and shields stowed for the length of the scenario.
    const inHand = ((await ctx.call("get-actor", { actorId })).items ?? []).filter(i => i.system?.equipped
      && ((i.type === "weapon") || ((i.type === "equipment") && (i.system?.type?.value === "shield")))).map(i => i._id);
    for ( const id of inHand ) await setItem(id, { "system.equipped": false });
    ctx.restore(async () => { for ( const id of inHand ) await setItem(id, { "system.equipped": true }); });
    if ( (await item(lampId))?.system?.equipped ) await setItem(lampId, { "system.equipped": false });

    // 1. Lit by the activity.
    await ctx.use({ tokenId: token.id, itemId: lampId, consume: true });
    await pause(1500);
    let s = await state(lampId);
    ctx.expect(s?.lit && (Math.round(s.left) === 6 * H), `lampe allumée par son activité, 6 h (${s?.left})`);
    ctx.expect((await lamp())?.system?.uses?.spent === 0, "dnd5e n'a rien dépensé sur la lampe");
    ctx.expect((await lamp())?.system?.equipped === true, "allumée : la lampe est équipée");
    const fx = await effects();
    ctx.expect(fx.length === 1 && (fx[0].duration?.value === 6 * H), `un effet lumineux, durée 6 h (${fx[0]?.duration?.value})`);

    // 2. One hour, extinguished, relit.
    await advance(H);
    await ctx.use({ tokenId: token.id, itemId: lampId, consume: true });
    await pause(1500);
    s = await state(lampId);
    ctx.expect(!s?.lit && (Math.round(s.left) === 5 * H), `éteinte après 1 h : 5 h notées (${s?.left})`);
    ctx.expect(!(await effects()).length, "éteinte : plus d'effet lumineux");
    ctx.expect((await lamp())?.system?.equipped === false, "éteinte : la lampe retourne au sac");
    await ctx.use({ tokenId: token.id, itemId: lampId, consume: true });
    await pause(1500);
    s = await state(lampId);
    ctx.expect(s?.lit && (Math.round(s.left) === 5 * H), `rallumée : reprend à 5 h (${s?.left})`);

    // 3. It runs out.
    const since = await ctx.lastMessageId();
    await advance(5 * H + 60);
    s = await state(lampId);
    ctx.expect(!s?.lit && (s.left === 0), `5 h plus tard : éteinte, vide (${s?.left})`);
    ctx.expect(!(await effects()).length, "l'effet expiré est retiré");
    const msgs = await ctx.messagesSince(since);
    ctx.expect(msgs.some(m => m.flags?.[MODULE_ID]?.burnOut), "un message dit que la lampe n'a plus d'huile");

    // 4. Relit with a flask (the character's own if they have one, otherwise the lent one).
    await ctx.ensureItem(token, OIL, { system: { quantity: 1 } });
    const oils = async () => ((await ctx.call("get-actor", { actorId })).items ?? []).filter(i => (i.system?.identifier === "oil"));
    const flasks = async () => (await oils()).reduce((n, i) => n + (i.system?.quantity ?? 1), 0);
    const before = await flasks();
    await ctx.use({ tokenId: token.id, itemId: lampId, consume: true });
    await pause(1500);
    s = await state(lampId);
    ctx.expect(s?.lit && (Math.round(s.left) === 6 * H), `vide, rallumée : une flasque versée, 6 h (${s?.left})`);
    ctx.expect((await flasks()) === before - 1, `une flasque de moins (${before} → ${await flasks()})`);

    // 5. Vide et sans huile.
    await ctx.engine("toggleLight", { actorId, itemId: lampId, on: false });
    await ctx.call("upsert-actor-item", { actorId, itemData: { [`flags.${MODULE_ID}.burnLeft`]: 0 }, match: { path: "_id", value: lampId } });
    // Not a drop of oil left on the sheet (the safety net restores the quantities).
    for ( const o of await oils() ) await ctx.call("upsert-actor-item", { actorId, itemData: { "system.quantity": 0 }, match: { path: "_id", value: o._id } });
    const refused = await ctx.engine("toggleLight", { actorId, itemId: lampId, on: true });
    ctx.expect(!refused.changed && (refused.reason === "noFuel") && !(await effects()).length, `vide sans huile : refusé (${refused.reason})`);

    // 6. La torche.
    const torchId = await ctx.ensureItem(token, TORCH, { system: { quantity: 2 } });
    const lit = await ctx.engine("toggleLight", { actorId, itemId: torchId, on: true });
    ctx.expect(lit.changed && lit.lit && (Math.round(lit.left) === H), `torche allumée sans activité : 1 h (${lit.left})`);
    ctx.expect((await item(torchId))?.system?.equipped === true, "allumée : la torche est équipée");
    const candleId = await ctx.ensureItem(token, CANDLE, { system: { quantity: 1 } });
    const candle = await ctx.engine("toggleLight", { actorId, itemId: candleId, on: true });
    ctx.expect(candle.changed && candle.lit, "une bougie dans l'autre main");
    await setItem(lampId, { [`flags.${MODULE_ID}.burnLeft`]: H });
    const full = await ctx.engine("toggleLight", { actorId, itemId: lampId, on: true });
    ctx.expect(!full.changed && (full.reason === "noHand"), `torche et bougie en main : la lampe est refusée (${full.reason} : ${(full.held ?? []).join(", ")})`);
    const out = await ctx.engine("toggleLight", { actorId, itemId: candleId, on: false });
    ctx.expect(out.changed && ((await item(candleId))?.system?.equipped === false), "la bougie éteinte retourne au sac");
    await advance(H + 60);
    const torch = ((await ctx.call("get-actor", { actorId })).items ?? []).find(i => i._id === torchId);
    s = await state(torchId);
    ctx.expect(torch?.system?.quantity === 1, `une heure plus tard : une torche de moins (${torch?.system?.quantity})`);
    ctx.expect(s && !s.lit && (Math.round(s.left) === H), `la torche suivante est éteinte et neuve (${s?.left})`);
    ctx.expect(torch?.system?.equipped === false, "la torche suivante est rangée");
  }
};
