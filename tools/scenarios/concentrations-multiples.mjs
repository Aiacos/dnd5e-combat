/**
 * §494 (B14) — plusieurs concentrations à la fois, perdues ensemble. Arène de test, Magicien (token lié). Un trait d'essai lui est
 * prêté ; sa règle `concentration: { limit: 3, loseAll: true }` est posée dans la surcouche du monde (`overrideContent`, jamais en
 * drapeau d'item), AVANT l'item, pour que le moteur pose l'effet de limite à son arrivée (runtime/speed-grants.mjs).
 *  1. La limite préparée passe à 3 ; trois sorts à concentration tenus ensemble (Immobilisation de personne, Lueurs féeriques, Fou
 *     rire de Tasha : `concentrate`, sans lancer) ; en retirer un (le sort cesse) laisse les deux autres.
 *  2. 1 dégât (DD 10), rejoué jusqu'à avoir vu les deux issues (16 essais au plus) : réussi, les trois restent ; raté, les trois
 *     tombent ensemble (jamais une ou deux), et le journal du moteur annonce « all 3 concentrations lost ».
 *  3. Neutralisé : les trois tombent sans jet.
 *  4. Trait retiré : la limite revient à 1.
 * Concentration et états restés d'un scénario précédent retirés d'abord ; PV, sorts, trait, surcouche, états remis.
 */
const MODULE_ID = "dnd5e-combat";
const SRD = "Compendium.dnd5e.spells24.Item.";
const pause = ms => new Promise(r => setTimeout(r, ms));

const IDENTIFIER = "das-essai-concentrations";
// Nom en constante : le banc et la référence prennent le premier « name: » indenté de deux espaces pour le titre du scénario.
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

    // États et concentrations restés d'un scénario précédent : retirés d'abord (et à la fin).
    const clear = async () => {
      for ( const s of ["concentrating", "incapacitated", "unconscious", "dead", "prone", "stunned", "paralyzed"] ) {
        await ctx.removeStatusEffects(mage, s).catch(() => {});
      }
    };
    await clear();
    ctx.restore(clear);
    const hp0 = await ctx.hp(mage);
    ctx.restore(() => ctx.setHp(mage, hp0));

    // --- Règle puis trait (l'ordre compte : la limite se pose à l'arrivée de l'item) ----------------------------------
    const { before } = await ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: RULE });
    ctx.restore(() => ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: before }).catch(() => {}));
    await ctx.call("upsert-actor-item", { actorId, itemData: ITEM, match: { path: "system.identifier", value: IDENTIFIER } });
    const lent = await ctx.itemId(mage.id, IDENTIFIER);
    const removeTrait = () => ctx.call("remove-embedded-item", { documentType: "Actor", id: actorId, itemId: lent }).catch(() => {});
    ctx.restore(removeTrait);
    const ids = [];
    for ( const s of SPELLS ) ids.push(await ctx.ensureItem(mage, `${SRD}${s}`));

    /** Attend que la limite préparée vaille `want` (5 s au plus). */
    const limitIs = async want => {
      let s;
      for ( let i = 0; i < 20; i++ ) { s = await stats(); if ( s.concentration?.limit === want ) break; await pause(250); }
      return s.concentration?.limit ?? null;
    };
    const limit = await limitIs(3);
    if ( !ctx.expect(limit === 3, `le trait porte la limite de concentration à 3 (préparée : ${limit})`) ) return;

    /** Les trois sorts tenus (ce qui manque est rouvert). */
    const holdAll = async () => {
      await clear();
      await pause(300);
      for ( const itemId of ids ) await ctx.engine("concentrate", { tokenId: mage.id, itemId });
      await pause(400);
      return (await stats()).concentration?.held ?? [];
    };

    // 1. Trois à la fois ; un sort qui cesse ne fait pas tomber les autres.
    let held = await holdAll();
    if ( !ctx.expect(held.length === 3, `trois concentrations tenues ensemble (${held.length})`) ) return;
    await ctx.call("remove-embedded-effect", { documentType: "Actor", id: actorId, effectId: held[0] });
    await pause(800);
    held = (await stats()).concentration?.held ?? [];
    ctx.expect(held.length === 2, `un sort qui cesse (effet retiré) laisse les deux autres (${held.length})`);

    // 2. Jet de concentration : réussi, tout reste ; raté, tout tombe — jamais une partie.
    const max = (await stats()).hp?.max ?? hp0;
    const seen = { kept: false, lost: false, partial: [] };
    for ( let i = 0; (i < 16) && !(seen.kept && seen.lost); i++ ) {
      await ctx.setHp(mage, max);
      held = await holdAll();
      if ( held.length !== 3 ) { ctx.expect(false, `trois concentrations rouvertes avant le jet (${held.length})`); return; }
      const since = await ctx.lastMessageId();
      await ctx.engine("hurt", { tokenId: mage.id, amount: 1 });
      // La sauvegarde du moteur (carte marquée `concentrationPrompt`), puis la fin éventuelle.
      let save = null;
      for ( let w = 0; (w < 40) && !save; w++ ) {
        await pause(300);
        save = (await ctx.messagesSince(since)).find(m => m.flags?.[MODULE_ID]?.concentrationPrompt) ?? null;
      }
      if ( !ctx.expect(!!save, `essai ${i + 1} : le moteur fait le jet de concentration (DD 10)`) ) return;
      // Les fins se suivent (dnd5e les retire une à une) : on attend un état stable, tout ou rien (5 s au plus).
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

    // 3. Neutralisé : la concentration tombe sans jet — les trois.
    await ctx.setHp(mage, max);
    held = await holdAll();
    if ( ctx.expect(held.length === 3, `trois concentrations rouvertes (${held.length})`) ) {
      await ctx.call("set-status", { tokenId: mage.id, statusId: "incapacitated", active: true });
      let after = held;
      for ( let w = 0; (w < 20) && after.length; w++ ) { await pause(300); after = (await stats()).concentration?.held ?? []; }
      ctx.expect(after.length === 0, `Neutralisé : les trois tombent (${after.length} restante(s))`);
      await ctx.call("set-status", { tokenId: mage.id, statusId: "incapacitated", active: false }).catch(() => {});
    }

    // 4. Le trait parti, la limite revient à celle de la fiche.
    await clear();
    await removeTrait();
    const back = await limitIs(1);
    ctx.expect(back === 1, `trait retiré : la limite revient à 1 (${back})`);
  }
};
