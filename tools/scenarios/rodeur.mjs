/**
 * The Ranger from the 2024 Player's Handbook (SPEC §26), world `dnd-6`. The Fighter receives, lent from the Player's Handbook
 * compendium, the Ranger class at level 5, the Gloom Stalker subclass, Dread Ambusher, Hunter's Prey and
 * Hunter's Mark; the Bandit receives 300 HP. Checks:
 *  - Hunter's Mark placed on the Bandit: +1d6 force on every hit;
 *  - Dreadful Strike (§223, #12): offered before damage; refused, nothing; accepted, +2d6 psychic and one use spent,
 *    no longer offered on the next hit of the same turn;
 *  - Colossus Slayer: +1d8 once per turn, only against a wounded target (not on the first hit, the Bandit is unhurt);
 *  - Relentless Hunter (lent afterwards): the Mark goes to 1d10, without the 1d6;
 *  - Precise Hunter (lent afterwards): the attack against the marked creature has Advantage.
 * Puts back positions, HP, conditions; removes the lent items.
 */
const MODULE_ID = "dnd5e-combat";
const CLASSES = "dnd-players-handbook.classes";
const SPELLS = "dnd-players-handbook.spells";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "rodeur — Marque du chasseur, Frappe effroyable, Tueur de colosses, Tueur implacable, Chasseur précis",

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
    const lend = async (pack, id) => {
      const uuid = `Compendium.${pack}.Item.${id}`;
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      // Issue #145: an unprepared spell no longer declares anything (the Mark lost its 1d6 force) — the lent spell is prepared.
      if ( itemData.type === "spell" ) setPath(itemData, "system.prepared", 1);
      const r = await ctx.call("upsert-actor-item", { actorId: hero.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: hero.actorId, itemId: r.id }).catch(() => {}));
      return r.id;
    };
    const cls = await lend(CLASSES, "phbrgrRanger0000");
    await ctx.call("upsert-actor-item", { actorId: hero.actorId, itemData: { "system.levels": 5 }, match: { path: "_id", value: cls } });
    await lend(CLASSES, "phbrgrGloomStalk");
    await lend(CLASSES, "phbrgrDreadAmbus");
    await lend(CLASSES, "phbrgrHuntersPre");
    const mark = await lend(SPELLS, "phbsplHuntersMar");

    const remettre = async () => {
      for ( const [id, h] of homes ) {
        const t = tokens.find(x => x.id === id);
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        await ctx.removeEffectsNamed(t, /Marque du chasseur|Hunter's Mark|Sape|Sap|Concentrat/i);
        if ( id !== bandit.id ) await ctx.setHp(t, h.hp);
      }
    };
    ctx.restore(remettre);
    const part = async (name, fn) => {
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
    const markBandit = async () => {
      const u = await ctx.use({ tokenId: hero.id, itemId: mark, activityId: "vxr2JKuQ3jyMDTwb", targetTokenIds: [bandit.id], usageConfig: { [MODULE_ID]: { confirmed: true } } });
      await ctx.settle(u.usageMessageId, { timeoutMs: 20000 }).catch(() => null);
      await pause(2000);
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
      return (data.delta?.effects ?? []).some(e => /Marque du chasseur|Hunter's Mark/i.test(e.name));
    };
    // §223 (#12): Dreadful Strike is offered in the "On Hit" window before damage; `dread` answers it (true: checked,
    // false: "None of the above", null: no window expected).
    const known = async () => (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    const hitDialog = async (ids, waitMs=8000) => {
      for ( const until = Date.now() + waitMs; Date.now() < until; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: ids, waitMs: 2000 }).catch(() => null);
        const d = (r?.windows ?? []).find(w => /Au toucher|On hit/i.test(w.title ?? ""));
        if ( d ) return d;
      }
      return null;
    };
    const dreadUses = async () => {
      const actor = await ctx.call("get-actor", { actorId: hero.actorId });
      const item = (actor.items ?? []).find(i => i.system?.identifier === "dread-ambusher");
      // §438: Handbook 3.0.0 — the activity consumes the item's uses (its own are empty).
      const act = item?.system?.activities?.DMVf7FTyTC2HCAf9;
      const ownUses = (act?.uses?.max ?? "") !== "";
      return ownUses ? (act?.uses?.spent ?? null) : (item?.system?.uses?.spent ?? null);
    };
    /** Attacks until it hits (10 tries); returns the attack roll, the damage roll, its bonus damage and the window seen. */
    const hit = async ({ fresh=false, dread=null }={}) => {
      for ( let n = 0; n < 10; n++ ) {
        // A miss with the greatsword still wounds (Graze mastery property): the Bandit is put back unhurt before each try.
        if ( fresh ) await tough();
        const since = await ctx.lastMessageId();
        const ids = await known();
        const u = await ctx.use({ tokenId: hero.id, itemId: sword, activityType: "attack", targetTokenIds: [bandit.id], usageConfig: { [MODULE_ID]: { confirmed: true } } });
        let dialog = null;
        for ( const until = Date.now() + 20000; Date.now() < until; await pause(400) ) {
          const res = await ctx.resolution(u.usageMessageId);
          const t = res?.targets?.find(x => x.name === bandit.name);
          if ( t?.hit === false || ["done", "missed", "undone"].includes(res?.step) ) break;
          if ( t?.hit === true ) {
            dialog = await hitDialog(ids, (dread === null) ? 3000 : 8000);
            if ( dialog ) await ctx.call("answer-dialog", { id: dialog.id, ...(dread ? { fields: { "bonus-dread-ambusher": true }, button: "strike" } : { button: "none" }) });
            break;
          }
        }
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        const msgs = await ctx.messagesSince(since);
        const attack = msgs.find(m => m.type === "attack")?.rolls?.[0]?.formula ?? "";
        if ( r?.targets?.find(t => t.name === bandit.name)?.hit !== true ) continue;
        await pause(1000);
        const damage = (await ctx.messagesSince(since)).find(m => m.type === "damage");
        const bonuses = (damage?.flags?.[MODULE_ID]?.bonuses ?? []).map(b => `${b.formula} ${b.damageType}`);
        const rolls = (damage?.rolls ?? []).map(r => r.formula);
        return { attack, bonuses, rolls, dialog };
      }
      return null;
    };

    await part("Marque, Frappe effroyable, Tueur de colosses", async () => {
      await tough(); await place(bandit, g.x + grid, g.y);
      if ( !ctx.expect(await fight(), "combat : au tour du Guerrier") ) return;
      ctx.expect(await markBandit(), "le Bandit porte la Marque du chasseur");
      const spent0 = await dreadUses();
      // Refused on the first hit: no psychic damage and no use spent.
      const declined = await hit({ fresh: true, dread: false });
      if ( !ctx.expect(!!declined, "coup refusé (10 essais au plus)") ) return;
      ctx.expect(!!declined.dialog && !declined.bonuses.some(b => /dreadful-strike| psychic$/.test(b)) && declined.bonuses.includes("1d6 force"),
        `Frappe effroyable proposée (${declined.dialog?.title ?? "aucune fenêtre"}) et refusée : ${declined.bonuses.join(", ")}`);
      ctx.expect((await dreadUses()) === spent0, `refusée : aucune utilisation dépensée (${spent0})`);
      // Accepted on the next hit of the same turn: +2d6 psychic, one use spent.
      const first = await hit({ fresh: true, dread: true });
      if ( !ctx.expect(!!first, "premier coup (10 essais au plus)") ) return;
      ctx.expect(first.bonuses.includes("1d6 force") && first.bonuses.some(b => /dreadful-strike psychic|^2d6 psychic$/.test(b)) && first.rolls.includes("2d6") && !first.bonuses.includes("1d8 slashing"),
        `Frappe effroyable acceptée, Bandit indemne : ${first.bonuses.join(", ")} ; jets ${first.rolls.join(" + ")}`);
      await pause(1000);
      ctx.expect((await dreadUses()) === (spent0 ?? 0) + 1, `une utilisation dépensée (${spent0} → ${await dreadUses()})`);
      const second = await hit();
      if ( !ctx.expect(!!second, "second coup (10 essais au plus)") ) return;
      ctx.expect(!second.dialog && second.bonuses.includes("1d6 force") && !second.bonuses.some(b => /dreadful-strike| psychic$/.test(b)) && second.bonuses.includes("1d8 slashing"),
        `second coup du tour, sans question, Bandit blessé : ${second.bonuses.join(", ")}`);
    });

    await part("Tueur implacable, Chasseur précis", async () => {
      await lend(CLASSES, "phbrgrFoeSlayer0");
      await lend(CLASSES, "phbrgrPreciseHun");
      await tough(); await place(bandit, g.x + grid, g.y);
      ctx.expect(await markBandit(), "le Bandit porte la Marque du chasseur");
      const res = await hit({ dread: false });
      if ( !ctx.expect(!!res, "un coup (10 essais au plus)") ) return;
      ctx.expect(res.bonuses.includes("1d10 force") && !res.bonuses.includes("1d6 force"), `Tueur implacable : ${res.bonuses.join(", ")}`);
      ctx.expect(/adv|kh/.test(res.attack), `Chasseur précis : ${res.attack}`);
    });
  }
};
