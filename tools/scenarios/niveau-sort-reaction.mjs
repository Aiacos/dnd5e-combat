/**
 * §481 : le fait « niveau du sort lancé » dans la porte `castsSpell`. Le Zombi reçoit un Contresort à volonté (sauvegarde de
 * Constitution du lanceur, 2024) dont l'item déclare, le temps du scénario, une réaction réservée aux sorts de niveau 1 ou moins
 * (`spell.castLevelAtMost: 1`, flag de l'item). Le Magicien lance Projectile magique :
 *  1. au niveau 1 → le Zombi réagit (carte de porte `counterspell`, sauvegarde du lanceur, l'une ou l'autre issue) ;
 *  2. au niveau 2 (emplacement choisi à l'utilisation) → aucune réaction : le niveau vient de la configuration d'utilisation, pas
 *     du niveau de base du sort.
 * Le Mage PNJ de l'arène, s'il y est, est caché le temps du scénario (son propre Contresort réagirait à tout).
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "niveau du sort lancé — réaction réservée aux sorts de niveau 1 ou moins (§481)",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));

    // Personne d'autre ne contre : le Mage PNJ caché le temps du scénario (`counterCandidates` saute les tokens cachés).
    const { tokens } = await ctx.scene();
    for ( const other of tokens.filter(t => (t.name === "Mage") && !t.hidden) ) {
      await ctx.call("update-scene-object", { type: "Token", objectId: other.id, data: { hidden: true } });
      ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: other.id, data: { hidden: false } }).catch(() => {}));
      ctx.log(`${other.name} caché le temps du scénario`);
    }

    // La réaction de niveau borné : Contresort à volonté, sa déclaration remplacée par le flag de l'item (couche la plus spécifique).
    const itemId = await ctx.ensureItem(zombi, "Compendium.dnd5e.spells24.Item.phbsplCounterspe", { system: { method: "atwill" } });
    const { data: zTok } = await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id });
    const match = { path: "_id", value: itemId };
    const triggers = [{ on: "castsSpell", if: { "target.seesSource": true, "spell.castLevelAtMost": 1 }, do: [{ type: "use", target: "source" }] }];
    await ctx.call("upsert-actor-item", { actorId: zTok.actorId, itemData: { [`flags.${MODULE_ID}.triggers`]: triggers }, match });
    ctx.restore(() => ctx.call("upsert-actor-item", { actorId: zTok.actorId, itemData: { [`flags.${MODULE_ID}.-=triggers`]: null }, match }).catch(() => {}));

    // Des emplacements de niveau 1 et 2 pour le Magicien, rendus à la fin.
    const { data: mTok } = await ctx.call("get-scene-object", { type: "Token", objectId: mage.id });
    const spells = (await ctx.call("get-actor", { actorId: mTok.actorId })).system?.spells ?? {};
    const before = {};
    for ( const k of ["spell1", "spell2"] ) {
      before[`system.spells.${k}.value`] = spells[k]?.value ?? 0;
      before[`system.spells.${k}.override`] = spells[k]?.override ?? null;
    }
    await ctx.call("update-actor", { actorId: mTok.actorId, actorData: {
      "system.spells.spell1.override": 3, "system.spells.spell1.value": 3, "system.spells.spell2.override": 3, "system.spells.spell2.value": 3 } });
    ctx.restore(() => ctx.call("update-actor", { actorId: mTok.actorId, actorData: before }).catch(() => {}));

    /** Projectile magique au niveau `level` sur le Zombi ; rend la carte de porte `counterspell` (ou null) et les cartes vues. */
    const cast = async (level, waitMs) => {
      await ctx.setHp(zombi, hp0);
      const start = await ctx.lastMessageId();
      await ctx.use({ tokenId: mage.id, identifier: "magic-missile", targetTokenIds: [zombi.id],
        usageConfig: { spell: { slot: `spell${level}` }, [MODULE_ID]: { autoReact: true } } });
      let gate = null;
      for ( const until = Date.now() + waitMs; (Date.now() < until) && !gate; ) {
        await pause(700);
        gate = (await ctx.messagesSince(start)).map(m => m.flags?.[MODULE_ID]?.gate ?? m.flags?.gate).find(g => g?.kind === "counterspell") ?? null;
      }
      await pause(3000);   // les projectiles enchaînés (ou le sort relancé après la sauvegarde) finissent de partir
      return { gate, messages: await ctx.messagesSince(start) };
    };

    // 1. Niveau 1 : la condition tient, le Zombi réagit.
    const low = await cast(1, 40000);
    ctx.expect(!!low.gate, `niveau 1 : le Zombi réagit (carte de porte ${low.gate ? (low.gate.dissipated ? "« sort dissipé »" : "« le sort passe »") : "absente"})`);
    if ( low.gate?.message ) {
      const counter = await ctx.settle(low.gate.message);
      const t = counter.targets.find(x => x.name === "Magicien");
      ctx.expect(!!t?.save, `réaction résolue par la sauvegarde du lanceur (${t?.save?.total ?? "?"} contre DD ${counter.plan?.save?.dc ?? "?"})`);
      ctx.expect(low.gate.dissipated === (t?.save?.success === false), "carte de porte cohérente avec la sauvegarde");
    }

    // 2. Niveau 2 : même sort, emplacement plus haut — la condition ne tient plus, aucune réaction, le sort part.
    const high = await cast(2, 10000);
    ctx.expect(!high.gate, "niveau 2 : aucune réaction (sort au-delà du niveau 1)");
    ctx.expect(high.messages.some(m => m.type === "usage"), `niveau 2 : le sort part (${high.messages.filter(m => m.type === "usage").length} carte(s) d'utilisation)`);
  }
};
