/**
 * The Player's Handbook 2024 Druid (SPEC §30), `dnd-6` world. The Fighter receives, lent from the Player's Handbook
 * compendium, Elemental Fury (and its improved version), Selenic Stride and Wrath of the Sea; the Bandit receives 300 HP. Checks:
 *  - Primal Strike: +1d8 fire on the first weapon hit of the turn, not on the second; 2d8 with improved Elemental Fury;
 *  - Selenic Stride: the next attack has Advantage, the mark consumed (the attack after, not);
 *  - Wrath of the Sea: a failed Constitution save pushes the Bandit back 15 ft (three cells); Handbook 3.0.0: the manifestation
 *    chains the save without a second Bonus Action, on oneself or (level 14) around another creature (§438).
 * Restores positions, HP, conditions; removes the lent items.
 */
const MODULE_ID = "dnd5e-combat";
const CLASSES = "dnd-players-handbook.classes";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "druide — Attaques primitives, Foulée sélène, Courroux des mers",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Guerrier", "Bandit"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes(CLASSES) ) { ctx.log("Manuel des joueurs absent : non applicable"); return; }
    const hero = await ctx.token("Guerrier");
    const bandit = await ctx.token("Bandit");
    const grid = await ctx.gridSize();
    const homes = new Map();
    for ( const t of [hero, bandit] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    const g = homes.get(hero.id).pos;

    const { data: bdata } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    const max0 = bdata.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
      data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
    const tough = () => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });
    const place = async (t, x, y) => { await ctx.call("move-token", { tokenId: t.id, x, y, elevation: 0 }); await pause(700); };
    const lend = async id => {
      const uuid = `Compendium.${CLASSES}.Item.${id}`;
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      const r = await ctx.call("upsert-actor-item", { actorId: hero.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: hero.actorId, itemId: r.id }).catch(() => {}));
      return r.id;
    };
    const unlend = id => ctx.call("remove-embedded-item", { documentType: "Actor", id: hero.actorId, itemId: id }).catch(() => {});

    const remettre = async () => {
      for ( const [id, h] of homes ) {
        const t = tokens.find(x => x.id === id);
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        await ctx.removeEffectsNamed(t, /Foulée sélène|Moonlight|Sape|Sap\b|Embruns/i);
        if ( id !== bandit.id ) await ctx.setHp(t, h.hp);
      }
    };
    ctx.restore(remettre);
    const part = async (name, fn) => {
      if ( process.env.PART && !name.includes(process.env.PART) ) return;
      // The world's Fighter may be Prone (a `dnd-6` condition at copy time): its Disadvantage would cancel the Advantage checked.
      for ( const st of ["prone", "unconscious"] ) await ctx.call("set-status", { tokenId: hero.id, statusId: st, active: false }).catch(() => {});
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      await remettre();
      await pause(1000);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${name} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    const fight = async () => {
      await ctx.startCombat([hero, bandit]);
      const combat = await state();
      for ( const [t, v] of [[hero, 20], [bandit, 10]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      for ( let i = 0; (i < 3) && ((await current()) !== hero.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
      return (await current()) === hero.id;
    };
    const sword = await ctx.itemId(hero.id, "greatsword");
    /** A two-handed sword attack: its attack formula, hit or not, and the roll's bonus damage. */
    const swing = async () => {
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: hero.id, itemId: sword, activityType: "attack", targetTokenIds: [bandit.id], usageConfig: { [MODULE_ID]: { confirmed: true } } });
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1000);
      const msgs = await ctx.messagesSince(since);
      return { formula: msgs.find(m => m.type === "attack")?.rolls?.[0]?.formula ?? "", hit: r?.targets?.find(t => t.name === "Bandit")?.hit === true,
        bonuses: (msgs.find(m => m.type === "damage")?.flags?.[MODULE_ID]?.bonuses ?? []).map(b => `${b.formula} ${b.damageType}`) };
    };
    const hit = async () => { for ( let n = 0; n < 10; n++ ) { const s = await swing(); if ( s.hit ) return s.bonuses; } return null; };

    await part("Attaques primitives", async () => {
      const fury = await lend("phbdrdElementalF");
      await tough(); await place(bandit, g.x + grid, g.y);
      if ( !ctx.expect(await fight(), "combat : au tour du Guerrier") ) return;
      const first = await hit();
      ctx.expect(!!first && first.includes("1d8 fire"), `premier coup : ${first?.join(", ")}`);
      const second = await hit();
      ctx.expect(!!second && !second.includes("1d8 fire"), `second coup du tour : ${second?.join(", ") || "rien"}`);
      await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null;
      const improved = await lend("phbdrdImprovedEl");
      if ( !ctx.expect(await fight(), "combat : au tour du Guerrier") ) return;
      const third = await hit();
      ctx.expect(!!third && third.includes("2d8 fire") && !third.includes("1d8 fire"), `Fureur élémentaire améliorée : ${third?.join(", ")}`);
      await unlend(improved); await unlend(fury);
    });

    await part("Foulée sélène", async () => {
      const step = await lend("phbdrdMoonlightS");
      await tough(); await place(bandit, g.x + grid, g.y);
      if ( !ctx.expect(await fight(), "combat : au tour du Guerrier") ) return;
      const before = await swing();
      ctx.expect(!/adv|kh/.test(before.formula), `avant : ${before.formula}`);
      const u = await ctx.use({ tokenId: hero.id, itemId: step, activityId: "dnd5eactivity000", usageConfig: { [MODULE_ID]: { confirmed: true } } });
      await ctx.settle(u.usageMessageId, { timeoutMs: 15000 }).catch(() => null);
      await pause(2000);
      // The teleportation destination waits for a click on the author's side: we leave it (Escape), the Advantage is what we check.
      await ctx.call("list-dialogs", {}).catch(() => null);
      const marked = (await ctx.call("get-actor", { actorId: hero.actorId })).effects?.some(e => /Foulée sélène|Moonlight/i.test(e.name));
      ctx.expect(!!marked, "le Guerrier porte l'effet de la Foulée sélène");
      const after = await swing();
      ctx.expect(/adv|kh/.test(after.formula), `attaque suivante : ${after.formula}`);
      const again = await swing();
      ctx.expect(!/adv|kh/.test(again.formula), `celle d'après (marque consommée) : ${again.formula}`);
      await unlend(step);
    });

    await part("Courroux des mers", async () => {
      const wrath = await lend("phbdrdWrathOfThe");
      await tough();
      // Restored Keep, column x = 3080: from y = 5040 to 5460, four cells free of walls (survey of the `poussee` scenario, under
      // the Wizard's original cell, 3080 × 4760). The druid at 4900, the Bandit at 5040, pushed back to 5460.
      await place(hero, 3080, 4900);
      const pos0 = { x: 3080, y: 5040 };
      let checked = false;
      for ( let n = 0; (n < 20) && !checked; n++ ) {
        await place(bandit, pos0.x, pos0.y);
        // The activity places an Emanation (template): the area is given, on the Bandit's cell.
        const box = await ctx.box(bandit);
        // §438: Handbook 3.0.0 — the save `9U9AoJYvcrCQtIMm` no longer has a template ("a creature in the Emanation"): the
        // creature is designated through the engine's list (`castPicked`), as on click.
        const saveAct = ((await ctx.call("get-actor", { actorId: hero.actorId })).items ?? []).find(i => i._id === wrath)?.system?.activities?.["9U9AoJYvcrCQtIMm"];
        const picked = !saveAct?.target?.template?.type;
        const u = picked
          ? { usageMessageId: (await ctx.engine("castPicked", { tokenId: hero.id, itemId: wrath, activityId: "9U9AoJYvcrCQtIMm", targetIds: [bandit.id] }))?.usageMessageId }
          : await ctx.use({ tokenId: hero.id, itemId: wrath, activityId: "9U9AoJYvcrCQtIMm", area: { shape: "rectangle", ...box }, usageConfig: { [MODULE_ID]: { confirmed: true } } });
        if ( u.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: u.regionId }).catch(() => {}));
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 20000 }).catch(() => null);
        const t = r?.targets?.find(x => x.name === "Bandit");
        if ( !r ) { ctx.expect(false, "résolution non tranchée (20 s)"); break; }
        if ( !t?.save || t.save.success ) continue;
        await pause(2000);
        const pos = await ctx.position(bandit);
        const moved = Math.round(Math.hypot(pos.x - pos0.x, pos.y - pos0.y) / grid);
        if ( process.env.DEBUG ) ctx.log(`plan : ${JSON.stringify(r.plan.steps)} ; cible ${JSON.stringify(t).slice(0, 300)}`);
        ctx.expect(moved === 3, `sauvegarde ratée (${t.save.total}) : le Bandit recule de ${moved} case(s) (attendu 3 = 15 ft)`);
        checked = true;
      }
      ctx.expect(checked, "une sauvegarde ratée (20 essais au plus)");
      await unlend(wrath);
    });

    // §438 continued: Handbook 3.0.0 — the manifestation (utility) chains the save without a second Bonus Action; at level 14, on
    // another creature ("Another"): the list opens around it, it excepted; on the following turns, the save alone also
    // offers the creatures around whoever carries the item's effect.
    await part("Courroux des mers enchaîné", async () => {
      const wrath = await lend("phbdrdWrathOfThe");
      const acts = ((await ctx.call("get-actor", { actorId: hero.actorId })).items ?? []).find(i => i._id === wrath)?.system?.activities ?? {};
      if ( acts.nNTYj4vqURV4Dhjt?.type !== "utility" || !acts.ituofBRxXKLI7wNW ) { ctx.log("Courroux des mers 2.2.0 : enchaînement non applicable"); await unlend(wrath); return; }
      // Level 14 Druid for the duration of the game (level gate of "Another", 3 m radius).
      const cls = await ctx.call("upsert-actor-item", { actorId: hero.actorId,
        itemData: { name: "Druid", type: "class", system: { identifier: "druid", levels: 14 } }, match: { path: "system.identifier", value: "druid" } });
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: hero.actorId, itemId: cls.id }).catch(() => {}));
      const mage = tokens.some(t => t.name === "Magicien") ? await ctx.token("Magicien") : null;
      const m0 = mage ? await ctx.position(mage) : null;
      if ( mage ) ctx.restore(() => ctx.call("move-token", { tokenId: mage.id, x: m0.x, y: m0.y, elevation: m0.elevation ?? 0 }).catch(() => {}));
      if ( mage ) ctx.restore(() => ctx.removeEffectsNamed(mage, /Tempétueux|Stormborn|Courroux|Wrath/i));
      await tough();
      const known = async () => (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
      /** The list that follows: its creatures, then "Confirm" (the Bandit, an enemy, pre-checked). */
      const pickList = async ids => {
        for ( const stop = Date.now() + 12000; Date.now() < stop; ) {
          const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: ids, waitMs: 1500, details: true }).catch(() => null);
          const d = (r?.windows ?? []).find(w => (w.buttons ?? []).some(b => b.action === "ok"));
          if ( d ) { const text = JSON.stringify(d); await ctx.call("answer-dialog", { id: d.id, button: "ok" }); return text; }
        }
        return null;
      };
      /** Manifests (without spending Wild Shape: the Fighter has none), answers the list, returns the save that followed. */
      const manifest = async (activityId, targets=[]) => {
        const ids = await known();
        const since = await ctx.lastMessageId();
        await ctx.use({ tokenId: hero.id, itemId: wrath, activityId, targetTokenIds: targets.map(t => t.id),
          usageConfig: { consume: false, create: { measuredTemplate: false } } });
        const list = await pickList(ids);
        await pause(1500);
        // The save: the use that targets the Bandit (the manifestation targets nobody, or the Wizard).
        const msg = (await ctx.messagesSince(since)).find(m => (m.type === "usage") && (m.targets ?? []).some(t => t.name === "Bandit"));
        const r = msg ? await ctx.settle(msg.id, { timeoutMs: 20000 }).catch(() => null) : null;
        return { list, msg, r };
      };
      // 1. On oneself: the Bandit in contact.
      await place(hero, 3080, 4900);
      await place(bandit, 3080, 5040);
      const self = await manifest("nNTYj4vqURV4Dhjt");
      ctx.expect(!!self.list && /Bandit/.test(self.list), "manifestation sur soi : la liste s'ouvre aussitôt, le Bandit dedans");
      ctx.expect(self.msg?.flags?.[MODULE_ID]?.cost === "free", `la sauvegarde suit sans seconde action Bonus (coût ${self.msg?.flags?.[MODULE_ID]?.cost})`);
      ctx.expect(self.r?.plan?.save?.ability === "con" && !!self.r?.targets?.find(x => x.name === "Bandit")?.save, "sauvegarde de Constitution du Bandit");
      await remettre();
      // 2. On another creature (level 14): the Wizard, the Bandit 3 m from them and 4.50 m from the druid.
      if ( !mage ) { ctx.log("Magicien absent : « Another » non joué"); }
      else {
        await place(hero, 3080, 4760);
        await place(mage, 3080, 4900);
        await place(bandit, 3080, 5180);
        const other = await manifest("ituofBRxXKLI7wNW", [mage]);
        ctx.expect(!!other.list && /Bandit/.test(other.list) && !/Magicien/.test(other.list), "« Another » : la liste autour du Magicien, lui excepté, le Bandit dedans");
        ctx.expect(other.msg?.flags?.[MODULE_ID]?.cost === "free" && !!other.r?.targets?.find(x => x.name === "Bandit")?.save, "« Another » : la sauvegarde du Bandit suit, sans action de plus");
        // 3. On the next turn, the save alone: the Bandit (out of the druid's range) offered, if it carries the effect —
        // otherwise said.
        await place(bandit, 3080, 5180);   // a failed save pushed it back 4.50 m
        const carries = (await ctx.effects(mage)).some(e => !e.disabled && /Tempétueux|Stormborn/i.test(e.name ?? ""));
        const pick = await ctx.engine("pickTargets", { tokenId: hero.id, itemId: wrath, activityId: "9U9AoJYvcrCQtIMm" });
        const listed = (pick?.creatures ?? []).some(c => c.name === "Bandit");
        ctx.expect(carries ? listed : !listed, `tour suivant : le Bandit proposé ⇔ le Magicien porte l'effet (effet : ${carries}, proposé : ${listed}, centres : ${(pick?.centers ?? []).join(", ")})`);
        if ( process.env.DEBUG || (carries !== listed) ) ctx.log(`effets du Magicien : ${JSON.stringify((await ctx.effects(mage)).map(e => ({ name: e.name, origin: e.origin, sys: e.system?.origin })))}`);
      }
      await unlend(wrath);
    });
  }
};
