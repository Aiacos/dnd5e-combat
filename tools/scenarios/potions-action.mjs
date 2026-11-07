/**
 * Issue #31 : règle maison des potions de soins (réglage `potionHealing`). Potion de guérison du Manuel des joueurs (2d4 + 2, action Bonus)
 * et du Guide du maître (portée « personnelle »), prêtées au Guerrier.
 *  1. Réglage actif, en combat, au tour du Guerrier : bue par une action → 10 PV, l'action dépensée, l'action Bonus libre.
 *  2. Même tour : bue par l'action Bonus → 4 à 10 PV, l'action Bonus dépensée.
 *  3. Hors combat, sans choix : soin maximal d'office (10 PV).
 *  4. Hors combat, « Faire boire » au Clerc la potion du Guide (« personnelle ») : le Clerc regagne 10 PV, le Guerrier rien.
 *  5. Réglage coupé, hors combat : la règle 2024 (4 à 10 PV, jamais forcément 10).
 * Remet le réglage, les PV, la position du Clerc (filet de sécurité) ; retire les potions prêtées.
 */
import { RESTORED_KEEP } from "../lib/stages.mjs";

const PHB = "Compendium.dnd-players-handbook.equipment.Item.phbagPotionofHea";
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.dmgPotionOfHeali";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "potions de soins : action Bonus (jet) ou action (soin maximal) — issue #31",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( ["Guerrier", "Clerc"].some(n => !tokens.some(t => t.name === n)) ) { ctx.log("Guerrier et Clerc requis : non applicable"); return; }
    const packs = JSON.stringify(await ctx.call("list-compendiums", {}).catch(() => null) ?? "");
    if ( !packs.includes("dnd-players-handbook.equipment") ) { ctx.log("Manuel des joueurs absent : non applicable"); return; }
    await ctx.stage(RESTORED_KEEP);
    const guerrier = await ctx.token("Guerrier");
    const clerc = await ctx.token("Clerc");
    const before = { g: await ctx.hp(guerrier), c: await ctx.hp(clerc) };
    const actorOf = async t => (await ctx.call("get-scene-object", { type: "Token", objectId: t.id })).data.actorId;
    const gActor = await actorOf(guerrier);
    const potions = new Set();
    const rule = await ctx.engine("setting", { key: "potionHealing", value: true });
    ctx.restore(async () => {
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      await ctx.engine("setting", { key: "potionHealing", value: rule.before });
      if ( before.g !== null ) await ctx.setHp(guerrier, before.g);
      if ( before.c !== null ) await ctx.setHp(clerc, before.c);
      for ( const id of potions ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: gActor, itemId: id }).catch(() => {});
    });

    const fresh = async (uuid, name) => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      itemData.name = name;
      const r = await ctx.call("upsert-embedded-item", { documentType: "Actor", id: gActor, itemData, match: { path: "name", value: name } });
      potions.add(r.itemId);
      return r.itemId;
    };
    /** Boire (ou faire boire) : le choix passé comme la Combat UI le passe ; le jet de soin par la carte (use-activity coupe l'enchaînement). */
    const drink = async (itemId, targets, ours={}) => {
      const used = await ctx.use({ tokenId: guerrier.id, itemId, activityType: "heal", targetTokenIds: targets.map(t => t.id), consume: true,
        usageConfig: { "dnd5e-combat": ours } });
      await pause(1000);
      await ctx.engine("rollCard", { messageId: used.usageMessageId });
      await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      return used;
    };
    const rolled = d => (d >= 4) && (d <= 10);

    // 1-2. En combat, au tour du Guerrier.
    await ctx.setHp(guerrier, 1);
    await ctx.startCombat([guerrier, clerc]);
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    const combat = await state();
    for ( const [t, v] of [[guerrier, 20], [clerc, 10]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
    for ( let i = 0; (i < 3) && ((await current()) !== guerrier.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
    if ( ctx.expect((await current()) === guerrier.id, "combat : au tour du Guerrier") ) {
      const opts = await ctx.engine("potionOptions", { tokenId: guerrier.id, itemId: await fresh(PHB, "Potion de guérison (scénario)") }).catch(() => null);
      ctx.expect(opts?.ask === true && opts?.max === 10, `l'interface propose le choix : ${JSON.stringify(opts)}`);
      let hp0 = await ctx.hp(guerrier);
      await drink([...potions].at(-1), [guerrier], { potionMode: "action" });
      let hp1 = await ctx.hp(guerrier);
      let budget = await ctx.engine("budget", { tokenId: guerrier.id });
      ctx.expect((hp1 - hp0) === 10, `par une action : ${hp1 - hp0} PV (attendu 10) — ${hp0} → ${hp1}`);
      ctx.expect((budget?.action === 0) && (budget?.bonus === 1), `l'action dépensée, l'action Bonus libre (${JSON.stringify(budget)})`);

      await ctx.setHp(guerrier, 1);
      hp0 = await ctx.hp(guerrier);
      await drink(await fresh(PHB, "Potion de guérison (scénario)"), [guerrier], { potionMode: "bonus" });
      hp1 = await ctx.hp(guerrier);
      budget = await ctx.engine("budget", { tokenId: guerrier.id });
      ctx.expect(rolled(hp1 - hp0), `par l'action Bonus : ${hp1 - hp0} PV (2d4 + 2)`);
      ctx.expect(budget?.bonus === 0, `l'action Bonus dépensée (${JSON.stringify(budget)})`);
    }
    await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
    ctx.ownCombat = null;
    await pause(1500);

    // 3. Hors combat, sans choix : soin maximal.
    await ctx.setHp(guerrier, 1);
    {
      const hp0 = await ctx.hp(guerrier);
      await drink(await fresh(PHB, "Potion de guérison (scénario)"), [guerrier]);
      const hp1 = await ctx.hp(guerrier);
      ctx.expect((hp1 - hp0) === 10, `hors combat : ${hp1 - hp0} PV (attendu 10, maximum d'office)`);
    }

    // 4. Faire boire au Clerc la potion du Guide (« personnelle »).
    if ( packs.includes("dnd-dungeon-masters-guide.equipment") ) {
      const spot = await ctx.position(guerrier);
      const grid = await ctx.gridSize();
      await ctx.call("move-token", { tokenId: clerc.id, x: spot.x + grid, y: spot.y, elevation: spot.elevation ?? 0 });
      await ctx.setHp(clerc, 1);
      await pause(1500);
      const g0 = await ctx.hp(guerrier), c0 = await ctx.hp(clerc);
      await drink(await fresh(DMG, "Potion de guérison (Guide, scénario)"), [clerc], { administer: true });
      const g1 = await ctx.hp(guerrier), c1 = await ctx.hp(clerc);
      ctx.expect(((c1 - c0) === 10) && (g1 === g0), `faire boire au Clerc : lui +${c1 - c0} (attendu 10), le Guerrier ${g1 - g0}`);
    } else ctx.log("Guide du maître absent : partie 4 non applicable");

    // 5. Réglage coupé : la règle 2024.
    await ctx.engine("setting", { key: "potionHealing", value: false });
    let tens = 0;
    for ( let i = 0; i < 3; i++ ) {
      await ctx.setHp(guerrier, 1);
      const hp0 = await ctx.hp(guerrier);
      await drink(await fresh(PHB, "Potion de guérison (scénario)"), [guerrier]);
      const d = (await ctx.hp(guerrier)) - hp0;
      ctx.expect(rolled(d), `réglage coupé : ${d} PV lancés`);
      if ( d === 10 ) tens++;
    }
    ctx.expect(tens < 3, "réglage coupé : le soin n'est pas toujours maximal");
  }
};
