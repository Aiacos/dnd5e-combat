/**
 * Shadow Dagger (§71, Monster Manual 2024 Vampire Familiar, `mmVampireFamilia`): "if the target drops to 0 Hit Points as a
 * result of this attack, it is Stabilized but Poisoned for 1 hour, and Paralyzed while Poisoned".
 *  - the NPC (ordinary NPC, which the engine kills outright at 0 HP) at 1 HP, hit: Stabilized, Unconscious, Poisoned,
 *    Paralyzed — not Dead;
 *  - a player character of the scene at full HP, hit: neither Poisoned nor Paralyzed (the effect only applies at 0 HP);
 *    at 1 HP, hit: Stabilized (no death saving throw due), Poisoned, Paralyzed.
 * The world item may have lost its effect: the engine takes it back from the original sheet (compendium).
 * The familiar is placed for the duration of the scenario (the world actor, under its id), in contact.
 * The safety net restores HP and conditions.
 */
const FAMILIAR = "mmVampireFamilia";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "dague des ombres — stabilisée, empoisonnée et paralysée seulement à 0 PV",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    // Absent from `dnd-6`: imported under its sheet's id (Monster Manual 2024, otherwise SRD 2024), removed at the end.
    await ctx.ensureActor(FAMILIAR);
    const familiar = await ctx.call("get-actor", { actorId: FAMILIAR }).catch(() => null);
    if ( !familiar ) { ctx.log("Familier de vampire (mmVampireFamilia) absent du monde : non applicable"); return; }
    // The NPC target: the first ordinary NPC of the scene that is not a familiar (the engine would kill it outright at 0 HP).
    let npcRef = null;
    for ( const t of tokens.filter(x => x.actorId !== FAMILIAR) ) {
      const a = await ctx.call("get-actor", { actorId: t.actorId }).catch(() => null);
      if ( (a?.type === "npc") && !a.system?.traits?.important ) { npcRef = t; break; }
    }
    if ( !npcRef ) { ctx.log("aucun PNJ ordinaire sur la scène : non applicable"); return; }
    const dagger = familiar.items.find(i => i.system?.identifier === "umbral-dagger");
    if ( !ctx.expect(!!dagger, "le familier a sa Dague des ombres") ) return;
    const grid = await ctx.gridSize();

    // The familiar, to be placed in contact with a target.
    const placeNextTo = async target => {
      const at = await ctx.position(target);
      const before = new Set((await ctx.call("list-scene-objects", { types: ["Token"] })).objects.Token.map(t => t.id));
      await ctx.call("place-token", { actorId: FAMILIAR, x: at.x - grid, y: at.y });
      const token = (await ctx.call("list-scene-objects", { types: ["Token"] })).objects.Token.find(t => !before.has(t.id));
      ctx.restore(() => ctx.call("delete-scene-object", { type: "Token", objectId: token.id }).catch(() => {}));
      await sleep(1000);
      return token;
    };
    const statusesOf = async token => {
      const effects = await ctx.effects(token);
      return new Set(effects.flatMap(e => e.statuses ?? []));
    };
    // The outcome conditions arrive after the damage: wait until they are there (8 s at most).
    const settledStatuses = async (token, wanted) => {
      let s = await statusesOf(token);
      for ( let n = 0; (n < 16) && !wanted.every(x => s.has(x)); n++ ) { await sleep(500); s = await statusesOf(token); }
      return s;
    };
    // Until it hits (10 tries).
    const stab = async (attacker, target) => {
      for ( let n = 0; n < 10; n++ ) {
        const u = await ctx.use({ tokenId: attacker.id, itemId: dagger._id, activityType: "attack", targetTokenIds: [target.id] });
        const r = await ctx.settle(u.usageMessageId).catch(() => null);
        if ( r?.targets?.[0]?.hit ) { await sleep(3000); return true; }
      }
      return false;
    };

    const zombie = await ctx.token(npcRef.name);
    const familiarToken = await placeNextTo(zombie);

    // 2. At 1 HP: stabilized, poisoned, paralyzed, not dead.
    await ctx.setHp(zombie, 1);
    if ( ctx.expect(await stab(familiarToken, zombie), "le familier touche le PNJ (1 PV)") ) {
      const s = await settledStatuses(zombie, ["stable", "unconscious", "poisoned", "paralyzed"]);
      ctx.expect((await ctx.hp(zombie)) === 0, "le PNJ tombe à 0 PV");
      ctx.expect(s.has("stable") && !s.has("dead"), `le PNJ est Stabilisé, pas Mort (${[...s].join(", ")})`);
      ctx.expect(s.has("unconscious"), "le PNJ est Inconscient");
      ctx.expect(s.has("poisoned") && s.has("paralyzed"), "le PNJ est Empoisonné et Paralysé");
    }

    // 3. A player character at 1 HP.
    const pcs = [];
    for ( const t of tokens.filter(x => x.actorId !== FAMILIAR) ) {
      const a = await ctx.call("get-actor", { actorId: t.actorId }).catch(() => null);
      if ( a?.type === "character" ) { pcs.push(t); break; }
    }
    if ( !pcs.length ) { ctx.log("aucun personnage joueur sur la scène : cas 3 non joué"); return; }
    const pc = await ctx.token(pcs[0].name);
    const near = await placeNextTo(pc);
    // Full HP: hit without dropping, neither Poisoned nor Paralyzed (the effect only applies at 0 HP).
    // Its starting HP (the computed maximum is not in the raw data): a hit, even a Critical Hit, does not bring it down.
    const start = await ctx.hp(pc);
    await ctx.setHp(pc, Math.max(start, 30));
    if ( ctx.expect(await stab(near, pc), `le familier touche ${pc.name} (pleins PV)`) ) {
      const s0 = await statusesOf(pc);
      ctx.expect((await ctx.hp(pc)) > 0, `${pc.name} tient debout (${await ctx.hp(pc)} PV)`);
      ctx.expect(!s0.has("poisoned") && !s0.has("paralyzed"), `pas à 0 PV : ni Empoisonné ni Paralysé (${[...s0].join(", ") || "aucun état"})`);
    }
    await ctx.setHp(pc, 1);
    if ( ctx.expect(await stab(near, pc), `le familier touche ${pc.name} (1 PV)`) ) {
      const s = await settledStatuses(pc, ["stable", "poisoned", "paralyzed"]);
      ctx.expect((await ctx.hp(pc)) === 0, `${pc.name} tombe à 0 PV`);
      ctx.expect(s.has("stable") && !s.has("dead"), `${pc.name} est Stabilisé (${[...s].join(", ")})`);
      ctx.expect(s.has("poisoned") && s.has("paralyzed"), `${pc.name} est Empoisonné et Paralysé`);
      const a = await ctx.call("get-actor", { actorId: pc.actorId });
      ctx.expect(!(a.system?.attributes?.death?.failure > 0), `aucun échec contre la mort (${a.system?.attributes?.death?.failure ?? 0})`);
    }
  }
};
