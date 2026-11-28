/**
 * §120, world `ravenloft` (Alara's real sheet, dhampir cleric, who knows Vampiric Touch and has the Survivor feat):
 *  1. Vampiric Touch on the Zombie in contact: each attack that hits gives Alara back half (rounded down) of the
 *     necrotic damage; the recast, as long as Concentration holds, spends no slot.
 *  2. Survivor, "Hypervigilance": an Initiative roll whose d20 is 9 or less is rerolled, and the Initiative corrected by the
 *     difference of the two d20.
 * Resets HP, slots (safety net), Concentration and combat.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "Caresse du vampire (soin, relance) et Survivant (Hypervigilance) — Alara",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    // The Alara who knows the spell: "Alara" in `ravenloft`, "Alara Dhampir" in `dnd-6` (where "Alara" is the sheet of the
    // Trickery Domain, without Vampiric Touch).
    let alara = null;
    for ( const name of ["Alara Dhampir", "Alara"] ) {
      if ( !tokens.some(t => t.name === name) ) continue;
      const t = await ctx.token(name);
      if ( await ctx.itemId(t.id, "vampiric-touch").catch(() => null) ) { alara = t; break; }
    }
    if ( !alara || !tokens.some(t => t.name === "Zombi") ) { ctx.log("Alara (avec Caresse du vampire) ou le Zombi absent : non applicable"); return; }
    const zombi = await ctx.token("Zombi");
    const hpAlara = await ctx.hp(alara);
    const hpZombi = await ctx.hp(zombi);
    ctx.restore(async () => {
      await ctx.setHp(alara, hpAlara);
      await ctx.setHp(zombi, hpZombi);
      await ctx.removeEffectsNamed(alara, /concentr|Caresse|Vampiric/i);
    });
    const slots = async () => (await ctx.call("get-actor", { actorId: alara.actorId })).system?.spells?.spell3?.value ?? null;

    // 1. Caresse du vampire.
    const grid = await ctx.gridSize();
    const at = await ctx.position(alara);
    await ctx.call("move-token", { tokenId: zombi.id, x: at.x + grid, y: at.y });
    await ctx.setHp(alara, 5);
    let hits = 0;
    for ( let n = 1; (n <= 12) && !hits; n++ ) {
      // A fresh cast on each try: Concentration removed, the use is not a recast.
      await ctx.removeEffectsNamed(alara, /concentr/i);
      await pause(800);
      if ( (await ctx.hp(zombi)) < 8 ) await ctx.setHp(zombi, hpZombi);
      const before = await ctx.hp(alara);
      const used = await ctx.use({ tokenId: alara.id, identifier: "vampiric-touch", targetTokenIds: [zombi.id] });
      ctx.expect(used.used, `Caresse du vampire lancée (${n})`);
      if ( !used.used ) break;
      const r = await ctx.settle(used.usageMessageId);
      await pause(1500);
      const t = r.targets?.[0];
      const now = await ctx.hp(alara);
      if ( !t?.hit ) { ctx.expect(now === before, `attaque ${n} ratée : PV d'Alara inchangés (${now})`); continue; }
      hits++;
      const dealt = Number(t.damage?.applied ?? NaN);
      ctx.expect(now - before === Math.floor(dealt / 2), `attaque ${n} touchée, ${dealt} dégâts nécrotiques : Alara +${now - before} (moitié)`);
    }
    ctx.expect(hits > 0, "au moins une Caresse a touché");

    // The recast, Concentration ongoing: a new card, noted as a recast, with no slot spent (consumption requested).
    // At least a level 3 slot, so that a spending shows (the safety net restores those of the sheet).
    if ( !(await slots()) ) await ctx.call("update-actor", { actorId: alara.actorId, actorData: { "system.spells.spell3.value": 1 } });
    const slotsBefore = await slots();
    const since = await ctx.lastMessageId();
    const again = await ctx.use({ tokenId: alara.id, identifier: "vampiric-touch", targetTokenIds: [zombi.id], consume: true });
    let recast = null;
    for ( let w = 0; !recast && (w < 20); w++ ) {
      await pause(500);
      recast = (await ctx.messagesSince(since)).find(m => (m.type === "usage") && m.flags?.[MODULE_ID]?.recast) ?? null;
    }
    ctx.expect(!again.used && !!recast, "relancée tant que la concentration tient : carte de relance");
    ctx.expect((await slots()) === slotsBefore, `relance sans emplacement (niveau 3 : ${slotsBefore} → ${await slots()})`);
    await ctx.removeEffectsNamed(alara, /concentr/i);

    // 2. Hypervigilance.
    const combat = await ctx.startCombat([alara, zombi]);
    const cid = (combat.combatants ?? []).find(c => c.tokenId === alara.id)?.id
      ?? (await ctx.combat()).combatants?.find(c => c.tokenId === alara.id)?.id;
    // The question goes to Alara's player, otherwise to the GM: with no player owner here, it is a window on the GM's side.
    const known = async () => ((await ctx.call("list-dialogs", {})).windows ?? []).map(w => w.id);
    let kept = 0, rerolled = 0;
    for ( let n = 1; (n <= 30) && !(kept && rerolled); n++ ) {
      const since = await ctx.lastMessageId();
      const before = await known();
      await ctx.call("roll-initiative", { combatId: ctx.ownCombat, combatantIds: [cid] });
      const d = (await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: before, waitMs: 3000 }).catch(() => null))?.windows?.[0] ?? null;
      const init0 = (await ctx.combat()).combatants?.find(c => c.id === cid)?.initiative;
      if ( !d ) { ctx.log(`initiative ${n} : ${init0}, pas de question (d20 au-dessus de 9)`); continue; }
      const choose = kept ? /Relancer|Reroll/i : /Garder|Keep/i;
      const b = (d.buttons ?? []).find(x => choose.test(x.label ?? ""));
      await ctx.call("answer-dialog", { id: d.id, button: b?.action ?? b?.label });
      await pause(2500);
      const { messages } = await ctx.call("list-chat-messages", { limit: 10, ...(since ? { sinceId: since } : {}) });
      const reroll = (messages ?? []).find(m => m.flags?.[MODULE_ID]?.rerollInitiative);
      const init = (await ctx.combat()).combatants?.find(c => c.id === cid)?.initiative;
      if ( !kept ) {
        kept++;
        ctx.expect(!reroll && (init === init0), `initiative ${n} : question posée, « Garder » → pas de relance (${init})`);
        continue;
      }
      rerolled++;
      const r = reroll?.flags?.[MODULE_ID]?.rerollInitiative;
      ctx.expect(!!r && (r.old <= 9), `initiative ${n} : « Relancer » → d20 ${r?.old} relancé → ${r?.new}`);
      ctx.expect(!!r && (Math.round(init - init0) === r.new - r.old), `initiative ${n} : ${init0} → ${init}`);
    }
    ctx.expect(kept && rerolled, "les deux réponses vues (garder, relancer)");
  }
};
