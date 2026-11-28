/**
 * Issue #255: after the Pseudodragon's Sting (Monster Manual 2024 or SRD 2024), once the Sting's effect is gone (damage:
 * "Sting ends … who just took damage", `mm-pseudodragon-sting`), the target must no longer be Unconscious — staying Prone is
 * correct (waking up does not lift it). Test arena: a pseudodragon placed for the scenario, hostile, in contact with the
 * Fighter; it stings until the save fails (20 tries), then the Fighter takes 1 bludgeoning damage.
 * Second case (Aiacos's comment on #255): an item effect that carries no condition and asks for "Frightened" as a rider
 * (`system.rider.statuses`), placed on the Fighter as the engine places an item effect (`placeItemEffect`): the condition is
 * carried by the effect itself, no separate "Frightened"; with the effect removed, the Fighter is no longer Frightened (§526).
 * Restored: the Fighter's effects and HP, position, placed creature.
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "Dard du pseudodragon — plus Inconscient une fois l'effet fini (#255)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Guerrier") ) { ctx.log("Guerrier absent : non applicable"); return; }
    const warrior = await ctx.token("Guerrier");
    const grid = await ctx.gridSize();
    const home = await ctx.position(warrior);
    const hp0 = await ctx.hp(warrior);
    ctx.restore(() => ctx.call("move-token", { tokenId: warrior.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
    ctx.restore(() => ctx.setHp(warrior, hp0));
    const script = async (code, args={}) => (await ctx.call("run-script", { code, args, waitMs: 15000 }))?.result;
    const clean = () => script(`const a = canvas.tokens.get(args.id)?.actor; if ( !a ) return 0;
      const ids = a.effects.filter(e => ["poisoned", "unconscious", "prone", "incapacitated"].some(s => e.statuses.has(s))).map(e => e.id);
      if ( ids.length ) await a.deleteEmbeddedDocuments("ActiveEffect", ids); return ids.length;`, { id: warrior.id });
    ctx.restore(() => clean().catch(() => {}));
    await clean();
    const effects = () => script(`return (canvas.tokens.get(args.id)?.actor?.effects ?? []).filter(e => !e.disabled && e.statuses.size)
      .map(e => ({ name: e.name, statuses: [...e.statuses], origin: e.origin ?? null }));`, { id: warrior.id });

    const cast = await ctx.cast({ "Pseudodragon (essai)": "mmPseudodragon00" }, { disposition: -1 });
    const pd = cast["Pseudodragon (essai)"];
    if ( !pd ) { ctx.log("pas de pseudodragon parmi les fiches : non applicable"); return; }
    await ctx.call("move-token", { tokenId: pd.id, x: home.x + grid, y: home.y, elevation: 0 });
    await pause(800);
    const { data: pTok } = await ctx.call("get-scene-object", { type: "Token", objectId: pd.id });
    const sting = ((await ctx.call("get-actor", { actorId: pTok.actorId })).items ?? []).find(i => /sting/i.test(i.name));
    if ( !ctx.expect(!!sting, `le pseudodragon a son Dard (${sting?.name})`) ) return;

    // Trace: each condition effect created without an origin on the GM side, with where the creation comes from.
    await script(`window.__dasTrace = []; if ( !window.__dasTraceHook ) window.__dasTraceHook = Hooks.on("preCreateActiveEffect", (e) => {
      if ( e.statuses?.size && !e.origin ) window.__dasTrace.push({ name: e.name, statuses: [...e.statuses],
        stack: new Error().stack.split("\\n").slice(2, 16).map(l => l.trim()).join(" | ").slice(0, 1500) }); }); return true;`);
    ctx.restore(() => script(`Hooks.off("preCreateActiveEffect", window.__dasTraceHook); window.__dasTraceHook = null; return true;`).catch(() => {}));

    let asleep = false;
    for ( let i = 0; (i < 20) && !asleep; i++ ) {
      await clean();
      await ctx.setHp(warrior, 200);
      const used = await ctx.use({ tokenId: pd.id, itemId: sting._id, targetTokenIds: [warrior.id] });
      await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(2500);
      asleep = (await effects()).some(e => e.statuses.includes("unconscious"));
    }
    if ( !ctx.expect(asleep, "le Guerrier s'endort (sauvegarde ratée, 20 essais au plus)") ) return;
    const during = await effects();
    ctx.log(`endormi : ${JSON.stringify(during)}`);
    ctx.log(`créations sans origine : ${JSON.stringify(await script("return window.__dasTrace;"))}`);

    await ctx.engine("hurt", { tokenId: warrior.id, amount: 1, type: "bludgeoning" });
    let after = [];
    for ( let w = 0; w < 12; w++ ) {
      await pause(500);
      after = await effects();
      if ( !after.some(e => e.statuses.includes("poisoned")) ) break;
    }
    ctx.log(`après 1 dégât : ${JSON.stringify(after)}`);
    ctx.expect(!after.some(e => e.statuses.includes("poisoned")), "l'effet du Dard prend fin sur des dégâts");
    ctx.expect(!after.some(e => e.statuses.includes("unconscious")), `le Guerrier n'est plus Inconscient (${after.map(e => e.name).join(", ") || "aucun état"})`);
    ctx.expect(after.some(e => e.statuses.includes("prone")), "il reste À terre (se réveiller ne relève pas)");

    // --- Frightened requested as a rider -----------------------------------------------------------------------------------------
    await clean();
    await script(`const a = canvas.tokens.get(args.id)?.actor; const ids = a.effects.filter(e => e.statuses.has("frightened")).map(e => e.id);
      if ( ids.length ) await a.deleteEmbeddedDocuments("ActiveEffect", ids); return true;`, { id: warrior.id });
    const FX = "dastestfrightfx1";
    const itemData = { name: "Regard effrayant (essai)", type: "feat", img: "icons/svg/terror.svg", system: { identifier: "das-test-fright" },
      effects: [{ _id: FX, name: "Frightened", img: "icons/svg/terror.svg", transfer: false, disabled: false, statuses: [],
        system: { rider: { statuses: ["frightened"] } }, changes: [] }] };
    const up = await ctx.call("upsert-actor-item", { actorId: pTok.actorId, itemData, match: { path: "system.identifier", value: "das-test-fright" } });
    const frightItem = up.itemId ?? up.id ?? up.item?._id ?? await ctx.itemId(pd.id, "das-test-fright");
    const placed = await ctx.engine("placeItemEffect", { tokenId: warrior.id, casterId: pd.id, itemId: frightItem, effectId: FX });
    await pause(1500);
    const scared = await effects();
    ctx.log(`Effrayé posé : ${JSON.stringify(scared)}`);
    ctx.expect(scared.some(e => (e.name === "Frightened") && e.origin && e.statuses.includes("frightened")), "l'effet d'item porte lui-même Effrayé");
    ctx.expect(!scared.some(e => !e.origin && e.statuses.includes("frightened")), "aucun « Effrayé » à part, sans origine");
    await script(`await canvas.tokens.get(args.id)?.actor?.effects.get(args.fx)?.delete(); return true;`, { id: warrior.id, fx: placed?.effectId ?? FX });
    await pause(1000);
    const calm = await effects();
    ctx.expect(!calm.some(e => e.statuses.includes("frightened")), `l'effet retiré, le Guerrier n'est plus Effrayé (${calm.map(e => e.name).join(", ") || "aucun état"})`);
    await script(`const a = canvas.tokens.get(args.id)?.actor; const ids = a.effects.filter(e => e.statuses.has("frightened")).map(e => e.id);
      if ( ids.length ) await a.deleteEmbeddedDocuments("ActiveEffect", ids); return true;`, { id: warrior.id });
  }
};
