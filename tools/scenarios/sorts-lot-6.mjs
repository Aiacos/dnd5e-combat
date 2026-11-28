/**
 * §288: work items of 2026-10-30, batch 6 (defective PHB data), world `dnd-6`, Test Arena. The Paladin receives the
 * Player's Handbook spells; the Bandit (300 HP) is the target, the Zombie next to him. Checks:
 *  - Lightning Arrow, thrown javelin that hits: offered like a smite, its 4d8 replace the javelin's dice, the level 3 spell slot
 *    is spent, the burst makes the Zombie save (card);
 *  - Lightning Arrow, javelin that misses: offered on the miss, half damage on the Bandit, the burst;
 *  - Dispel Evil and Good: "Cast" leaves a mark on the Paladin, the Zombie (Undead) attacks him with Disadvantage;
 *    Dismissal used, Concentration drops and the mark with it;
 *  - Maze: the Zombie banished (hidden token), at the start of his turn the Study action is offered to him; succeeded
 *    (attempt bonus), he comes back and the spell ends;
 *  - "Direct Hit": the enchanted longsword offers its slashing or radiant damage.
 * Puts back positions, HP, spell slots, quantities, effects; removes the lent items.
 */
const MODULE_ID = "dnd5e-combat";
const SPELLS = "dnd-players-handbook.spells";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "sorts lot 6 — Flèche de foudre, Dissipation du mal et du bien, Dédale, Coup au but (données du PHB)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Paladin", "Bandit", "Zombi"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const pal = await ctx.token("Paladin");
    const bandit = await ctx.token("Bandit");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const sceneId = (await ctx.scene()).sceneId;
    const all = [pal, bandit, zombi];
    const homes = new Map();
    for ( const t of all ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t), effects: new Set((await ctx.effects(t)).map(e => e._id ?? e.id)) });
    const g = homes.get(pal.id).pos;
    const targetOf = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      return data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${sceneId}.Token.${t.id}.Actor.${data.actorId}` };
    };

    const { data: bdata } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    const max0 = bdata.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
      data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
    const tough = () => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });

    const actor0 = await ctx.call("get-actor", { actorId: pal.actorId });
    const slots0 = Object.fromEntries(Object.entries(actor0.system?.spells ?? {}).map(([k, v]) => [k, v?.value ?? 0]));
    const setSlots = slots => ctx.call("update-actor", { actorId: pal.actorId, actorData: Object.fromEntries(Object.entries(slots).map(([k, v]) => [`system.spells.${k}.value`, v])) });
    const slots = async () => Object.fromEntries(Object.entries((await ctx.call("get-actor", { actorId: pal.actorId })).system?.spells ?? {}).map(([k, v]) => [k, v?.value ?? 0]));
    ctx.restore(() => setSlots(slots0).catch(() => {}));

    const lend = async id => {
      const uuid = `Compendium.${SPELLS}.Item.${id}`;
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      setPath(itemData, "system.method", "atwill");
      const r = await ctx.call("upsert-actor-item", { actorId: pal.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: pal.actorId, itemId: r.id }).catch(() => {}));
      return r.id;
    };
    const arrow = await lend("phbsplLightningA");
    // Lightning Arrow is paid for with a spell slot (offered like a smite): not "at will" — and prepared, otherwise it
    // is not offered after a hit (issue #144).
    await ctx.call("upsert-actor-item", { actorId: pal.actorId, itemData: { "system.method": "spell", "system.prepared": 1 }, match: { path: "_id", value: arrow } });
    const dispel = await lend("phbsplDispelEvil");
    const maze = await lend("phbsplMaze000000");
    const trueStrike = await lend("phbsplTrueStrike");
    const javelin = await ctx.itemId(pal.id, "javelin");
    const sword = await ctx.itemId(pal.id, "longsword");
    const slam = await ctx.itemId(zombi.id, "slam");
    const jav0 = ((await ctx.call("get-actor", { actorId: pal.actorId })).items ?? []).find(i => i._id === javelin)?.system?.quantity ?? 0;
    if ( javelin ) ctx.restore(() => ctx.call("upsert-actor-item", { actorId: pal.actorId, itemData: { "system.quantity": jav0 }, match: { path: "_id", value: javelin } }).catch(() => {}));

    const remettre = async () => {
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      for ( const t of all ) {
        const h = homes.get(t.id);
        const target = await targetOf(t);
        for ( const e of (await ctx.effects(t)).filter(e => !h.effects.has(e._id ?? e.id) && !e.flags?.[MODULE_ID]?.aura) ) {
          await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
        }
        // §435: the Dismissal of Dispel Evil and Good banishes an Undead that fails for good (§402, `banish`): the engine's mark
        // stayed on the Zombie, and Maze thought him already banished (nothing hidden) — the failure, one time in two, of the run.
        await ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { hidden: false, [`flags.${MODULE_ID}.-=banished`]: null } }).catch(() => {});
        await ctx.call("move-token", { tokenId: t.id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        if ( t !== bandit ) await ctx.setHp(t, h.hp);
      }
      await setSlots(slots0);
      await pause(800);
    };
    ctx.restore(remettre);
    const part = async (name, fn) => {
      if ( process.env.PART && !name.includes(process.env.PART) ) return;
      try { await remettre(); await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      await pause(1000);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${name} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    /** Combat: the tokens in this Initiative order, on the first one's turn. */
    const fight = async order => {
      await ctx.startCombat(order);
      const combat = await state();
      for ( const [i, t] of order.entries() ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: 20 - (i * 5), combatId: ctx.ownCombat });
      for ( let i = 0; (i < 4) && ((await current()) !== order[0].id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
      return (await current()) === order[0].id;
    };
    const known = async () => (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    /** Answers the GM's windows (`answers`: [text pattern, button pattern]) for `ms`, until an answer; returns what was seen. */
    const answerAll = async (ids, answers, ms=9000) => {
      const seen = [];
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: [...ids, ...seen.map(d => d.id)], waitMs: 1500, details: true }).catch(() => null);
        for ( const d of r?.windows ?? [] ) {
          const text = `${d.title ?? ""} ${d.content ?? d.text ?? ""}`;
          const rule = answers.find(([re]) => re.test(text));
          const b = rule ? (d.buttons ?? []).find(x => rule[1].test(x.label ?? "")) : null;
          if ( b ) await ctx.call("answer-dialog", { id: d.id, button: b.action ?? b.label }).catch(() => {});
          seen.push({ id: d.id, text, answered: b?.label ?? null, buttons: (d.buttons ?? []).map(x => x.label) });
        }
        if ( seen.some(d => d.answered) ) break;
      }
      return seen;
    };
    const throwAt = async () => {
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: pal.id, itemId: javelin, activityType: "attack", targetTokenIds: [bandit.id], usageConfig: { [MODULE_ID]: { attackMode: "thrown", cost: "free" } } });
      return { since, usage: u.usageMessageId };
    };
    /** Throws javelins (12 at most) until the wanted outcome (`hit`), answering per `answers`; returns the retained try. */
    const until = async (hit, answers, ms=8000) => {
      for ( let n = 0; n < 12; n++ ) {
        await ctx.call("upsert-actor-item", { actorId: pal.actorId, itemData: { "system.quantity": 10 }, match: { path: "_id", value: javelin } });
        const ids = await known();
        const before = await ctx.hp(bandit);
        const a = await throwAt();
        const asked = await answerAll(ids, answers, ms);
        const r = await ctx.settle(a.usage, { timeoutMs: 45000 }).catch(() => null);
        const touched = r?.targets?.find(t => t.name === bandit.name)?.hit === true;
        if ( touched !== hit ) { await pause(1500); continue; }
        await pause(4000);
        return { a, asked, r, before, messages: await ctx.messagesSince(a.since) };
      }
      return null;
    };
    const place = async (t, dx, dy) => { await ctx.call("move-token", { tokenId: t.id, x: g.x + (dx * grid), y: g.y + (dy * grid), elevation: 0 }); await pause(700); };
    const LIGHTNING = /foudre|Lightning/i;
    const NONE = /Pas de|^No |Rien|Nothing/i;

    await part("Flèche de foudre (touché)", async () => {
      await tough(); await place(bandit, 4, 0); await place(zombi, 5, 0);
      await setSlots({ ...slots0, spell3: 1 });
      const z0 = await ctx.hp(zombi);
      if ( !ctx.expect(await fight([pal, bandit, zombi]), "combat : au tour du Paladin") ) return;
      const res = await until(true, [[/rate |misses/i, NONE], [/Châtiment|Smite|toucher|hit/i, LIGHTNING]]);
      if ( !ctx.expect(!!res, "la javeline touche le Bandit (12 essais au plus)") ) return;
      const offered = res.asked.flatMap(d => d.buttons ?? []);
      ctx.expect(offered.some(b => LIGHTNING.test(b)), `Flèche de foudre proposée après le coup (${offered.join(" / ")})`);
      const damage = res.messages.find(m => m.type === "damage");
      const formula = damage?.rolls?.map(r => r.formula).join(" + ") ?? "";
      ctx.expect(/4d8/.test(formula) && !/1d6/.test(formula), `les 4d8 remplacent la javeline (« ${formula} »)`);
      ctx.expect((await slots()).spell3 === 0, `emplacement de niveau 3 dépensé (${(await slots()).spell3})`);
      let card = null;
      for ( const stop = Date.now() + 20000; !card && (Date.now() < stop); await pause(800) ) card = (await ctx.messagesSince(res.a.since)).find(m => m.flags?.[MODULE_ID]?.lightningBlast);
      ctx.expect(!!card && (card.flags[MODULE_ID].lightningBlast.caught ?? []).some(u => u.endsWith(zombi.id) || u.includes(`Token.${zombi.id}`)), `l'éclat prend le Zombi, à 3 m (${JSON.stringify(card?.flags?.[MODULE_ID]?.lightningBlast ?? null)})`);
      ctx.expect((await ctx.hp(zombi)) < z0, `le Zombi subit la foudre (${z0} → ${await ctx.hp(zombi)})`);
    });

    await part("Flèche de foudre (raté)", async () => {
      await tough(); await place(bandit, 4, 0); await place(zombi, 5, 0);
      await setSlots({ ...slots0, spell3: 1 });
      if ( !ctx.expect(await fight([pal, bandit, zombi]), "combat : au tour du Paladin") ) return;
      // §435: a near miss first goes through the GM's "success at a cost" window (up to 16 s, runtime/success-at-cost.mjs);
      // the Lightning Arrow question comes after — beyond the 8 s of listening, it stayed unanswered (one run in two).
      const res = await until(false, [[/rate |misses/i, LIGHTNING], [/Châtiment|Smite|toucher|hit/i, NONE]], 30000);
      if ( !ctx.expect(!!res, "la javeline rate le Bandit (12 essais au plus)") ) return;
      const offered = res.asked.flatMap(d => d.buttons ?? []);
      ctx.expect(offered.some(b => LIGHTNING.test(b)), `Flèche de foudre proposée après le raté (${offered.join(" / ")})`);
      let card = null;
      for ( const stop = Date.now() + 20000; !card && (Date.now() < stop); await pause(800) ) card = (await ctx.messagesSince(res.a.since)).find(m => m.flags?.[MODULE_ID]?.lightningBlast);
      ctx.expect(!!card, "l'éclat éclate quand même");
      const half = res.messages.find(m => (m.rolls ?? []).some(r => /4d8/.test(r.formula)));
      const rolled = half?.rolls?.find(r => /4d8/.test(r.formula))?.total ?? null;
      const lost = res.before - (await ctx.hp(bandit));
      ctx.expect(rolled !== null && lost === Math.floor(rolled / 2), `le Bandit subit la moitié des 4d8 (${rolled} → ${lost})`);
      ctx.expect((await slots()).spell3 === 0, `emplacement de niveau 3 dépensé (${(await slots()).spell3})`);
    });

    await part("Dissipation du mal et du bien", async () => {
      await place(zombi, 1, 0);
      const base = await ctx.engine("attackReasons", { attackerId: zombi.id, targetId: pal.id, itemId: slam });
      await ctx.use({ tokenId: pal.id, itemId: dispel, activityId: "0vS3We98acymzUXC", consume: false });
      await pause(1500);
      const effects = await ctx.effects(pal);
      ctx.expect(effects.some(e => /Dispel Evil|Dissipation/i.test(e.name ?? "") && !(e.statuses ?? []).includes("concentrating")), `une trace sur le Paladin (${effects.map(e => e.name).join(", ")})`);
      const r = await ctx.engine("attackReasons", { attackerId: zombi.id, targetId: pal.id, itemId: slam });
      ctx.expect(r.disadvantage.length === base.disadvantage.length + 1, `le Zombi (mort-vivant) l'attaque avec le Désavantage (${JSON.stringify(r.disadvantage)})`);
      await ctx.use({ tokenId: pal.id, itemId: dispel, activityId: "dnd5eactivity000", consume: false, targetTokenIds: [zombi.id] });
      await pause(2500);
      const after = await ctx.effects(pal);
      ctx.expect(!after.some(e => /Dispel Evil|Dissipation/i.test(e.name ?? "")), `Renvoi utilisé : le sort prend fin, trace et concentration parties (${after.map(e => e.name).join(", ")})`);
    });

    await part("Dédale", async () => {
      await place(zombi, 2, 0);
      await ctx.engine("concentrate", { tokenId: pal.id, itemId: maze });
      await ctx.engine("placeItemEffect", { tokenId: zombi.id, casterId: pal.id, itemId: maze, effectId: "y7cYsJ0DCzXt4Tvy" });
      await pause(1500);
      const hidden = async () => (await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id })).data?.hidden === true;
      ctx.expect(await hidden(), "le Zombi est banni dans le dédale (token caché)");
      // Try: the Investigation check succeeds for sure.
      await ctx.call("upsert-embedded-effect", { ...(await targetOf(zombi)), effectData: { name: "Essai : fil d'Ariane", img: "icons/svg/book.svg", transfer: false,
        changes: [{ key: "system.skills.inv.bonuses.check", value: "40", type: "add" }] } });
      if ( !ctx.expect(await fight([pal, zombi]), "combat : au tour du Paladin") ) return;
      const ids = await known();
      const since = await ctx.lastMessageId();
      await ctx.nextTurn();
      const asked = await answerAll(ids, [[/Étud|stud|Dédale|Maze/i, /Étudier|Study/i]], 15000);
      ctx.expect(asked.some(d => d.answered), `au début de son tour, l'Étude lui est proposée (${asked.map(d => d.buttons.join("/")).join(" | ")})`);
      let card = null;
      for ( const stop = Date.now() + 20000; !card && (Date.now() < stop); await pause(800) ) card = (await ctx.messagesSince(since)).find(m => m.flags?.[MODULE_ID]?.actionEnd);
      ctx.expect(card?.flags?.[MODULE_ID]?.actionEnd?.success === true, `test réussi (${JSON.stringify(card?.flags?.[MODULE_ID]?.actionEnd ?? null)})`);
      await pause(2000);
      ctx.expect(!(await hidden()), "il revient sur la carte");
      ctx.expect(!(await ctx.effects(pal)).some(e => (e.statuses ?? []).includes("concentrating") && /Maze|Dédale/i.test(e.name ?? "")), "le sort prend fin (concentration du Paladin)");
    });

    await part("Coup au but", async () => {
      const swordUuid = `Actor.${pal.actorId}.Item.${sword}`;
      await ctx.use({ tokenId: pal.id, itemId: trueStrike, consume: false, usageConfig: { [MODULE_ID]: { enchantItem: swordUuid } } });
      let types = null;
      for ( const stop = Date.now() + 20000; Date.now() < stop; await pause(700) ) {
        types = await ctx.engine("damageTypes", { tokenId: pal.id, itemId: sword });
        if ( types.choices.length > 1 ) break;
      }
      ctx.expect(types?.choices?.includes("radiant") && types.choices.some(t => t !== "radiant"), `l'arme enchantée propose ses dégâts ou des dégâts radiants (${JSON.stringify(types)})`);
      const actor = await ctx.call("get-actor", { actorId: pal.actorId });
      const enchant = (actor.items ?? []).find(i => i._id === sword)?.effects ?? [];
      for ( const e of enchant ) await ctx.call("remove-embedded-effect", { uuid: `Actor.${pal.actorId}.Item.${sword}`, effectId: e._id }).catch(() => {});
    });
  }
};
