/**
 * La couche texte des capacités de PNJ (§322, `core/monster-text.mjs`), deux lectures du 2026-11-23 (§521), sur un vrai PNJ de l'Arène
 * de test (le Bandit) qui reçoit des traits d'essai — textes synthétiques, réduits aux tournures lues :
 *  - DF #250, Sensibilité au soleil : « While in sunlight, … has Disadvantage on ability checks and attack rolls » → au soleil, ses tests
 *    de caractéristique ont le Désavantage (`rollDisadvantage`), plus seulement ses attaques. Une phrase qui ne nomme que les jets
 *    d'attaque n'en donne pas. L'arène est en plein jour (`stealth` → lumière 2).
 *  - DF #251, durée en tours d'un effet sans état : « the target's Speed is halved until the end of its next turn » → l'entrée effective
 *    de l'item (`api.content.of`) donne à son unique effet sans état la fin « bearerTurnEnd » ; sans cette phrase, rien.
 * Remis en état : traits retirés.
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
    /** Pose (ou remplace) un trait d'essai sur le Bandit ; rend son id. */
    const trait = async (identifier, itemData) => {
      const r = await ctx.call("upsert-actor-item", { actorId: bTok.actorId, itemData: { type: "feat", img: "icons/svg/aura.svg", ...itemData,
        system: { identifier, type: { value: "monster" }, ...(itemData.system ?? {}) } }, match: { path: "system.identifier", value: identifier } });
      const id = r.itemId ?? r.id ?? r.item?._id ?? await ctx.itemId(bandit.id, identifier);
      return id;
    };
    const drop = id => ctx.call("remove-embedded-item", { documentType: "Actor", id: bTok.actorId, itemId: id }).catch(() => {});

    // --- Sensibilité au soleil -------------------------------------------------------------------------------------------------
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

    // --- Durée d'un effet sans état -----------------------------------------------------------------------------------------------
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
