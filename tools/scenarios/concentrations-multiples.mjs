/**
 * §494 (B14) — several concentrations at once, lost together. Test arena, Wizard (linked token). A test feature is lent to the
 * Wizard; its rule `concentration: { limit: 3, loseAll: true }` is placed in the world overlay (`overrideContent`, never as an
 * item flag), BEFORE the item, so that the engine places the limit effect on arrival (runtime/speed-grants.mjs).
 *  1. The prepared limit goes to 3; three Concentration spells held together (Hold Person, Faerie Fire, Tasha's Hideous
 *     Laughter: `concentrate`, without casting); removing one (the spell ends) leaves the other two.
 *  2. 1 damage (DC 10), replayed until both outcomes have been seen (16 tries at most): on a success, all three stay; on a failure,
 *     all three end together (never one or two), and the engine log announces "all 3 concentrations lost".
 *  3. Incapacitated: all three end without a roll.
 *  4. Feature removed: the limit goes back to 1.
 * Concentration and conditions left over from a previous scenario removed first; HP, spells, feature, overlay, conditions restored.
 */
const MODULE_ID = "dnd5e-combat";
const SRD = "Compendium.dnd5e.spells24.Item.";
const pause = ms => new Promise(r => setTimeout(r, ms));

const IDENTIFIER = "das-essai-concentrations";
// Name as a constant: the test bench and the reference take the first "name:" indented by two spaces as the scenario title.
const ITEM_NAME = "Essai : trois concentrations";
const ITEM = { name: ITEM_NAME, type: "feat", img: "icons/svg/aura.svg",
  system: { identifier: IDENTIFIER, type: { value: "monster" }, description: { value: "<p>Essai §494.</p>" } } };
const RULE = { concentration: { limit: 3, loseAll: true } };
const SPELLS = ["phbsplHoldPerson", "phbsplFaerieFire", "phbsplTashasHide"];

export default {
  name: "concentrations-multiples — trois concentrations tenues ensemble, toutes perdues sur un jet raté ou Neutralisé (§494, brique B14)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Magicien") ) { ctx.log("Magicien absent : non applicable"); return; }
    const mage = await ctx.token("Magicien");
    const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: mage.id });
    if ( !tok.actorLink ) { ctx.log("Magicien non lié : non applicable (le trait prêté irait à l'acteur de base)"); return; }
    const actorId = tok.actorId;
    const stats = () => ctx.engine("stats", { tokenId: mage.id });

    // Conditions and concentrations left over from a previous scenario: removed first (and at the end).
    const clear = async () => {
      for ( const s of ["concentrating", "incapacitated", "unconscious", "dead", "prone", "stunned", "paralyzed"] ) {
        await ctx.removeStatusEffects(mage, s).catch(() => {});
      }
    };
    await clear();
    ctx.restore(clear);
    const hp0 = await ctx.hp(mage);
    ctx.restore(() => ctx.setHp(mage, hp0));

    // --- Rule then feature (order matters: the limit is placed when the item arrives) ----------------------------------
    const { before } = await ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: RULE });
    ctx.restore(() => ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: before }).catch(() => {}));
    await ctx.call("upsert-actor-item", { actorId, itemData: ITEM, match: { path: "system.identifier", value: IDENTIFIER } });
    const lent = await ctx.itemId(mage.id, IDENTIFIER);
    const removeTrait = () => ctx.call("remove-embedded-item", { documentType: "Actor", id: actorId, itemId: lent }).catch(() => {});
    ctx.restore(removeTrait);
    const ids = [];
    for ( const s of SPELLS ) ids.push(await ctx.ensureItem(mage, `${SRD}${s}`));

    /** Waits until the prepared limit equals `want` (5 s at most). */
    const limitIs = async want => {
      let s;
      for ( let i = 0; i < 20; i++ ) { s = await stats(); if ( s.concentration?.limit === want ) break; await pause(250); }
      return s.concentration?.limit ?? null;
    };
    const limit = await limitIs(3);
    if ( !ctx.expect(limit === 3, `le trait porte la limite de concentration à 3 (préparée : ${limit})`) ) return;

    /** The three spells held (whatever is missing is reopened). */
    const holdAll = async () => {
      await clear();
      await pause(300);
      for ( const itemId of ids ) await ctx.engine("concentrate", { tokenId: mage.id, itemId });
      await pause(400);
      return (await stats()).concentration?.held ?? [];
    };

    // 1. Three at once; a spell that ends does not bring down the others.
    let held = await holdAll();
    if ( !ctx.expect(held.length === 3, `trois concentrations tenues ensemble (${held.length})`) ) return;
    await ctx.call("remove-embedded-effect", { documentType: "Actor", id: actorId, effectId: held[0] });
    await pause(800);
    held = (await stats()).concentration?.held ?? [];
    ctx.expect(held.length === 2, `un sort qui cesse (effet retiré) laisse les deux autres (${held.length})`);

    // 2. Concentration save: on a success, everything stays; on a failure, everything ends — never just part.
    const max = (await stats()).hp?.max ?? hp0;
    const seen = { kept: false, lost: false, partial: [] };
    for ( let i = 0; (i < 16) && !(seen.kept && seen.lost); i++ ) {
      await ctx.setHp(mage, max);
      held = await holdAll();
      if ( held.length !== 3 ) { ctx.expect(false, `trois concentrations rouvertes avant le jet (${held.length})`); return; }
      const since = await ctx.lastMessageId();
      await ctx.engine("hurt", { tokenId: mage.id, amount: 1 });
      // The engine's save (card marked `concentrationPrompt`), then the possible end.
      let save = null;
      for ( let w = 0; (w < 40) && !save; w++ ) {
        await pause(300);
        save = (await ctx.messagesSince(since)).find(m => m.flags?.[MODULE_ID]?.concentrationPrompt) ?? null;
      }
      if ( !ctx.expect(!!save, `essai ${i + 1} : le moteur fait le jet de concentration (DD 10)`) ) return;
      // The ends follow one another (dnd5e removes them one by one): we wait for a stable state, all or nothing (5 s at most).
      let after = [];
      for ( let w = 0; w < 10; w++ ) {
        await pause(500);
        after = (await stats()).concentration?.held ?? [];
        if ( [0, 3].includes(after.length) && (w >= 2) ) break;
      }
      if ( after.length === 3 ) seen.kept = true;
      else if ( after.length === 0 ) {
        if ( !seen.lost ) {
          const said = (await ctx.engineLog()).some(l => /all 3 concentrations lost/.test(l));
          ctx.expect(said, `jet raté : le moteur annonce les trois sorts perdus ensemble (journal « all 3 concentrations lost »)`);
        }
        seen.lost = true;
      }
      else seen.partial.push(after.length);
    }
    ctx.expect(seen.kept, "jet réussi : les trois concentrations restent");
    ctx.expect(seen.lost, "jet raté : les trois concentrations tombent ensemble");
    ctx.expect(!seen.partial.length, `jamais une partie seulement (${seen.partial.length ? seen.partial.join(", ") : "aucune"})`);

    // 3. Incapacitated: concentration ends without a roll — all three.
    await ctx.setHp(mage, max);
    held = await holdAll();
    if ( ctx.expect(held.length === 3, `trois concentrations rouvertes (${held.length})`) ) {
      await ctx.call("set-status", { tokenId: mage.id, statusId: "incapacitated", active: true });
      let after = held;
      for ( let w = 0; (w < 20) && after.length; w++ ) { await pause(300); after = (await stats()).concentration?.held ?? []; }
      ctx.expect(after.length === 0, `Neutralisé : les trois tombent (${after.length} restante(s))`);
      await ctx.call("set-status", { tokenId: mage.id, statusId: "incapacitated", active: false }).catch(() => {});
    }

    // 4. With the feature gone, the limit goes back to the sheet's.
    await clear();
    await removeTrait();
    const back = await limitIs(1);
    ctx.expect(back === 1, `trait retiré : la limite revient à 1 (${back})`);
  }
};
