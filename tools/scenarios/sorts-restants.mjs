/**
 * Three coded spells never played (issues #4 and #5, 2026-09-27); spells added at will for the scenario:
 *  1. Hellish Rebuke (Cleric): the Zombie hits him; the Reaction goes off outright (`autoReact: "first"`) against the
 *     Zombie — Dexterity saving throw, fire damage full or half.
 *  2. Arcane Vigor (Wizard, wounded): the "how many Hit Dice" window opens on the GM's side, the scenario
 *     answers it (connector: list-dialogs, answer-dialog); one Hit Die spent, HP go up by the roll.
 *  3. Misty Step (Wizard): a destination at 20 ft is accepted and the token teleports there; at 45 ft (beyond the
 *     30 ft), refused; on the Zombie's cell (occupied), refused — by the engine's checkpoint (`dnd5e.teleport`),
 *     played by `api.mcp.teleport`: only the click of the core's planning is not.
 * Puts back HP, Hit Dice, effects and positions.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const total = m => (m?.rolls ?? []).reduce((sum, r) => sum + (((typeof r === "string") ? JSON.parse(r) : r)?.total ?? 0), 0);

export default {
  name: "sorts restants — Représailles infernales, Vigueur arcanique, Foulée brumeuse",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const needed = ["Clerc", "Magicien", "Zombi"];
    if ( !needed.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${needed.join(", ")} : l'un manque, non applicable`); return; }
    const [cleric, mage, zombi] = await Promise.all(needed.map(n => ctx.token(n)));
    const all = [cleric, mage, zombi];
    const grid = await ctx.gridSize();
    const atWill = { system: { method: "atwill" } };
    await ctx.ensureItem(cleric, PHB + "phbsplHellishReb", atWill);
    await ctx.ensureItem(mage, PHB + "phbsplArcaneVigo", atWill);
    await ctx.ensureItem(mage, PHB + "phbsplMistyStep0", atWill);

    const hp0 = new Map();
    const effects0 = new Map();
    const home = new Map();
    for ( const t of all ) {
      hp0.set(t.id, await ctx.hp(t));
      effects0.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id)));
      home.set(t.id, await ctx.position(t));
    }
    const mageClass = ((await ctx.call("get-actor", { actorId: mage.actorId })).items ?? []).find(i => i.type === "class");
    const spent0 = mageClass?.system?.hd?.spent ?? 0;
    const targetOf = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      const sceneId = (await ctx.scene()).sceneId;
      return data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${sceneId}.Token.${t.id}.Actor.${data.actorId}` };
    };
    const reset = async () => {
      for ( const t of all ) {
        const target = await targetOf(t);
        for ( const e of (await ctx.effects(t)).filter(e => !effects0.get(t.id).has(e._id ?? e.id) && !e.flags?.["dnd5e-combat"]?.aura) ) {
          await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
        }
        await ctx.setHp(t, hp0.get(t.id));
        const now = await ctx.position(t);
        const h = home.get(t.id);
        if ( (now.x !== h.x) || (now.y !== h.y) ) await ctx.call("move-token", { tokenId: t.id, x: h.x, y: h.y, elevation: h.elevation }).catch(() => {});
      }
      if ( mageClass ) await ctx.call("upsert-actor-item", { actorId: mage.actorId, match: { path: "_id", value: mageClass._id },
        itemData: { system: { hd: { spent: spent0 } } } }).catch(() => {});
      await pause(800);
    };
    ctx.restore(reset);
    const part = async (label, fn) => {
      try { await fn(); }
      catch(err) { ctx.expect(false, `${label} : ${err.message}`); }
      finally { await reset(); }
    };

    // 1. Hellish Rebuke.
    await part("Représailles infernales", async () => {
      const zItems = (await ctx.call("get-actor", { actorId: zombi.actorId })).items ?? [];
      const weapon = zItems.find(i => (i.type === "weapon") && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack"));
      const p = await ctx.position(cleric);
      await ctx.call("move-token", { tokenId: zombi.id, x: p.x - grid, y: p.y, elevation: p.elevation });
      await pause(1000);
      let rebuke = null;
      // HP at maximum for the duration of the test: dropped to 0 by the hit, the Cleric would no longer react (seen on
      // 2026-10-20: 6 HP left by a run). The maximum computed by dnd5e (a PC sheet does not store it: `hp.max` is null in the
      // source — seen on 2026-10-26, the Cleric left at 6 HP was "put back" to 6 and dropped on the first hit).
      const clericMax = (await ctx.engine("stats", { tokenId: cleric.id }))?.hp?.max ?? hp0.get(cleric.id);
      for ( let i = 0; (i < 20) && !rebuke; i++ ) {
        await ctx.setHp(cleric, Math.max(clericMax, hp0.get(cleric.id)));
        await ctx.setHp(zombi, 60);
        const since = await ctx.lastMessageId();
        const used = await ctx.use({ tokenId: zombi.id, itemId: weapon._id, activityType: "attack", targetTokenIds: [cleric.id],
          usageConfig: { [MODULE_ID]: { autoReact: "first" } } });
        const r = await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        if ( !r?.targets?.find(t => t.name === "Clerc")?.hit ) continue;
        await pause(4000);
        const reaction = (await ctx.messagesSince(since)).find(m => (m.type === "usage") && (m.id !== used.usageMessageId) && /^Clerc/.test(m.alias ?? ""));
        if ( !ctx.expect(!!reaction, "le Zombi touche le Clerc : Représailles infernales part en réaction") ) return;
        rebuke = { reaction, res: await ctx.settle(reaction.id, { timeoutMs: 45000 }).catch(() => null) };
      }
      if ( !ctx.expect(!!rebuke, "le Zombi touche le Clerc (20 essais au plus)") ) return;
      const t = rebuke.res?.targets?.find(x => x.name === "Zombi");
      if ( !ctx.expect(!!t?.save, `la réaction vise le Zombi, qui sauvegarde (${t?.save?.total ?? "aucune"} contre DD ${rebuke.res?.plan?.save?.dc})`) ) return;
      const rolled = total((await ctx.messagesSince(rebuke.reaction.id)).find(m => m.type === "damage"));
      const expected = t.save.success ? Math.floor(rolled / 2) : rolled;
      ctx.expect((rolled > 0) && (t.damage?.applied === expected), `dégâts de feu ${t.save.success ? "moitié" : "entiers"} : ${t.damage?.applied} pour ${rolled}`);
    });

    // 2. Vigueur arcanique.
    await part("Vigueur arcanique", async () => {
      if ( !ctx.expect(!!mageClass, "le Magicien a une classe (dés de vie)") ) return;
      await ctx.setHp(mage, 1);
      const known = (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
      const used = await ctx.use({ tokenId: mage.id, identifier: "arcane-vigor", activityId: "5paXkJ6hEw07yl8g", consume: false, targetTokenIds: [mage.id] });
      let dialog = null;
      for ( let n = 0; (n < 3) && !dialog; n++ ) dialog = (await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: known, waitMs: 6000 })).windows[0] ?? null;
      const buttons = dialog?.buttons ?? [];
      if ( !ctx.expect(!!dialog && buttons.length > 0, `la fenêtre des dés de vie s'ouvre (${dialog?.title ?? "aucune"} : ${buttons.map(b => b.label).join(", ")})`) ) return;
      const since = used.usageMessageId;
      await ctx.call("answer-dialog", { id: dialog.id, button: buttons[0].action ?? buttons[0].label });
      await pause(3000);
      const heal = total((await ctx.messagesSince(since)).find(m => /Vigueur|Vigor/i.test(m.flavor ?? "")));
      const after = await ctx.hp(mage);
      const cls = ((await ctx.call("get-actor", { actorId: mage.actorId })).items ?? []).find(i => i._id === mageClass._id);
      ctx.expect((cls?.system?.hd?.spent ?? spent0) === spent0 + 1, `un dé de vie dépensé (${spent0} → ${cls?.system?.hd?.spent})`);
      ctx.expect((heal > 0) && (after > 1), `les PV remontent du jet : 1 → ${after} (jet ${heal})`);
    });

    // 3. Misty Step.
    await part("Foulée brumeuse", async () => {
      const itemId = await ctx.itemId(mage.id, "misty-step");
      const start = await ctx.position(mage);
      let near = null;
      let dir = null;
      for ( const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] ) {
        const r = await ctx.engine("teleport", { tokenId: mage.id, itemId, x: start.x + (dx * 4 * grid), y: start.y + (dy * 4 * grid) });
        if ( r.accepted ) { near = r; dir = [dx, dy]; break; }
      }
      if ( !ctx.expect(!!near, `destination à 20 ft acceptée, téléporté en (${near?.position?.x}, ${near?.position?.y})`) ) return;
      ctx.expect((near.position.x === start.x + (dir[0] * 4 * grid)) && (near.position.y === start.y + (dir[1] * 4 * grid)), "le token est bien à la destination");
      await ctx.call("move-token", { tokenId: mage.id, x: start.x, y: start.y, elevation: start.elevation });
      await pause(1000);
      const far = await ctx.engine("teleport", { tokenId: mage.id, itemId, x: start.x + (dir[0] * 9 * grid), y: start.y + (dir[1] * 9 * grid) });
      ctx.expect(!far.accepted && (far.position.x === start.x) && (far.position.y === start.y), `destination à 45 ft refusée, le token ne bouge pas`);
      // The Zombie placed at 10 ft, in the accepted direction: only the occupied cell can refuse.
      const zx = start.x + (dir[0] * 2 * grid);
      const zy = start.y + (dir[1] * 2 * grid);
      await ctx.call("move-token", { tokenId: zombi.id, x: zx, y: zy, elevation: start.elevation });
      await pause(1000);
      const onZombi = await ctx.engine("teleport", { tokenId: mage.id, itemId, x: zx, y: zy });
      ctx.expect(!onZombi.accepted, "destination sur la case du Zombi (occupée, à 10 ft) refusée");
    });
  }
};
