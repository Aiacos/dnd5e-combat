/**
 * The Rogue from the 2024 Player's Handbook (SPEC §20), world `dnd-6`. The Rogue (halfling, level 1) goes to level 5 for the
 * scenario (Sneak Attack 3d6) and receives, lent from the Player's Handbook compendium, Cunning Strike, Cunning Action,
 * Steady Aim, Evasion, Elusive and Assassinate. The Bandit receives 300 HP to survive the hits.
 *  - no Advantage or ally within 1.50 m of the Bandit: no Sneak Attack;
 *  - the Fighter next to the Bandit: Sneak Attack; the Cunning Strike question opens, Trip checked: 2d6
 *    rolled instead of 3d6, then the Bandit's Dexterity saving throw — Prone ⇔ failed;
 *  - the Rogue Prone (Disadvantage), the Fighter next to him: no Sneak Attack;
 *  - in combat, two hits in the same turn: Sneak Attack only once;
 *  - Withdraw: half the Speed more in the budget, and Disengage;
 *  - Cunning Action: Disengage and Dash as a Bonus Action;
 *  - Steady Aim: Speed to 0, then the shortbow fires with Advantage (Sneak Attack without an ally), the mark falls;
 *  - Evasion: the Sorcerer's Burning Hands on the Rogue — 0 on a success, half on a failure;
 *  - Elusive: the Restrained Rogue is not attacked with Advantage (he is without the feature);
 *  - Assassinate: in the first round, the Bandit who has not played is attacked with Advantage, and Sneak Attack adds the
 *    Rogue level (5).
 * Puts back positions, HP, conditions, level; removes the lent items.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "dnd-players-handbook.classes";
const ITEMS = {
  cunningStrike: "phbrgeCunningStr", cunningAction: "phbrgeCunningAct", steadyAim: "phbrgeSteadyAim0",
  evasion: "phbrgeEvasion000", elusive: "phbrgeElusive000", assassinate: "phbrgeAssasinate"
};
const STRIKE_TITLE = /Frappe malicieuse|Cunning Strike/i;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "roublard — Attaque sournoise, Frappe malicieuse, Ruse, Visée appliquée, Esquive totale, Insaisissable, Assassinat",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Roublard", "Bandit", "Guerrier", "Ensorceleur"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes(PHB) ) { ctx.log("Manuel des joueurs absent : non applicable"); return; }

    const rogue = await ctx.token("Roublard");
    const bandit = await ctx.token("Bandit");
    const fighter = await ctx.token("Guerrier");
    const sorc = await ctx.token("Ensorceleur");
    const grid = await ctx.gridSize();
    const homes = new Map();
    for ( const t of [rogue, bandit, fighter, sorc] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    const r0 = homes.get(rogue.id).pos;

    // The tokens added under the Rogue on 2026-09-28 (Monk, Druid, Ranger, Bard, row y = 5740) are allies within 1.50 m of the
    // Bandit's cell: they would give Sneak Attack "without an ally". Moved aside by two rows for the scenario, put back afterwards.
    for ( const name of ["Moine", "Druide", "Rôdeur", "Barde"] ) {
      const t = (await ctx.scene()).tokens.find(x => x.name === name);
      if ( !t ) continue;
      const pos = await ctx.position(t);
      ctx.restore(() => ctx.call("move-token", { tokenId: t.id, x: pos.x, y: pos.y, elevation: pos.elevation ?? 0 }).catch(() => {}));
      await ctx.call("move-token", { tokenId: t.id, x: pos.x, y: pos.y + 2 * grid, elevation: pos.elevation ?? 0 });
    }

    // The Bandit holds up: 300 HP for the duration of the scenario.
    const { data: bdata } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    const max0 = bdata.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
      data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
    const tough = () => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });

    const place = async (t, x, y) => {
      await ctx.call("move-token", { tokenId: t.id, x, y, elevation: 0 });   // an x/y update is constrained by the walls
      await pause(600);
    };
    const statuses = ["prone", "restrained", "poisoned", "unconscious", "dead", "blinded"];
    const remettre = async () => {
      for ( const [id, h] of homes ) {
        const t = tokens.find(x => x.id === id);
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        for ( const s of statuses ) {
          await ctx.removeStatusEffects(t, s);
          await ctx.call("set-status", { tokenId: id, statusId: s, active: false }).catch(() => {});
        }
        // The mastery marks (Shortsword Vex) of a hit give Advantage on the next one: removed between parts.
        await ctx.removeEffectsNamed(t, /Visée|Steady|Frappe malicieuse|Cunning Strike|Caché|Hidden|Furtiv|Ouverture|Vex/i);
        if ( id !== bandit.id ) await ctx.setHp(t, h.hp);
      }
    };
    ctx.restore(remettre);

    /* ---- The level 5 Rogue, the lent abilities ---- */

    const actor = await ctx.call("get-actor", { actorId: rogue.actorId });
    const cls = (actor.items ?? []).find(i => (i.type === "class") && (i.system?.identifier === "rogue"));
    if ( !ctx.expect(!!cls, "le Roublard a sa classe de roublard") ) return;
    const setLevel = n => ctx.call("upsert-actor-item", { actorId: rogue.actorId, itemData: { "system.levels": n }, match: { path: "_id", value: cls._id } });
    ctx.restore(() => setLevel(cls.system.levels).catch(() => {}));
    await setLevel(5);
    const lend = async id => {
      const uuid = `Compendium.${PHB}.Item.${id}`;
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      const r = await ctx.call("upsert-actor-item", { actorId: rogue.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: rogue.actorId, itemId: r.id }).catch(() => {}));
      return r.id;
    };
    const unlend = itemId => ctx.call("remove-embedded-item", { documentType: "Actor", id: rogue.actorId, itemId }).catch(() => {});
    await lend(ITEMS.cunningStrike);
    const dagger = await ctx.itemId(rogue.id, "shortsword");   // shortsword (Finesse): the sheet's dagger has quantity 0
    const shortbow = await ctx.itemId(rogue.id, "shortbow");

    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      // A combat left open by a failing part would skew the next one (the budget read would be its own).
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      await remettre();
      await pause(1000);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${name} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };
    const known = async () => (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    const strikeDialog = async (ids, waitMs=8000) => {
      const until = Date.now() + waitMs;
      while ( Date.now() < until ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: ids, waitMs: 2000 }).catch(() => null);
        const d = (r?.windows ?? []).find(w => STRIKE_TITLE.test(w.title ?? ""));
        if ( d ) return d;
      }
      return null;
    };

    /**
     * A Rogue attack. `strikes`: the answer to the Cunning Strike question (null: do not wait for it; []: "all
     * the dice"). Returns the resolution, the messages (attack, damage) and the question seen.
     */
    const attack = async (itemId, target, { strikes=null, usage={} }={}) => {
      const since = await ctx.lastMessageId();
      const ids = await known();
      const u = await ctx.use({ tokenId: rogue.id, itemId, activityType: "attack", targetTokenIds: [target.id], usageConfig: { [MODULE_ID]: usage } });
      let res = null;
      for ( const until = Date.now() + 20000; Date.now() < until; ) {
        res = await ctx.resolution(u.usageMessageId);
        const t = res?.targets?.find(x => x.name === target.name);
        if ( (t && (t.hit !== null) && (t.hit !== undefined)) || ["done", "missed", "undone"].includes(res?.step) ) break;
        await pause(400);
      }
      const hit = res?.targets?.find(x => x.name === target.name)?.hit === true;
      let dialog = null;
      if ( hit && strikes ) {
        dialog = await strikeDialog(ids);
        if ( dialog ) {
          const fields = Object.fromEntries(strikes.map(k => [k, true]));
          await ctx.call("answer-dialog", { id: dialog.id, ...(strikes.length ? { fields } : {}), button: strikes.length ? "strike" : "none" });
        }
      }
      const settled = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => res);
      await pause(1500);
      const msgs = await ctx.messagesSince(since);
      const attackMsg = msgs.find(m => m.type === "attack");
      const damage = msgs.find(m => (m.type === "damage") && (m.flags?.[MODULE_ID]?.sneak || (m.rolls ?? []).length));
      return { res: settled, hit, dialog, msgs, since, mode: attackMsg?.rolls?.[0]?.options?.advantageMode ?? null,
        sneak: damage?.flags?.[MODULE_ID]?.sneak ?? null, damage };
    };
    /** Attacks until it hits (20 tries), `before` before each try. */
    const hitUntil = async (itemId, target, options={}, { tries=20, before=null }={}) => {
      for ( let n = 1; n <= tries; n++ ) {
        if ( before ) await before();
        const a = await attack(itemId, target, options);
        if ( a.hit ) return a;
      }
      return null;
    };
    const budget = () => ctx.engine("budget", { tokenId: rogue.id });

    // The Bandit to the left of the Rogue, nobody else next to him; the Fighter to the left of the Bandit for "an ally at 1.50 m".
    const bx = r0.x - grid;
    const by = r0.y;

    /* ---- Attaque sournoise ---- */

    await part("sans Avantage ni allié", async () => {
      await tough();
      await place(bandit, bx, by);
      const a = await hitUntil(dagger, bandit);
      if ( !ctx.expect(!!a, "dague : touché (20 essais au plus)") ) return;
      ctx.expect(a.mode === 0, `jet normal (mode ${a.mode})`);
      ctx.expect(!a.sneak, "pas d'Attaque sournoise");
      ctx.expect(!a.dialog, "pas de question de Frappe malicieuse");
    });

    await part("allié à côté : Attaque sournoise, Croc-en-jambe", async () => {
      await tough();
      await place(bandit, bx, by);
      await place(fighter, bx - grid, by);
      const a = await hitUntil(dagger, bandit, { strikes: ["trip"] });
      if ( !ctx.expect(!!a, "dague : touché (20 essais au plus)") ) return;
      ctx.expect(!!a.dialog, `la question de Frappe malicieuse s'ouvre (${a.dialog?.title ?? "aucune"})`);
      ctx.expect(a.sneak?.dice === 2 && (a.sneak?.strikes ?? []).join() === "trip", `Attaque sournoise : ${a.sneak?.dice}d6 lancés (3d6 moins 1d6), frappes : ${(a.sneak?.strikes ?? []).join(", ")}`);
      ctx.expect((a.damage?.rolls ?? []).some(x => /^2d6$/.test((x.formula ?? "").replace(/\s/g, ""))), `jet de dégâts « ${(a.damage?.rolls ?? []).map(x => x.formula).join(" | ")} »`);
      // Trip's saving throw, played by the engine after the damage.
      let card = null;
      for ( const until = Date.now() + 15000; !card && (Date.now() < until); await pause(500) ) {
        card = (await ctx.messagesSince(a.since)).find(m => m.flags?.[MODULE_ID]?.areaTick?.event === "cunningStrike");
      }
      if ( !ctx.expect(!!card, "Croc-en-jambe : la sauvegarde du Bandit est jouée") ) return;
      const r = await ctx.settle(card.id, { timeoutMs: 30000 });
      const t = r.targets?.[0];
      const prone = (await ctx.engine("stats", { tokenId: bandit.id }).catch(() => null))?.statuses?.includes("prone");
      ctx.expect(r.plan?.save?.ability === "dex", `sauvegarde de Dextérité DD ${r.plan?.save?.dc} (${t?.save?.total})`);
      ctx.expect(!!t?.save && (prone === !t.save.success), `À terre ⇔ ratée (${t?.save?.success ? "réussie" : "ratée"}, à terre : ${prone})`);
    });

    await part("Désavantage : pas d'Attaque sournoise", async () => {
      await tough();
      await place(bandit, bx, by);
      await place(fighter, bx - grid, by);
      const a = await hitUntil(dagger, bandit, {}, { before: () => ctx.call("set-status", { tokenId: rogue.id, statusId: "prone", active: true }) });
      if ( !ctx.expect(!!a, "dague À terre : touché (20 essais au plus)") ) return;
      ctx.expect(a.mode === -1, `jet avec le Désavantage (mode ${a.mode})`);
      ctx.expect(!a.sneak, "pas d'Attaque sournoise malgré le Guerrier");
    });

    /* ---- En combat ---- */

    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    const fight = async order => {
      await ctx.startCombat(order.map(([t]) => t));
      const combat = await state();
      for ( const [t, value] of order ) {
        await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value, combatId: ctx.ownCombat });
      }
      // The fixed Initiative re-sorts the combatants without changing the turn index: we go back (always in round 1,
      // for Assassinate) rather than advance.
      for ( let i = 0; (i < 4) && ((await current()) !== rogue.id); i++ ) {
        await ctx.call("previous-turn", { combatId: ctx.ownCombat }).catch(() => ctx.nextTurn());
        await pause(1500);
      }
      const c = await state();
      return ((await current()) === rogue.id) && (c.round === 1);
    };
    const endFight = () => ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});

    await part("une fois par tour", async () => {
      await tough();
      await place(bandit, bx, by);
      await place(fighter, bx - grid, by);
      if ( !ctx.expect(await fight([[rogue, 20], [bandit, 10], [fighter, 5]]), "combat : au tour du Roublard") ) return;
      const first = await hitUntil(dagger, bandit, { strikes: [] });
      ctx.expect(first?.sneak?.dice === 3, `premier coup : Attaque sournoise 3d6 (${first?.sneak?.dice ?? "aucune"})`);
      const second = await hitUntil(dagger, bandit, { usage: { confirmed: true } });
      ctx.expect(!!second && !second.sneak, "second coup du même tour : pas d'Attaque sournoise");
      await endFight();
    });

    await part("Repli", async () => {
      await tough();
      await place(bandit, bx, by);
      await place(fighter, bx - grid, by);
      if ( !ctx.expect(await fight([[rogue, 20], [bandit, 10], [fighter, 5]]), "combat : au tour du Roublard") ) return;
      const before = await budget();
      const a = await hitUntil(dagger, bandit, { strikes: ["withdraw"] });
      if ( !ctx.expect(!!a?.dialog, "Repli choisi dans la question") ) return;
      await pause(2000);
      const after = await budget();
      ctx.expect((after?.bonusMove > 0) && after?.disengaged === true, `budget : +${after?.bonusMove} de déplacement, désengagé (${after?.disengaged})`);
      ctx.expect(after?.cap >= (before?.cap ?? 0) + (after?.bonusMove ?? 0) - 0.01, `plafond de déplacement ${before?.cap} → ${after?.cap}`);
      await endFight();
    });

    const cunningAction = await lend(ITEMS.cunningAction);
    await part("Ruse : Se désengager et Foncer par une action Bonus", async () => {
      if ( !ctx.expect(await fight([[rogue, 20], [bandit, 10]]), "combat : au tour du Roublard") ) return;
      await ctx.use({ tokenId: rogue.id, itemId: cunningAction, activityId: "AeCciDTvw3kS583a" });
      await pause(2000);
      let b = await budget();
      ctx.expect(b?.disengaged === true && b?.bonus === 0 && b?.action === 1, `Se désengager : désengagé ${b?.disengaged}, action Bonus ${b?.bonus}, action ${b?.action}`);
      await ctx.nextTurn(); await pause(1500);
      for ( let i = 0; (i < 3) && ((await current()) !== rogue.id); i++ ) { await ctx.nextTurn(); await pause(1500); }
      await ctx.use({ tokenId: rogue.id, itemId: cunningAction, activityId: "NtS3iThuWWwm8O62" });
      await pause(2000);
      b = await budget();
      ctx.expect(b?.dashed === true && b?.bonus === 0 && b?.action === 1, `Foncer : ${b?.dashed}, action Bonus ${b?.bonus}, action ${b?.action}`);
      await endFight();
    });

    const steady = await lend(ITEMS.steadyAim);
    await part("Visée appliquée", async () => {
      await tough();
      await place(bandit, r0.x - 3 * grid, by);   // 4 cells away, a wall hides the Bandit in Restored Keep
      if ( !ctx.expect(await fight([[rogue, 20], [bandit, 10]]), "combat : au tour du Roublard") ) return;
      await ctx.use({ tokenId: rogue.id, itemId: steady, activityId: "VGVYnecMRcu0f5Sq" });
      await pause(2500);
      const b = await budget();
      ctx.expect(b?.stopped === true && b?.bonus === 0, `Vitesse à 0 (${b?.stopped}), action Bonus dépensée (${b?.bonus})`);
      const trace = (await ctx.effects(rogue)).some(e => /Visée|Steady/i.test(e.name ?? ""));
      ctx.expect(trace, "la trace de Visée appliquée est sur le Roublard");
      const why = await ctx.engine("attackReasons", { attackerId: rogue.id, targetId: bandit.id, itemId: shortbow });
      ctx.expect(why.advantage.length === 1 && !why.disadvantage.length, `raisons : avantage [${why.advantage}], désavantage [${why.disadvantage}], hostiles au contact [${why.adjacentHostiles}]`);
      const a = await attack(shortbow, bandit, { strikes: [] });
      ctx.expect(a.mode === 1, `arc court avec l'Avantage (mode ${a.mode})`);
      if ( a.hit ) ctx.expect(a.sneak?.dice === 3, `touché : Attaque sournoise sans allié (${a.sneak?.dice ?? "aucune"})`);
      const left = (await ctx.effects(rogue)).some(e => /Visée|Steady/i.test(e.name ?? ""));
      ctx.expect(!left, "la trace tombe au jet d'attaque");
      await endFight();
    });

    /* ---- Defense ---- */

    await part("Insaisissable (contrôle) : Entravé, attaqué avec l'Avantage", async () => {
      await place(bandit, bx, by);
      await ctx.call("set-status", { tokenId: rogue.id, statusId: "restrained", active: true });
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: bandit.id, identifier: "scimitar", activityType: "attack", targetTokenIds: [rogue.id] });
      await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      const m = (await ctx.messagesSince(since)).find(x => x.type === "attack");
      ctx.expect(m?.rolls?.[0]?.options?.advantageMode === 1, `sans Insaisissable : Avantage (mode ${m?.rolls?.[0]?.options?.advantageMode})`);
    });

    const elusive = await lend(ITEMS.elusive);
    await part("Insaisissable", async () => {
      await place(bandit, bx, by);
      await ctx.call("set-status", { tokenId: rogue.id, statusId: "restrained", active: true });
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: bandit.id, identifier: "scimitar", activityType: "attack", targetTokenIds: [rogue.id] });
      await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      const m = (await ctx.messagesSince(since)).find(x => x.type === "attack");
      ctx.expect(m?.rolls?.[0]?.options?.advantageMode === 0, `Insaisissable : pas d'Avantage (mode ${m?.rolls?.[0]?.options?.advantageMode})`);
    });
    await unlend(elusive);

    await lend(ITEMS.evasion);
    await part("Esquive totale", async () => {
      const seen = new Set();
      for ( let n = 0; (n < 25) && (seen.size < 2); n++ ) {
        await ctx.setHp(rogue, homes.get(rogue.id).hp);
        const box = await ctx.box(rogue);
        const used = await ctx.use({ tokenId: sorc.id, identifier: "burning-hands", activityType: "save", consume: false, area: { shape: "rectangle", ...box } });
        if ( used.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: used.regionId }).catch(() => {}));
        const r = await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        const t = r?.targets?.find(x => x.name === "Roublard");
        if ( !t?.save ) continue;
        const damage = (await ctx.messagesSince(used.usageMessageId)).find(m => m.type === "damage");
        const total = (damage?.rolls ?? []).reduce((sum, roll) => sum + (roll.total ?? 0), 0);
        const expected = t.save.success ? 0 : Math.floor(total / 2);
        const key = t.save.success ? "réussie" : "ratée";
        if ( seen.has(key) ) continue;
        seen.add(key);
        ctx.expect((t.damage?.applied ?? 0) === expected, `sauvegarde ${key} (${t.save.total}) : ${t.damage?.applied ?? 0} dégâts appliqués sur ${total} (attendu ${expected})`);
        await pause(2500);
      }
      ctx.expect(seen.size === 2, `réussite et échec vus (${[...seen].join(", ")})`);
    });

    /* ---- Assassin ---- */

    await lend(ITEMS.assassinate);
    await part("Assassinat", async () => {
      await tough();
      await place(bandit, bx, by);
      // The Bandit plays after the Rogue: in the first round, he has not played yet.
      if ( !ctx.expect(await fight([[rogue, 20], [bandit, 10]]), "combat : au tour du Roublard (round 1)") ) return;
      const a = await attack(dagger, bandit, { strikes: [] });
      ctx.expect(a.mode === 1, `Avantage contre le Bandit qui n'a pas joué (mode ${a.mode})`);
      if ( a.hit ) {
        ctx.expect(a.sneak?.dice === 3 && (a.sneak?.bonuses ?? []).length === 1, `Attaque sournoise ${a.sneak?.dice}d6, plus ${(a.sneak?.bonuses ?? []).join(", ")}`);
        ctx.expect((a.damage?.rolls ?? []).some(x => (x.formula ?? "").trim() === "5"), `+5 (niveau de Roublard) : « ${(a.damage?.rolls ?? []).map(x => x.formula).join(" | ")} »`);
      }
      await endFight();
    });
  }
};
