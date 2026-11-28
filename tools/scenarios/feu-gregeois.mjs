/**
 * Alchemist's Fire and the Burning condition (SPEC §49). Item lent from the Player's Handbook compendium.
 *  1. The Wizard throws a vial at the Zombie until a failed save: the "Burning." effect (HL12olRyPOCmmMQ5) is applied.
 *  2. At the start of the Zombie's turn: 1d4 fire damage (between 1 and 4 HP lost, Resistances included if it has any).
 *  3. The Zombie puts out the fire with an action ("Escape": effect ended by the bearer): the effect ends, it is Prone.
 * Restores HP, effects, Prone condition; removes the lent item.
 */
import { RESTORED_KEEP } from "../lib/stages.mjs";

const FIRE = "Compendium.dnd-players-handbook.equipment.Item.phbagAlchemistsF";
const BURNING = "HL12olRyPOCmmMQ5";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "feu grégeois — En feu, dégâts au début du tour, s'éteindre à terre",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( ["Magicien", "Zombi"].some(n => !tokens.some(t => t.name === n)) ) { ctx.log("Magicien et Zombi requis : non applicable"); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes("dnd-players-handbook.equipment") ) { ctx.log("Manuel des joueurs absent : non applicable"); return; }
    await ctx.stage(RESTORED_KEEP);
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const hpBefore = await ctx.hp(zombi);

    const baseline = new Set((await ctx.effects(zombi)).map(e => e._id ?? e.id));
    const burning = async () => (await ctx.effects(zombi)).filter(e => !baseline.has(e._id ?? e.id)
      && String(e._stats?.duplicateSource ?? e._stats?.compendiumSource ?? "").endsWith(`.ActiveEffect.${BURNING}`));
    const clear = async () => {
      for ( const e of await burning() ) await ctx.call("remove-embedded-effect", { documentType: "Token", id: zombi.id, effectId: e._id ?? e.id }).catch(() => {});
    };
    ctx.restore(async () => {
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      await clear();
      await ctx.removeStatusEffects(zombi, "prone");
      await ctx.call("set-status", { tokenId: zombi.id, status: "prone", active: false }).catch(() => {});
      if ( hpBefore !== null ) await ctx.setHp(zombi, hpBefore);
    });

    const fire = await ctx.ensureItem(mage, FIRE);
    // Combat: the Wizard first, the Zombie next (its turn start follows).
    await ctx.startCombat([mage, zombi]);
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    const combat = await state();
    for ( const [t, v] of [[mage, 20], [zombi, 10]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
    for ( let i = 0; (i < 3) && ((await current()) !== mage.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
    if ( !ctx.expect((await current()) === mage.id, "combat : au tour du Magicien") ) return;

    // 1. The vial, until a failed save.
    let lit = false;
    for ( let i = 0; (i < 20) && !lit; i++ ) {
      await clear();
      if ( hpBefore !== null ) await ctx.setHp(zombi, hpBefore);
      await pause(500);
      const used = await ctx.use({ tokenId: mage.id, itemId: fire, activityType: "save", targetTokenIds: [zombi.id] });
      const r = await ctx.settle(used.usageMessageId, { timeoutMs: 45000 });
      const save = r.targets.find(t => t.name === "Zombi")?.save;
      await pause(1500);
      if ( save?.success === false ) lit = (await burning()).length > 0;
      else if ( save?.success ) ctx.expect(!(await burning()).length, `sauvegarde réussie (${save.total}) : pas en feu`);
    }
    if ( !ctx.expect(lit, "sauvegarde ratée : le Zombi est en feu (20 essais au plus)") ) return;

    // 2. Start of the Zombie's turn: 1d4 fire.
    const hpLit = await ctx.hp(zombi);
    await ctx.nextTurn();
    await pause(4000);
    ctx.expect((await current()) === zombi.id, "au tour du Zombi");
    const hpTurn = await ctx.hp(zombi);
    const lost = (hpLit ?? 0) - (hpTurn ?? 0);
    ctx.expect((lost >= 1) && (lost <= 4), `début de tour : ${lost} PV de feu (1d4) — ${hpLit} → ${hpTurn}`);
    ctx.expect((await burning()).length > 0, "le feu continue tant qu'il n'est pas éteint");

    // 3. It puts itself out with an action: the effect ends, it is Prone.
    // §212: Alchemist's Fire follows the general "Burning" rule — "Put Out the Flames" (token menu), no longer "Escape".
    const offered = await ctx.engine("burning", { tokenId: zombi.id });
    ctx.expect(offered.burning, "le Zombi est en feu au sens de la règle générale (il peut éteindre le feu)");
    await ctx.engine("burning", { tokenId: zombi.id, extinguish: true });
    await pause(2500);
    ctx.expect(!(await burning()).length, "éteint : l'effet tombe");
    const prone = (await ctx.effects(zombi)).some(e => (e.statuses ?? []).includes("prone"));
    ctx.expect(prone, "éteint en se roulant par terre : À terre");
    ctx.expect((await ctx.engine("budget", { tokenId: zombi.id }))?.action === 0, "l'action du Zombi est dépensée");
  }
};
