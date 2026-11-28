/**
 * The NPC ability text layer (§322, `core/monster-text.mjs`), two readings of 2026-11-23 (§521), on a real NPC of the test Arena
 * (the Bandit) who receives test traits — synthetic texts, reduced to the phrasings read:
 *  - DF #250, Sunlight Sensitivity: "While in sunlight, … has Disadvantage on ability checks and attack rolls" → in sunlight, its
 *    ability checks have Disadvantage (`rollDisadvantage`), not only its attacks. A sentence that names only attack rolls does not
 *    give it. The arena is in full daylight (`stealth` → light 2).
 *  - DF #251, duration in turns of an effect without a condition: "the target's Speed is halved until the end of its next turn" →
 *    the item's effective entry (`api.content.of`) gives its only effect without a condition the end "bearerTurnEnd";
 *    without that sentence, nothing.
 * Reset: traits removed.
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const EFFECT = "dastestslowfx001";
const ACTIVITY = "dastestslowact01";

export default {
  name: "couche texte des PNJ — Sensibilité au soleil aux tests, durée d'un effet sans état (#250, #251)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Bandit") ) { ctx.log("Bandit absent : non applicable"); return; }
    const bandit = await ctx.token("Bandit");
    const { data: bTok } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    const script = async (code, args={}) => (await ctx.call("run-script", { code, args, waitMs: 15000 }))?.result;
    /** Places (or replaces) a test trait on the Bandit; returns its id. */
    const trait = async (identifier, itemData) => {
      const r = await ctx.call("upsert-actor-item", { actorId: bTok.actorId, itemData: { type: "feat", img: "icons/svg/aura.svg", ...itemData,
        system: { identifier, type: { value: "monster" }, ...(itemData.system ?? {}) } }, match: { path: "system.identifier", value: identifier } });
      const id = r.itemId ?? r.id ?? r.item?._id ?? await ctx.itemId(bandit.id, identifier);
      return id;
    };
    const drop = id => ctx.call("remove-embedded-item", { documentType: "Actor", id: bTok.actorId, itemId: id }).catch(() => {});

    // --- Sunlight Sensitivity ---------------------------------------------------------------------------------------------
    const light = (await ctx.engine("stealth", { tokenId: bandit.id }))?.light;
    ctx.log(`lumière sur le Bandit : ${light}`);
    if ( light === 2 ) {
      const plain = await ctx.engine("rollCheck", { tokenId: bandit.id, skill: "ath" });
      ctx.expect(!/kl|dis/.test(plain?.formula ?? ""), `témoin : test d'Athlétisme sans Désavantage (« ${plain?.formula} »)`);
      const sun = await trait("das-test-sunlight", { name: "Sunlight Sensitivity (essai)",
        system: { description: { value: "<p>While in sunlight, the bandit has Disadvantage on ability checks and attack rolls.</p>" } } });
      ctx.restore(() => drop(sun));
      await pause(800);
      const both = await ctx.engine("rollCheck", { tokenId: bandit.id, skill: "ath" });
      ctx.expect(/kl|dis/.test(both?.formula ?? ""), `« ability checks and attack rolls », au soleil : test avec Désavantage (« ${both?.formula} »)`);
      const save = await ctx.engine("rollSave", { tokenId: bandit.id, ability: "dex" });
      ctx.expect(!/kl|dis/.test(save?.formula ?? ""), `… mais pas la sauvegarde (« ${save?.formula} »)`);
      await trait("das-test-sunlight", { name: "Sunlight Sensitivity (essai)",
        system: { description: { value: "<p>While in sunlight, the bandit has Disadvantage on attack rolls.</p>" } } });
      await pause(800);
      const attacksOnly = await ctx.engine("rollCheck", { tokenId: bandit.id, skill: "ath" });
      ctx.expect(!/kl|dis/.test(attacksOnly?.formula ?? ""), `« attack rolls » seulement : test sans Désavantage (« ${attacksOnly?.formula} »)`);
      await drop(sun);
    }
    else ctx.log("l'arène n'est pas en plein jour : partie soleil non applicable");

    // --- Duration of an effect without a condition -----------------------------------------------------------------------------
    const slowData = html => ({ name: "Slowing Blast (essai)",
      system: { description: { value: html }, activities: { [ACTIVITY]: { _id: ACTIVITY, type: "save", name: "",
        activation: { type: "action" }, save: { ability: ["con"], dc: { calculation: "", formula: "12" } }, effects: [{ _id: EFFECT }] } } },
      effects: [{ _id: EFFECT, name: "Ralenti (essai)", img: "icons/svg/downgrade.svg", transfer: false, disabled: false, statuses: [],
        changes: [{ key: "system.attributes.movement.walk", mode: 1, value: "0.5" }] }] });
    const ends = id => script(`
      const item = canvas.tokens.get(args.token)?.actor?.items.get(args.id);
      const of = item ? game.modules.get("dnd5e-combat").api.content.of(item) : null;
      return { found: !!item, effectEnds: of?.entry?.effectEnds ?? null };`, { token: bandit.id, id });
    const slow = await trait("das-test-slowing", slowData("<p>Failure: 10 Fire damage, and the target's Speed is halved until the end of its next turn.</p>"));
    ctx.restore(() => drop(slow));
    await pause(800);
    const timed = await ends(slow);
    ctx.log(`avec la durée : ${JSON.stringify(timed)}`);
    ctx.expect(timed?.effectEnds?.[EFFECT] === "bearerTurnEnd",
      `« the target's Speed is halved until the end of its next turn » : l'effet finit à la fin du tour du porteur (${JSON.stringify(timed?.effectEnds)})`);
    await drop(slow);
    const bare = await trait("das-test-slowing", slowData("<p>Failure: 10 Fire damage, and the target's Speed is halved.</p>"));
    await pause(800);
    const none = await ends(bare);
    ctx.log(`sans durée : ${JSON.stringify(none)}`);
    ctx.expect(none?.found && !none.effectEnds?.[EFFECT], `sans durée dans le texte : aucune fin lue (${JSON.stringify(none?.effectEnds)})`);
    await drop(bare);
  }
};
