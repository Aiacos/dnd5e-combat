/**
 * §495 (B15) — condition ladder on repeated saves, ending on magical healing. Test arena: Wizard (linked token), Cleric, Bandit
 * (Humanoid: the Zombie is immune to Poisoned, the application spared it — pass of the 2026-11-20 test bench).
 * A test trait is lent to the Wizard: a save activity (Con) that applies "Essai : empoisonné" (Poisoned), and a second effect
 * "Essai : ralenti" (stage 1). Its rule is placed in the world overlay (`overrideContent`, never as an item flag):
 *   triggers: [{ on: "endOfTurn", via: "effect", fromEffect: <poisoned>,
 *     do: [{ type: "resave", stages: [{ effect: <slowed> }, { status: "paralyzed" }], critEnds: true }] }],
 *   endsWhen: { healedByMagic: true }
 *  1. DC 30: the Bandit fails the application, then each end-of-turn save — stage 1 ("Essai : ralenti" applied, dependent on
 *     the effect), stage 2 (the slow removed, Paralyzed added to the effect), then it stays at stage 2. A natural 20 ends the
 *     effect (`critEnds`): seen in the log, the poison is reapplied and the climb resumes.
 *  2. DC 1: a success steps back down to stage 1 (Paralyzed removed, slow reapplied).
 *  3. Healing Word from the Cleric on the Bandit (magical healing): the effect ends, the slow with it (dnd5e, `dependentOn`).
 * Test conditions and effects left on the Bandit (synthetic actor, unlinked token) removed first; HP, trait, spell, overlay, combat
 * restored. Any "do it anyway" window opened on the GM's side is accepted ("go"), any other closed.
 */
const MODULE_ID = "dnd5e-combat";
const SRD = "Compendium.dnd5e.spells24.Item.";
const pause = ms => new Promise(r => setTimeout(r, ms));

const IDENTIFIER = "das-essai-echelle";
const ACTIVITY = "dasEssaiEchelle0";
const BASE = "dasEssaiEchPoiso";
const SLOW = "dasEssaiEchRalen";
// Name as a constant: the bench and the reference take the first "name:" indented by two spaces as the scenario title.
const ITEM_NAME = "Essai : poison d'échelle";
const item = dc => ({ name: ITEM_NAME, type: "feat", img: "icons/svg/poison.svg",
  system: { identifier: IDENTIFIER, type: { value: "monster" }, description: { value: "<p>Essai §495.</p>" },
    activities: { [ACTIVITY]: { _id: ACTIVITY, type: "save", activation: { type: "action", value: 1 },
      range: { units: "any", override: true }, target: { affects: { type: "creature", count: "1" } },
      save: { ability: ["con"], dc: { calculation: "", formula: String(dc) } }, effects: [{ _id: BASE }] } } },
  effects: [
    { _id: BASE, name: "Essai : empoisonné", img: "icons/svg/poison.svg", statuses: ["poisoned"], duration: { seconds: 600 }, transfer: false },
    { _id: SLOW, name: "Essai : ralenti", img: "icons/svg/downgrade.svg", duration: { seconds: 600 }, transfer: false }
  ] });

export default {
  name: "echelle-etats — poison qui empire à chaque échec (ralenti, puis paralysé), recule sur une réussite, guéri par la magie (§495, brique B15)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Magicien", "Clerc", "Bandit"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const mage = await ctx.token("Magicien");
    const clerc = await ctx.token("Clerc");
    const bandit = await ctx.token("Bandit");
    // The target must be able to be Poisoned and Paralyzed (condition immunities of its base sheet).
    const { data: target } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    const immune = (await ctx.call("get-actor", { actorId: target.actorId }))?.system?.traits?.ci?.value ?? [];
    const blocked = ["poisoned", "paralyzed"].filter(s => immune.includes(s));
    if ( blocked.length ) { ctx.log(`Bandit immunisé à ${blocked.join(", ")} : non applicable`); return; }
    const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: mage.id });
    if ( !tok.actorLink ) { ctx.log("Magicien non lié : non applicable (le trait prêté irait à l'acteur de base)"); return; }
    const actorId = tok.actorId;

    // --- GM windows: none is left unanswered --------------------------------------------------------------
    const seen = new Set(((await ctx.call("list-dialogs", {})).windows ?? []).map(w => w.id));
    const sweep = async (ms=1500) => {
      const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: [...seen], waitMs: ms, details: true }).catch(() => null);
      for ( const w of r?.windows ?? [] ) {
        seen.add(w.id);
        const go = (w.buttons ?? []).find(b => b.action === "go");
        const button = go ? "go" : ((w.buttons ?? []).find(b => ["cancel", "no", "none"].includes(b.action))?.action ?? null);
        ctx.log(`fenêtre « ${w.title} » : ${button ?? "fermée"}`);
        await ctx.call("answer-dialog", { id: w.id, ...(button ? { button } : {}) }).catch(() => {});
      }
    };

    // --- Clean Bandit (synthetic actor) ------------------------------------------------------------------------
    const clearBandit = async () => {
      await ctx.removeEffectsNamed(bandit, /^Essai :/);
      for ( const s of ["poisoned", "paralyzed", "incapacitated", "prone", "unconscious", "dead"] ) await ctx.removeStatusEffects(bandit, s).catch(() => {});
    };
    await clearBandit();
    ctx.restore(clearBandit);
    const hp0 = await ctx.hp(bandit);
    ctx.restore(() => ctx.setHp(bandit, hp0));

    // --- Lent trait, then rule -----------------------------------------------------------------------------------
    const match = { path: "system.identifier", value: IDENTIFIER };
    await ctx.call("upsert-actor-item", { actorId, itemData: item(30), match });
    // Only the DC changes next (merge on the item in place: its uuid, origin of the carried effect, does not move).
    const lend = dc => ctx.call("upsert-actor-item", { actorId, match,
      itemData: { system: { activities: { [ACTIVITY]: { save: { dc: { calculation: "", formula: String(dc) } } } } } } });
    const lent = await ctx.itemId(mage.id, IDENTIFIER);
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: actorId, itemId: lent }).catch(() => {}));
    const sheet = ((await ctx.call("get-actor", { actorId })).items ?? []).find(i => i._id === lent);
    const effectIds = (sheet?.effects ?? []).map(e => e._id);
    if ( !ctx.expect(effectIds.includes(BASE) && effectIds.includes(SLOW), `le trait garde les ids de ses deux effets (${effectIds.join(", ")})`) ) return;
    const RULE = { triggers: [{ on: "endOfTurn", via: "effect", fromEffect: BASE,
      do: [{ type: "resave", stages: [{ effect: SLOW }, { status: "paralyzed" }], critEnds: true }] }], endsWhen: { healedByMagic: true } };
    const { before } = await ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: RULE });
    ctx.restore(() => ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: before }).catch(() => {}));
    const healingWord = await ctx.ensureItem(clerc, `${SRD}phbsplHealingWor`, { system: { method: "atwill" } });

    // --- Ce que porte le Bandit --------------------------------------------------------------------------------------------
    const ours = async () => (await ctx.effects(bandit)).filter(e => /^Essai :/.test(e.name ?? ""));
    const look = async () => {
      const all = await ours();
      const base = all.find(e => e.name === "Essai : empoisonné") ?? null;
      const slow = all.find(e => e.name === "Essai : ralenti") ?? null;
      return { base, slow, level: base?.flags?.[MODULE_ID]?.stage?.level ?? 0, statuses: base?.statuses ?? [],
        dependent: String(slow?.flags?.dnd5e?.dependentOn ?? "") };
    };

    // --- Combat : Magicien (20), Bandit (10) ----------------------------------------------------------------------------------
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    await ctx.startCombat([mage, bandit]);
    const combat = await state();
    for ( const [t, v] of [[mage, 20], [bandit, 10]] ) {
      await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
    }
    for ( let i = 0; (i < 3) && ((await current()) !== mage.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
    if ( !ctx.expect((await current()) === mage.id, "combat : au tour du Magicien") ) return;

    /** The poison applied (DC 30: the save always fails, except a natural 20 which does not count here). 5 tries. */
    const poison = async () => {
      for ( let i = 0; (i < 5) && !(await look()).base; i++ ) {
        const used = await ctx.use({ tokenId: mage.id, itemId: lent, activityType: "save", targetTokenIds: [bandit.id], consume: false });
        await sweep();
        await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        await pause(1500);
      }
      return (await look()).base;
    };
    /** The Bandit plays and ends its turn (on the Wizard's turn before and after): returns the replayed save and the log after. */
    const banditTurn = async () => {
      const since = await ctx.lastMessageId();
      await ctx.nextTurn(); await pause(2000); await sweep(500);
      await ctx.nextTurn(); await pause(2500); await sweep(500);
      let card = null;
      for ( const stop = Date.now() + 15000; !card && (Date.now() < stop); await pause(500) ) {
        card = (await ctx.messagesSince(since)).filter(m => (m.type === "usage") && m.flags?.[MODULE_ID]?.resave).at(-1) ?? null;
      }
      if ( !card ) return null;
      ctx.expect(!!card.flags[MODULE_ID].resave.stages, "la carte de sauvegarde répétée porte l'échelle (`resave.stages`)");
      const r = await ctx.settle(card.id, { timeoutMs: 45000 }).catch(() => null);
      await pause(2000);
      const save = r?.targets?.find(t => t.name === "Bandit")?.save ?? null;
      const log = await ctx.engineLog();
      const nat20 = log.some(l => /stages: .* rolls a natural 20/.test(l)) && !(await look()).base;
      return { save, nat20 };
    };

    // 1. Climb: DC 30.
    if ( !ctx.expect(!!(await poison()), "le Bandit rate la pose : « Essai : empoisonné » (Empoisonné)") ) return;
    let s = await look();
    ctx.expect(s.statuses.includes("poisoned") && (s.level === 0) && !s.slow, `palier 0 : Empoisonné, pas de ralenti (palier ${s.level})`);
    const climbed = { one: false, two: false, same: false };
    for ( let turn = 0; (turn < 8) && !climbed.same; turn++ ) {
      const prior = s.level;
      const res = await banditTurn();
      if ( !ctx.expect(!!res?.save, `tour ${turn + 1} : le Bandit rejoue sa sauvegarde en fin de tour`) ) return;
      s = await look();
      if ( res.nat20 ) {
        ctx.log(`20 naturel au palier ${prior} : l'effet tombe (critEnds) — le poison est reposé`);
        ctx.expect(!s.base && !s.slow, "20 naturel : l'effet et son ralenti tombent");
        if ( !ctx.expect(!!(await poison()), "le poison reposé") ) return;
        s = await look();
        continue;
      }
      if ( !ctx.expect(res.save.success === false, `DD 30 : sauvegarde ratée (${res.save.total})`) ) return;
      if ( prior === 0 ) {
        climbed.one = true;
        ctx.expect((s.level === 1) && !!s.slow && !s.statuses.includes("paralyzed"), `échec : palier 1, « Essai : ralenti » posé (palier ${s.level}, ralenti ${s.slow ? "oui" : "non"})`);
        ctx.expect(s.base && s.dependent.endsWith(s.base._id ?? s.base.id), `le ralenti dépend de l'effet (dependentOn ${s.dependent || "absent"})`);
      }
      else if ( prior === 1 ) {
        climbed.two = true;
        ctx.expect((s.level === 2) && !s.slow && s.statuses.includes("paralyzed") && s.statuses.includes("poisoned"),
          `échec : palier 2, ralenti retiré, Paralysé ajouté (palier ${s.level} ; états ${s.statuses.join(", ")} ; ralenti ${s.slow ? "oui" : "non"})`);
      }
      else {
        climbed.same = true;
        ctx.expect((s.level === 2) && s.statuses.includes("paralyzed"), `échec au dernier palier : il y reste (palier ${s.level})`);
      }
    }
    ctx.expect(climbed.one && climbed.two && climbed.same, "la montée complète est vue (palier 1, palier 2, maintien)");

    // 2. Recul : DD 1.
    await lend(1);
    await pause(800);
    const res = await banditTurn();
    s = await look();
    if ( res?.nat20 ) ctx.log("20 naturel pendant le recul : l'effet est tombé (critEnds)");
    else if ( ctx.expect(res?.save?.success === true, `DD 1 : sauvegarde réussie (${res?.save?.total ?? "aucune"})`) ) {
      ctx.expect((s.level === 1) && !!s.slow && !s.statuses.includes("paralyzed") && s.statuses.includes("poisoned"),
        `réussite : palier 1, Paralysé retiré, ralenti reposé (palier ${s.level} ; états ${s.statuses.join(", ")})`);
    }
    if ( !s.base ) {
      await lend(30);
      if ( !ctx.expect(!!(await poison()), "le poison reposé pour le soin") ) return;
      await banditTurn();
      s = await look();
    }

    // 3. Magical healing: Healing Word from the Cleric.
    if ( !ctx.expect(!!s.base, "l'effet est porté avant le soin") ) return;
    const max = (await ctx.engine("stats", { tokenId: bandit.id }).catch(() => null))?.hp?.max ?? hp0;
    await ctx.setHp(bandit, Math.max(1, max - 6));
    await pause(800);
    ctx.expect(!!(await look()).base, "des PV changés à la main ne sont pas un soin magique : l'effet reste");
    const used = await ctx.use({ tokenId: clerc.id, itemId: healingWord, consume: false, targetTokenIds: [bandit.id] });
    await sweep();
    await pause(1200);
    await ctx.engine("rollCard", { messageId: used.usageMessageId }).catch(() => null);
    await sweep();
    await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
    let after = await look();
    for ( let w = 0; (w < 20) && (after.base || after.slow); w++ ) { await pause(500); after = await look(); }
    ctx.expect(!after.base, "Mot de guérison (soin magique) : « Essai : empoisonné » tombe");
    ctx.expect(!after.slow, "son effet de palier tombe avec lui");
    const ended = (await ctx.engineLog()).some(l => /ends on .*\(healedByMagic\)/.test(l));
    ctx.expect(ended, "le journal du moteur dit la fin (« ends on … (healedByMagic) »)");
    await sweep(500);
  }
};
