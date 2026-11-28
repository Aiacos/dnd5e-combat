/**
 * §238: "Take off" / "Land" in the menu of one's own token, according to the speeds on its sheet — `dnd-6` Fighter (Bramo
 * in `ravenloft`), on Restored Keep (levels and Surfaces).
 *  1. Without a Fly Speed: the menu offers nothing for flight.
 *  2. Fly Speed lent (effect "fly (scénario)"): "Take off" — takes off at 5 ft, fly mode, no speed granted by the engine.
 *  3. In flight: "Land" — returns to the ground, walk mode.
 *  4. Flying higher (elevation field): "Land" brings it back to its ground, in its starting level.
 *  5. In combat: taking off costs 5 ft of the turn's movement.
 * Resets the mode, the elevation and removes the effect; the runner's safety net handles the rest.
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  scene: "keep",
  name: "vol au menu — s'envoler et atterrir selon la Vitesse de vol",

  async run(ctx) {
    const { tokens, sceneId } = await ctx.scene();
    const name = ["Guerrier", "Bramo"].find(n => tokens.some(t => t.name === n));
    if ( !name ) { ctx.log("Guerrier ou Bramo absent : non applicable"); return; }
    const pc = await ctx.token(name);
    const read = async () => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: pc.id });
      return { mode: data.movementAction ?? null, elevation: data.elevation ?? 0, level: data.level ?? null, data };
    };
    const waitFor = async test => {
      for ( let i = 0; i < 24; i++ ) { const s = await read(); if ( test(s) ) return s; await pause(250); }
      return read();
    };
    const flight = (run=false) => ctx.engine("flight", { tokenId: pc.id, run });
    const start = await read();
    const ground = start.elevation;
    const target = start.data.actorLink ? { documentType: "Actor", id: start.data.actorId }
      : { uuid: `Scene.${sceneId}.Token.${pc.id}.Actor.${start.data.actorId}` };
    ctx.restore(async () => {
      await ctx.removeEffectsNamed(pc, /\(scénario\)/);
      await ctx.call("update-scene-object", { type: "Token", objectId: pc.id, data: { movementAction: start.mode ?? "walk" } }).catch(() => {});
      await ctx.call("move-token", { tokenId: pc.id, elevation: ground }).catch(() => {});
    });

    // The mode never chosen (`null` in the source: the core's default mode), like a token just placed — the case of the Air
    // Summon Beast, the user's first feedback (the menu stayed empty).
    await ctx.call("update-scene-object", { type: "Token", objectId: pc.id, data: { movementAction: null } }).catch(() => {});
    await pause(300);

    // 1. Sans vol : rien.
    let f = await flight();
    if ( f.fly > 0 ) ctx.log(`${pc.name} a déjà une Vitesse de vol (${f.fly}) : étape 1 sautée`);
    else ctx.expect(!f.choice && !f.entries.length, `sans Vitesse de vol, rien au menu (${f.entries.join(", ") || "rien"})`);

    // 2. Avec vol : s'envoler.
    await ctx.call("upsert-embedded-effect", { ...target, effectData: { name: "fly (scénario)", img: "icons/svg/wing.svg",
      system: { changes: [{ key: "system.attributes.movement.fly", value: 30, type: "upgrade", phase: "initial" }] } } });
    await pause(400);
    f = await flight();
    ctx.expect(f.choice === "takeOff" && f.entries.length === 1, `Vitesse de vol ${f.fly} : le menu propose « ${f.entries.join(", ") || "rien"} »`);
    f = await flight(true);
    let s = await waitFor(s => (s.mode === "fly") && (s.elevation === ground + 5));
    ctx.expect(f.done && (s.mode === "fly") && (s.elevation === ground + 5), `s'envole : mode ${s.mode}, élévation ${s.elevation} (attendu ${ground + 5})`);
    const granted = (s.data.delta?.effects ?? []).concat((await ctx.call("get-actor", { actorId: start.data.actorId })).effects ?? [])
      .filter(e => e.flags?.["dnd5e-combat"]?.grantedSpeed).length;
    ctx.expect(granted === 0, `aucune vitesse accordée par le moteur (${granted})`);

    // 3. Atterrir.
    f = await flight();
    ctx.expect(f.choice === "land", `en vol, le menu propose « ${f.entries.join(", ") || "rien"} »`);
    f = await flight(true);
    s = await waitFor(s => (s.mode === "walk") && (s.elevation === ground));
    ctx.expect(f.done && (s.mode === "walk") && (s.elevation === ground), `atterrit : mode ${s.mode}, élévation ${s.elevation}`);
    f = await flight();
    ctx.expect(f.choice === "takeOff", `au sol, de nouveau « ${f.entries.join(", ") || "rien"} »`);

    // 4. Plus haut, puis atterrir : son sol, son niveau.
    await ctx.call("update-scene-object", { type: "Token", objectId: pc.id, data: { elevation: ground + 10 } }).catch(() => {});
    s = await waitFor(s => s.elevation === ground + 10);
    ctx.expect(s.mode === "fly", `monté à ${s.elevation} : mode ${s.mode}`);
    f = await flight(true);
    s = await waitFor(s => (s.mode === "walk") && (s.elevation === ground));
    ctx.expect(f.done && (s.elevation === ground) && (s.level === start.level), `atterrit de ${ground + 10} : élévation ${s.elevation}, niveau ${s.level}`);

    // 4 bis. "Climbing and falling" switch off (§224, the `dnd-6` case): the menu still offers flight.
    const climbBefore = await ctx.engine("setting", { key: "climbSystem", value: false });
    ctx.restore(() => ctx.engine("setting", { key: "climbSystem", value: climbBefore?.before ?? true }));
    await pause(800);
    f = await flight();
    ctx.expect(f.choice === "takeOff", `interrupteur coupé : « ${f.entries.join(", ") || "rien"} »`);
    f = await flight(true);
    s = await waitFor(s => (s.mode === "fly") && (s.elevation === ground + 5));
    ctx.expect(f.done && (s.mode === "fly") && (s.elevation === ground + 5), `coupé, s'envole : mode ${s.mode}, élévation ${s.elevation}`);
    f = await flight(true);
    s = await waitFor(s => (s.mode === "walk") && (s.elevation === ground));
    ctx.expect(f.done && (s.mode === "walk") && (s.elevation === ground), `coupé, atterrit : mode ${s.mode}, élévation ${s.elevation}`);
    await ctx.engine("setting", { key: "climbSystem", value: true });
    await pause(800);

    // 5. In combat: taking off has a cost.
    const zombi = tokens.find(t => (t.name === "Zombi") && !t.hidden);
    await ctx.startCombat(zombi ? [pc, zombi] : [pc]);
    await pause(800);
    const m0 = await ctx.engine("movement", { tokenId: pc.id });
    f = await flight(true);
    s = await waitFor(s => s.elevation === ground + 5);
    const m1 = await ctx.engine("movement", { tokenId: pc.id });
    ctx.expect(f.done && (s.elevation === ground + 5), `en combat, s'envole : élévation ${s.elevation}`);
    ctx.expect((m1.combat?.spent ?? 0) - (m0.combat?.spent ?? 0) >= 5 - 1e-6,
      `déplacement du tour : ${m0.combat?.spent} → ${m1.combat?.spent} ${m1.combat?.units ?? ""}`);
    f = await flight(true);
    s = await waitFor(s => s.elevation === ground);
    ctx.expect(f.done && (s.elevation === ground) && (s.mode === "walk"), `en combat, atterrit : élévation ${s.elevation}, mode ${s.mode}`);
  }
};
