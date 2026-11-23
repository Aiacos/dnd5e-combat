/**
 * Issue #255 : après le Dard du pseudodragon (Monster Manual 2024 ou SRD 2024), une fois l'effet du Dard parti (dégâts : « Sting ends …
 * who just took damage », `mm-pseudodragon-sting`), la cible ne doit plus être Inconsciente — rester À terre est juste (se réveiller ne
 * relève pas). Arène de test : un pseudodragon posé pour le scénario, hostile, au contact du Guerrier ; il pique jusqu'à ce que la
 * sauvegarde soit ratée (20 essais), puis le Guerrier subit 1 dégât contondant.
 * Second cas (commentaire d'Aiacos sur #255) : un effet d'item qui ne porte aucun état et demande « Effrayé » en cavalier
 * (`system.rider.statuses`), posé sur le Guerrier comme le moteur pose un effet d'item (`placeItemEffect`) : l'état est porté par
 * l'effet lui-même, aucun « Effrayé » à part ; l'effet retiré, le Guerrier n'est plus Effrayé (§526).
 * Remis en état : effets et PV du Guerrier, position, créature posée.
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

    // Trace : chaque effet d'état créé sans origine chez le MJ, avec d'où vient la création.
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

    // --- Effrayé demandé en cavalier ---------------------------------------------------------------------------------------------
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
