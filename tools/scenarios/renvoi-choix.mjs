/**
 * §293: Turn Undead, "each Undead of your choice within 9 m", world `dnd-6`, Test Arena. The Cleric (level 1) receives,
 * lent from the Player's Handbook compendium, Channel Divinity (two uses) and Sear Undead; the Zombie, the Bandit and the
 * Fighter are placed within 9 m at most, the Wizard beyond. Checks:
 *  - the list: the only Undead in range (the Zombie; neither the Bandit nor the Fighter, Humanoids, nor the Wizard, too far),
 *    checked in advance if they are hostile; Sear Undead offered instead;
 *  - Turn Undead on the Zombie alone: a Wisdom save, Turned if it fails, no damage;
 *  - box checked: Sear Undead goes off on the Zombie and the Bandit, with no area — the Bandit (Humanoid) is not affected,
 *    the Zombie that fails takes the radiant damage; one use of Channel Divinity spent.
 * §438: with Handbook 3.0.0, Sear Undead is a Channel Divinity activity visible at Cleric level 5: at level 1 it is not
 * offered; the Cleric goes to level 5 for the scenario (restored afterwards).
 * Restores positions, HP, effects, level; removes the lent items.
 */
const CLASSES = "dnd-players-handbook.classes";
const TURN = "aOptL5pMaj3WtR8S";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "renvoi-choix — Renvoi des morts-vivants : liste des créatures à 9 m, Calcination à la place",

  async run(ctx) {
    const { tokens, sceneId } = await ctx.scene();
    const need = ["Clerc", "Zombi", "Bandit", "Guerrier", "Magicien"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes(CLASSES) ) { ctx.log("Manuel des joueurs absent : non applicable"); return; }
    const [cleric, zombi, bandit, fighter, wizard] = await Promise.all(need.map(n => ctx.token(n)));
    const grid = await ctx.gridSize();
    for ( const t of [zombi, bandit] ) { const hp = await ctx.hp(t); ctx.restore(() => ctx.setHp(t, hp)); }

    const lend = async (id, extra=null) => {
      const uuid = `Compendium.${CLASSES}.Item.${id}`;
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      if ( extra ) for ( const [k, v] of Object.entries(extra) ) setPath(itemData, k, v);
      const r = await ctx.call("upsert-actor-item", { actorId: cleric.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: cleric.actorId, itemId: r.id }).catch(() => {}));
      return r.id;
    };
    const channel = await lend("phbclcChannelDiv", { "system.uses.max": "9", "system.uses.spent": 0 });
    await lend("phbclcSearUndead");
    // §438: Handbook 3.0.0's Sear Undead (Channel Divinity activity, level 5 gate).
    const sheetOf = async () => (await ctx.call("get-actor", { actorId: cleric.actorId })).items ?? [];
    const gated = !!(await sheetOf()).find(i => i._id === channel)?.system?.activities?.rprxorXdFoHbRERZ;
    const cls = (await sheetOf()).find(i => (i.type === "class") && (i.system?.identifier === "cleric"));
    if ( gated && cls ) {
      const levels0 = cls.system.levels;
      const setLevel = n => ctx.call("upsert-actor-item", { actorId: cleric.actorId, itemData: { "system.levels": n }, match: { path: "_id", value: cls._id } });
      ctx.restore(() => setLevel(levels0).catch(() => {}));
      if ( levels0 < 5 ) {
        const low = await ctx.engine("pickTargets", { tokenId: cleric.id, itemId: channel, activityId: TURN });
        ctx.expect(!low.upgrade, `niveau ${levels0} : la Calcination du Manuel 3.0.0 (niveau 5) n'est pas proposée (${low.upgrade ?? "rien"})`);
        await setLevel(5);
        await pause(800);
      }
    }

    // The Cleric in the center, three creatures within 9 m at most (6 cells), the Wizard at 8 cells.
    const c = await ctx.position(cleric);
    const place = (t, dx, dy) => ctx.call("move-token", { tokenId: t.id, x: c.x + (dx * grid), y: c.y + (dy * grid), elevation: 0 });
    await place(zombi, -3, 0); await place(bandit, 0, -6); await place(fighter, 2, 2); await place(wizard, -8, 0);
    await pause(1200);

    const list = await ctx.engine("pickTargets", { tokenId: cleric.id, itemId: channel, activityId: TURN });
    const names = (list.creatures ?? []).map(x => x.name);
    ctx.expect(names.includes("Zombi") && !["Bandit", "Guerrier", "Magicien", "Clerc"].some(n => names.includes(n)),
      `liste à ${list.radius} ${list.units} : ${(list.creatures ?? []).map(x => `${x.name}${x.enemy ? " ✓" : ""} (${x.distance})`).join(", ")}`);
    const enemy = n => list.creatures?.find(x => x.name === n)?.enemy;
    ctx.expect(enemy("Zombi") === true, "le Zombi, hostile, coché d'avance");
    ctx.expect(!!list.upgrade, `Calcination proposée à la place (« ${list.upgrade ?? "rien"} »)`);

    const zombiUuid = `Scene.${sceneId}.Token.${zombi.id}.Actor.${zombi.actorId}`;
    const clearEffects = async () => {
      for ( const e of await ctx.effects(zombi) ) await ctx.call("remove-embedded-effect", { uuid: zombiUuid, effectId: e._id }).catch(() => {});
    };
    const turned = async () => (await ctx.effects(zombi)).some(e => (e.statuses ?? []).includes("frightened"));

    // 1. Turn Undead on the Zombie alone, until a failed save.
    let z = null;
    for ( let n = 1; (n <= 8) && (z?.save?.success !== false); n++ ) {
      await clearEffects();
      await ctx.setHp(zombi, 100);
      const r = await ctx.engine("castPicked", { tokenId: cleric.id, itemId: channel, activityId: TURN, targetIds: [zombi.id] });
      if ( !ctx.expect(!!r.usageMessageId, `Renvoi utilisé (essai ${n})`) ) return;
      const res = await ctx.settle(r.usageMessageId);
      z = res.targets.find(t => t.token.endsWith(zombi.id));
      if ( n === 1 ) ctx.expect(res.targets.length === 1, `une seule cible, le Zombi (${res.targets.length})`);
    }
    ctx.expect(z?.save?.success === false, `Renvoi : le Zombi rate sa sauvegarde de Sagesse (${z?.save?.total ?? "—"})`);
    ctx.expect(!(z?.damage?.applied), `Renvoi seul : aucun dégât (${z?.damage?.applied ?? 0})`);
    await pause(1500);
    ctx.expect(await turned(), "le Zombi est Renvoyé");

    // 2. The box checked: Sear Undead on the Zombie and the Bandit, with no area.
    const spent0 = (await ctx.call("get-actor", { actorId: cleric.actorId })).items?.find(i => i._id === channel)?.system?.uses?.spent ?? 0;
    let zs = null, bs = null, regions = 0;
    for ( let n = 1; (n <= 8) && (zs?.save?.success !== false); n++ ) {
      await clearEffects();
      await ctx.setHp(zombi, 100);
      const before = (await ctx.call("list-scene-objects", { type: "Region" })).objects?.Region?.length ?? 0;
      const r = await ctx.engine("castPicked", { tokenId: cleric.id, itemId: channel, activityId: TURN, targetIds: [zombi.id, bandit.id], upgrade: true });
      if ( !ctx.expect(!!r.usageMessageId, `Calcination utilisée (essai ${n})`) ) return;
      const res = await ctx.settle(r.usageMessageId);
      regions = ((await ctx.call("list-scene-objects", { type: "Region" })).objects?.Region?.length ?? 0) - before;
      zs = res.targets.find(t => t.token.endsWith(zombi.id));
      bs = res.targets.find(t => t.token.endsWith(bandit.id));
    }
    ctx.expect(regions === 0, `aucune zone posée (${regions})`);
    ctx.expect(zs?.save?.success === false, `Calcination : le Zombi rate (${zs?.save?.total ?? "—"})`);
    ctx.expect((zs?.damage?.applied ?? 0) > 0, `dégâts radiants (${zs?.damage?.applied ?? 0})`);
    ctx.expect(!bs || !!bs.unaffected, `le Bandit, humanoïde, n'est pas affecté${bs ? ` (${bs.unaffected?.reason ?? "affecté"})` : ""}`);
    await pause(1500);
    ctx.expect(await turned(), "le Zombi est Renvoyé malgré les dégâts");
    const spent1 = (await ctx.call("get-actor", { actorId: cleric.actorId })).items?.find(i => i._id === channel)?.system?.uses?.spent ?? 0;
    ctx.expect(spent1 > spent0, `une utilisation de Conduit divin dépensée (${spent0} → ${spent1})`);

    // 3. §294 (seen in play on 2026-10-31): a second Sear Undead on the already Turned Zombie — its damage does not end the
    // effect, and the resolution is not interrupted by an effect removed in the meantime.
    let again = null;
    for ( let n = 1; (n <= 8) && (again?.save?.success !== false); n++ ) {
      const r = await ctx.engine("castPicked", { tokenId: cleric.id, itemId: channel, activityId: TURN, targetIds: [zombi.id], upgrade: true });
      if ( !ctx.expect(!!r.usageMessageId, `deuxième Calcination utilisée (essai ${n})`) ) return;
      const res = await ctx.settle(r.usageMessageId);
      again = res.targets.find(t => t.token.endsWith(zombi.id));
    }
    ctx.expect((again?.damage?.applied ?? 0) > 0, `deuxième Calcination : dégâts radiants (${again?.damage?.applied ?? 0})`);
    await pause(3000);
    ctx.expect(await turned(), "le Zombi reste Renvoyé après la deuxième Calcination");
    await clearEffects();
  }
};
