/**
 * Spirit Guardians and flight (Discord report, 2026-11-25: a Cleric flying 10 ft above an enemy, Spirit Guardians up, no save
 * ever). The Emanation is placed as on a click (`api.mcp.use`), attached to the caster, and the caster then changes elevation only:
 *  (c) high in the air (30 ft) the Zombie two squares away is out of the Emanation's elevation slice; coming down to the ground,
 *      the Emanation enters its space: one "enter" save;
 *  (a) 10 ft up, the Zombie (feet 0, head 5) stays inside the slice: no new "enter", and its turn end replays the save;
 *  (b) 30 ft up, the Zombie is out of reach (15 ft emanation from the caster's body): its turn end replays nothing;
 *  (d) 10 ft up, the caster flies horizontally over a Zombie standing outside: the Emanation enters its space: one "enter" save.
 * The climbing and falling system is turned off for the scenario (the caster has no Fly Speed: it would fall).
 */
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "esprits gardiens en vol — l'émanation suit l'élévation du lanceur",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const casterRef = tokens.find(t => t.name === "Magicien");
    if ( !casterRef || !tokens.some(t => t.name === "Zombi") ) { ctx.log("Magicien or Zombi missing: not applicable"); return; }
    const caster = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const climb = await ctx.engine("setting", { key: "climbSystem", value: false });
    ctx.restore(() => ctx.engine("setting", { key: "climbSystem", value: climb.before }).catch(() => {}));
    const hp0 = await ctx.hp(zombi);
    const home = await ctx.position(zombi);
    const cPos = await ctx.position(caster);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
    ctx.restore(() => ctx.call("move-token", { tokenId: caster.id, x: cPos.x, y: cPos.y, elevation: cPos.elevation }).catch(() => {}));
    const ground = cPos.elevation ?? 0;
    await ctx.call("move-token", { tokenId: zombi.id, x: cPos.x - 2 * grid, y: cPos.y, elevation: ground });
    await ctx.setHp(zombi, 100);

    const itemId = await ctx.ensureItem(caster, "Compendium.dnd-players-handbook.spells.Item.phbsplSpiritGuar");
    const v3 = !!((await ctx.call("get-actor", { actorId: caster.actorId })).items ?? []).find(i => i._id === itemId)?.system?.activities?.tevaatMC9LZxVPLS;
    const used = await ctx.engine("use", { tokenId: caster.id, itemId, ...(v3 ? { activityId: "tevaatMC9LZxVPLS" } : { activityType: "save" }) });
    for ( const r of used.regions ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: r.id }).catch(() => {}));
    ctx.restore(async () => {
      const actor = await ctx.call("get-actor", { actorId: caster.actorId });
      for ( const e of (actor.effects ?? []).filter(e => /concentr/i.test(e.name ?? "")) ) {
        await ctx.call("remove-embedded-effect", { uuid: `Actor.${caster.actorId}`, effectId: e._id ?? e.id }).catch(() => {});
      }
    });
    const [region] = used.regions;
    ctx.expect(!!region && (region.attachedTo === caster.id), `Emanation attached to the caster (${region?.attachedTo ?? "none"})`);
    if ( !region ) return;
    await sleep(2000);

    const slice = async () => (await ctx.call("get-scene-object", { type: "Region", objectId: region.id }))?.data?.elevation ?? {};
    const fly = async (elevation, at={}) => {
      const moved = await ctx.call("move-token", { tokenId: caster.id, ...at, elevation: ground + elevation });
      if ( !moved.moved ) throw new Error(`move-token: ${moved.warning ?? "elevation not applied"}`);
      await sleep(2000);
      const s = await slice();
      ctx.log(`caster at ${elevation} ft: slice ${s.bottom} → ${s.top}`);
      return s;
    };
    /** The Zombie's area replays (this event) since a message, settled. */
    const zombieTicks = async (since, event) => {
      const found = (await ctx.messagesSince(since)).filter(m => (m.type === "usage")
        && (m.flags?.["dnd5e-combat"]?.areaTick?.event === event) && String(m.flags?.["dnd5e-combat"]?.areaTick?.token ?? "").endsWith(zombi.id));
      for ( const m of found ) await ctx.settle(m.id).catch(() => null);
      return found;
    };

    // (c) Out of combat: up to 30 ft (the Zombie leaves the slice), then down to the ground (the Emanation enters its space).
    let since = await ctx.lastMessageId();
    const high = await fly(30);
    ctx.expect(high.bottom > ground + 5, `30 ft up, the slice clears the Zombie's head (${high.bottom} → ${high.top})`);
    await sleep(1000);
    ctx.expect(!(await zombieTicks(since, "enter")).length, "going up: no \"enter\" for the Zombie");
    since = await ctx.lastMessageId();
    await fly(0);
    await sleep(2000);
    const down = await zombieTicks(since, "enter");
    ctx.expect(down.length === 1, `(c) coming down onto the Zombie: the Emanation enters its space, one save (${down.length})`);

    // (a) In combat: 10 ft up on the caster's turn, then the Zombie ends its turn inside.
    const c0 = await ctx.startCombat([caster, zombi]);
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    let c = await state();
    const by = id => c.combatants.find(x => x.tokenId === id);
    await ctx.call("set-initiative", { combatId: c.id ?? c0?.id, combatantId: by(caster.id).id, value: 20 });
    await ctx.call("set-initiative", { combatId: c.id ?? c0?.id, combatantId: by(zombi.id).id, value: 10 });
    const current = async () => { c = await state(); return c.combatants.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    for ( let i = 0; (i < 3) && ((await current()) !== caster.id); i++ ) { await ctx.nextTurn(); await sleep(1500); }
    /** From the caster's turn: through the Zombie's turn, to the caster's next turn. */
    const passZombieTurn = async () => {
      for ( let i = 0; i < 4; i++ ) {
        await ctx.nextTurn();
        await sleep(2500);
        if ( (await current()) === caster.id ) return;
      }
    };
    since = await ctx.lastMessageId();
    const ten = await fly(10);
    ctx.expect((ten.bottom <= ground) && (ten.top >= ground + 25), `10 ft up, the slice still holds the Zombie (${ten.bottom} → ${ten.top})`);
    ctx.expect(!(await zombieTicks(since, "enter")).length, "(a) rising 10 ft: no new \"enter\" for the Zombie already inside");
    since = await ctx.lastMessageId();
    await passZombieTurn();
    const endA = await zombieTicks(since, "turnEnd");
    ctx.expect(endA.length === 1, `(a) the caster 10 ft above: the Zombie's turn end replays the save (${endA.length})`);

    // (b) 30 ft up: out of reach, nothing at the Zombie's turn end.
    await fly(30);
    since = await ctx.lastMessageId();
    await passZombieTurn();
    const endB = await zombieTicks(since, "turnEnd");
    ctx.expect(!endB.length, `(b) the caster 30 ft above: nothing at the Zombie's turn end (${endB.length})`);

    // (d) 10 ft up, flying horizontally over a Zombie standing outside the Emanation.
    await ctx.call("move-token", { tokenId: zombi.id, x: cPos.x - 6 * grid, y: cPos.y, elevation: ground });
    await fly(10);
    await sleep(1000);
    since = await ctx.lastMessageId();
    await fly(10, { x: cPos.x - 5 * grid, y: cPos.y });
    await sleep(2000);
    const over = await zombieTicks(since, "enter");
    ctx.expect(over.length === 1, `(d) flying 10 ft over the Zombie: the Emanation enters its space, one save (${over.length})`);
  }
};
