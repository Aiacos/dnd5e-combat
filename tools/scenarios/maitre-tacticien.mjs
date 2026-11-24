/**
 * Tactical Master (Fighter 9, PHB 2024; Core journal §537, issue #160), world `dnd-6`. The Fighter receives Tactical Master, lent
 * from the Player's Handbook compendium (its effect adds Push, Sap and Slow to `weaponProf.mastery.bonus`); the Bandit gets 300 HP.
 * Checks, with fast attacks (no dnd5e attack window; the mastery used is read from dnd5e's per-weapon memo):
 *  - the Fighter's own token menu offers « Mastery: <greatsword> (Graze) »; the choice window, answered « Sap », stores Sap on the
 *    weapon and the menu now reads Sap;
 *  - a hit with the greatsword then uses Sap (attack card, Sap mark on the Bandit), without any question;
 *  - the choice stays: a second hit uses Sap again;
 *  - set back to the weapon's own mastery, the greatsword uses Graze again.
 * Restores the weapon flag, positions, HP; removes the lent item.
 */
const MODULE_ID = "dnd5e-combat";
const CLASSES = "dnd-players-handbook.classes";
const TACTICAL_MASTER = "phbftrTacticalMa";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "maitre-tacticien — standing mastery per weapon, chosen from the token menu (issue #160)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Guerrier", "Bandit"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} required: not applicable`); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes(CLASSES) ) { ctx.log("Player's Handbook missing: not applicable"); return; }
    const fighter = await ctx.token("Guerrier");
    const bandit = await ctx.token("Bandit");
    const grid = await ctx.gridSize();
    const homes = new Map();
    for ( const t of [fighter, bandit] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    const g = homes.get(fighter.id).pos;

    const sword = await ctx.itemId(fighter.id, "greatsword");
    const swordItem = () => ctx.call("get-actor", { actorId: fighter.actorId }).then(a => (a.items ?? []).find(i => (i._id ?? i.id) === sword));
    const swordName = (await swordItem())?.name ?? "greatsword";
    const setStanding = value => ctx.call("upsert-actor-item", { actorId: fighter.actorId, match: { path: "_id", value: sword },
      itemData: value ? { [`flags.${MODULE_ID}.standingMastery`]: value } : { [`flags.${MODULE_ID}.-=standingMastery`]: null } });
    ctx.restore(() => setStanding(null).catch(() => {}));
    // The connector does not show an attack card's mastery: dnd5e writes it on the weapon after each attack
    // (`flags.dnd5e.last.<activity>.mastery`, documents/activity/attack.mjs), cleared before each attack and put back at the end.
    const last0 = (await swordItem())?.flags?.dnd5e?.last ?? null;
    const setLast = value => ctx.call("upsert-actor-item", { actorId: fighter.actorId, match: { path: "_id", value: sword },
      itemData: value ? { "flags.dnd5e.last": value } : { "flags.dnd5e.-=last": null } });
    ctx.restore(() => setLast(null).then(() => (last0 ? setLast(last0) : null)).catch(() => {}));
    const lastMastery = async () => Object.values((await swordItem())?.flags?.dnd5e?.last ?? {}).map(l => l?.mastery).find(Boolean) ?? null;

    const { data: bdata } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    const max0 = bdata.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
      data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
    const tough = () => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });

    const place = async (t, x, y) => { await ctx.call("move-token", { tokenId: t.id, x, y, elevation: 0 }); await pause(700); };
    const remettre = async () => {
      for ( const [id, h] of homes ) {
        const t = tokens.find(x => x.id === id);
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        await ctx.removeEffectsNamed(t, /^(Sape|Sap|Ouverture|Vex|Ralentissement|Slow|Attaques avisées|Studied Attacks) /i);
        if ( id !== bandit.id ) await ctx.setHp(t, h.hp);
      }
    };
    ctx.restore(remettre);

    // Tactical Master, lent from the Player's Handbook.
    const uuid = `Compendium.${CLASSES}.Item.${TACTICAL_MASTER}`;
    const { data } = await ctx.call("get-compendium-entry", { uuid });
    const { _id, folder, ownership, _stats, ...itemData } = data;
    setPath(itemData, "flags.dnd5e.sourceId", uuid);
    const lent = await ctx.call("upsert-actor-item", { actorId: fighter.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: fighter.actorId, itemId: lent.id }).catch(() => {}));
    await pause(1000);

    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name}: ${err.message}`); }
      await remettre();
      await pause(1000);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${name}: no error in the GM console${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };

    // §516: the Fighter's Savage Attacker "On hit" window, confirmed as is.
    const savageDialog = d => /Savage Attacker|Sauvagerie martiale/i.test(`${d.title ?? ""} ${d.content ?? d.text ?? ""}`);
    const attack = async target => {
      await setLast(null);
      const known = (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
      const asked = [];
      const u = await ctx.use({ tokenId: fighter.id, itemId: sword, activityType: "attack", targetTokenIds: [target.id] });
      let done = false;
      const watch = (async () => {
        while ( !done ) {
          const w = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: known, waitMs: 1500, details: true }).catch(() => null);
          for ( const d of (w?.windows ?? []) ) {
            known.push(d.id);
            if ( !savageDialog(d) ) { asked.push(d.title ?? d.id); continue; }
            const b = (d.buttons ?? []).find(x => /Confirm|Frapper|Valider/i.test(x.label ?? ""));
            await ctx.call("answer-dialog", { id: d.id, button: b?.action ?? b?.label }).catch(() => {});
          }
        }
      })();
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      done = true;
      await watch;
      await pause(1500);
      return { hit: r?.targets?.find(t => t.name === target.name)?.hit ?? null, asked, mastery: await lastMastery() };
    };
    const until = async (want, fn, tries=20) => { for ( let i = 0; i < tries; i++ ) { const a = await fn(); if ( a.hit === want ) return a; } return null; };
    const sapped = async () => (await ctx.effects(bandit)).some(e => e.flags?.[MODULE_ID]?.mastery?.kind === "sap");
    const menuEntry = async () => (await ctx.engine("menu", { tokenId: fighter.id, targetId: fighter.id })).labels.find(l => l.includes(swordName)) ?? null;

    await part("menu choice", async () => {
      await setStanding(null);
      const entry = await menuEntry();
      if ( !ctx.expect(!!entry, `own token menu offers the greatsword's mastery (${entry})`) ) return;
      const known = (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
      await ctx.engine("menu", { tokenId: fighter.id, targetId: fighter.id, run: entry });
      const w = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: known, waitMs: 5000, details: true });
      const d = w?.windows?.[0];
      const sap = (d?.buttons ?? []).find(b => (b.action === "sap"));
      if ( !ctx.expect(!!sap, `choice window with Sap (${(d?.buttons ?? []).map(b => b.action).join(", ")})`) ) return;
      ctx.expect((d.buttons ?? []).some(b => b.action === "push") && (d.buttons ?? []).some(b => b.action === "slow"), "Push and Slow offered too");
      await ctx.call("answer-dialog", { id: d.id, button: "sap" });
      await pause(1500);
      const stored = (await swordItem())?.flags?.[MODULE_ID]?.standingMastery ?? null;
      ctx.expect(stored === "sap", `Sap stored on the greatsword (${stored})`);
      const now = await menuEntry();
      ctx.expect(/Sap|Sape/.test(now ?? ""), `the menu now reads Sap (${now})`);
    });

    await part("Sap at every attack, no question", async () => {
      await setStanding("sap"); await tough(); await place(bandit, g.x + grid, g.y);
      const a = await until(true, () => attack(bandit));
      if ( !ctx.expect(!!a, "greatsword: hit (20 tries at most)") ) return;
      ctx.expect(a.mastery === "sap", `attack card mastery: ${a.mastery}`);
      ctx.expect(await sapped(), "the Bandit carries Sap");
      ctx.expect(!a.asked.length, `no question asked (${a.asked.join(", ")})`);
      await ctx.removeEffectsNamed(bandit, /^(Sape|Sap) /i);
      const b = await until(true, () => attack(bandit));
      ctx.expect(b?.mastery === "sap", `the choice stays: second hit uses ${b?.mastery}`);
    });

    await part("back to the weapon's own", async () => {
      await setStanding(null); await tough(); await place(bandit, g.x + grid, g.y);
      const a = await attack(bandit);
      ctx.expect(a.mastery === "graze", `without a choice the greatsword uses its own mastery (${a.mastery})`);
    });
  }
};
