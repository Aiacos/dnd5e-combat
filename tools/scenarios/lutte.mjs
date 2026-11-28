/**
 * Grapple and Shove (SPEC §15.2), the Wizard in contact with the Zombi:
 *  1. at the start of the combat, the engine's unarmed strike is placed on the Wizard;
 *  2. Shove "pushed", chosen in advance (like the menu entry): no question; if the Zombi
 *     fails its save (Strength or Dexterity, its best), it moves back one cell, away from the Wizard;
 *     if it succeeds, it does not move. Replayed until a failure (8 tries at most);
 *  3. Grapple "grappled": until a failure, the Grappled condition is placed on the Zombi.
 * Restores the Zombi and the Wizard to their place, removes the condition and the items placed during the scenario.
 */
const MODULE_ID = "dnd5e-combat";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "lutte et bousculade — repoussé, agrippé, choix fait d'avance",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const size = await ctx.gridSize();

    const itemsOf = async () => (await ctx.call("get-actor", { actorId: mage.actorId })).items ?? [];
    const basics = items => items.filter(i => i.flags?.[MODULE_ID]?.basicAction);

    const move = async (token, x, y) => {
      const r = await ctx.call("move-token", { tokenId: token.id, x, y });
      if ( !r?.moved && ((r?.after?.x !== x) || (r?.after?.y !== y)) ) throw new Error(`${token.name} non déplacé en ${x},${y}`);
    };
    const posOf = async token => (await ctx.call("get-scene-object", { type: "Token", objectId: token.id })).data;
    ctx.restore(() => move(mage, mage.x, mage.y));
    ctx.restore(() => move(zombi, zombi.x, zombi.y));
    ctx.restore(() => ctx.removeStatusEffects(zombi, "grappled"));
    await move(mage, zombi.x + size, zombi.y);   // east of the Zombi: a push sends it west

    await ctx.startCombat([mage, zombi]);   // itself removes, at the end, the items the engine will have placed
    let unarmed = null;
    for ( const until = Date.now() + 6000; !unarmed && (Date.now() < until); await sleep(400) ) {
      unarmed = basics(await itemsOf()).find(i => i.flags[MODULE_ID].basicAction === "unarmed");
    }
    ctx.expect(!!unarmed, `attaque à mains nues posée sur le Magicien (${unarmed?.name ?? "absente"})`);
    if ( !unarmed ) return;

    /** Une Lutte / Bousculade, l'effet choisi d'avance. */
    async function attempt(choice) {
      const used = await ctx.use({ tokenId: mage.id, itemId: unarmed._id, activityType: "save", targetTokenIds: [zombi.id],
        usageConfig: { [MODULE_ID]: { confirmed: true, saveChoice: "best", choice } } });
      const r = await ctx.settle(used.usageMessageId);
      const t = r?.targets?.find(x => x.name === "Zombi");
      return { r, t, failed: t?.save?.success === false };
    }

    // 2. Shove: pushed.
    let pushed = false;
    for ( let i = 0; (i < 8) && !pushed; i++ ) {
      const { r, t, failed } = await attempt("dnd5eCombatPush0");
      if ( !t ) { ctx.expect(false, "résolution de la Bousculade"); return; }
      ctx.expect(r.choice === "dnd5eCombatPush0", `essai ${i + 1} : choix fait d'avance, aucune question (${r.choice})`);
      await sleep(1200);
      const pos = await posOf(zombi);
      if ( failed ) {
        ctx.expect((pos.x === zombi.x - size) && (pos.y === zombi.y),
          `Bousculade ratée (${t.save.total} contre DD ${r.plan.save.dc}, ${t.save.ability ?? "sauvegarde"}) : Zombi repoussé d'une case vers l'ouest (${zombi.x},${zombi.y} → ${pos.x},${pos.y})`);
        pushed = true;
        await move(zombi, zombi.x, zombi.y);
      } else if ( i === 0 ) {
        ctx.expect((pos.x === zombi.x) && (pos.y === zombi.y), `Bousculade réussie par le Zombi (${t.save.total}) : il ne bouge pas`);
      }
    }
    if ( !pushed ) ctx.log("le Zombi a réussi 8 sauvegardes de suite : poussée non observée");

    // 3. Grapple: grappled.
    let grappled = false;
    for ( let i = 0; (i < 8) && !grappled; i++ ) {
      const { r, t, failed } = await attempt("dnd5eCombatGrapl");
      if ( !failed ) continue;
      grappled = true;
      ctx.expect((t.effects?.length ?? 0) === 1, `Lutte ratée (${t.save.total} contre DD ${r.plan.save.dc}) : un effet posé sur le Zombi`);
      const token = await posOf(zombi);
      const statuses = [...(token.actorData?.effects ?? token.delta?.effects ?? [])].flatMap(e => e.statuses ?? []);
      const actor = token.actorLink ? await ctx.call("get-actor", { actorId: token.actorId }) : null;
      const all = [...statuses, ...(actor?.effects ?? []).flatMap(e => e.statuses ?? [])];
      ctx.expect(all.includes("grappled"), `le Zombi est Agrippé (${all.join(", ") || "aucun état lu"})`);
    }
    if ( !grappled ) ctx.log("le Zombi a réussi 8 sauvegardes de suite : Lutte non observée");
  }
};
