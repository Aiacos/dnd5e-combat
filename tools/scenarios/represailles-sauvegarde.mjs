/**
 * §487 : moment « réussit une sauvegarde contre » (`savesAgainst`, brique B11). Un item synthétique prêté au Bandit, sa règle posée dans
 * la surcouche du monde (`api.mcp.overrideContent`) :
 *   { on: "savesAgainst", if: { "activity.isSpell": true }, do: [{ type: "use", target: "source" }] }
 *  1. le Clerc lance Fléau (sort du SRD) sur le Bandit, `autoReact: "first"` : à chaque sauvegarde RÉUSSIE, le Bandit utilise l'item
 *     contre le Clerc (carte d'utilisation du Bandit, ciblant le Clerc) ; à chaque sauvegarde RATÉE, rien ;
 *  2. on rejoue jusqu'à avoir vu une réussite et un échec (20 essais au plus).
 * Remet effets, concentration, items prêtés et surcouche.
 */
const MODULE_ID = "dnd5e-combat";
const SRD = "Compendium.dnd5e.spells24.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const IDENTIFIER = "essai-represailles-das";
const ACTIVITY = "essaiReprisal001";
const RULE = { triggers: [{ on: "savesAgainst", if: { "activity.isSpell": true }, do: [{ type: "use", target: "source" }] }] };

export default {
  name: "represailles-sauvegarde — une sauvegarde réussie contre un sort ouvre la réaction, ratée non (§487)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Clerc", "Bandit"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const clerc = await ctx.token("Clerc");
    const bandit = await ctx.token("Bandit");

    // --- Item et règle prêtés ----------------------------------------------------------------------------------------
    const itemData = { name: "Essai : représailles", type: "feat", img: "icons/svg/explosion.svg",
      system: { identifier: IDENTIFIER, activities: { [ACTIVITY]: { _id: ACTIVITY, type: "utility", name: "Représailles",
        activation: { type: "reaction", value: 1 }, target: { affects: { type: "creature", count: "1" } } } } } };
    await ctx.call("upsert-actor-item", { actorId: bandit.actorId, itemData, match: { path: "system.identifier", value: IDENTIFIER } });
    const lent = await ctx.itemId(bandit.id, IDENTIFIER);
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: bandit.actorId, itemId: lent }).catch(() => {}));
    const { before } = await ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: RULE });
    ctx.restore(() => ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: before }).catch(() => {}));
    await ctx.ensureItem(clerc, `${SRD}phbsplBane000000`, { system: { method: "atwill" } });

    const clear = async () => {
      for ( const e of await ctx.effectsFrom(bandit, "bane") ) {
        await ctx.call("remove-embedded-effect", { documentType: "Token", id: bandit.id, effectId: e.id }).catch(() => {});
      }
      await ctx.removeStatusEffects(clerc, "concentrating").catch(() => {});
    };
    ctx.restore(clear);

    // --- Fléau jusqu'à une réussite et un échec ----------------------------------------------------------------------------
    const seen = { success: null, failure: null };
    for ( let i = 0; (i < 20) && (!seen.success || !seen.failure); i++ ) {
      await clear();
      await pause(500);
      const since = await ctx.lastMessageId();
      const used = await ctx.use({ tokenId: clerc.id, identifier: "bane", activityType: "save", targetTokenIds: [bandit.id],
        usageConfig: { [MODULE_ID]: { autoReact: "first" } } });
      const r = await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      const save = r?.targets?.find(t => t.name === "Bandit")?.save;
      if ( typeof save?.success !== "boolean" ) continue;
      await pause(2500);
      const reacted = (await ctx.messagesSince(since)).filter(m => (m.type === "usage") && (m.alias === "Bandit"));
      const key = save.success ? "success" : "failure";
      if ( !seen[key] ) seen[key] = { total: save.total, reacted: reacted.length };
    }
    if ( ctx.expect(!!seen.success, "le Bandit réussit au moins une sauvegarde contre le Fléau (20 essais au plus)") ) {
      ctx.expect(seen.success.reacted === 1, `sauvegarde réussie (${seen.success.total}) : le Bandit réagit (${seen.success.reacted} carte d'utilisation)`);
    }
    if ( ctx.expect(!!seen.failure, "le Bandit rate au moins une sauvegarde contre le Fléau (20 essais au plus)") ) {
      ctx.expect(seen.failure.reacted === 0, `sauvegarde ratée (${seen.failure.total}) : pas de réaction (${seen.failure.reacted} carte)`);
    }
    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
