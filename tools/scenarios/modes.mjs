/**
 * Movement modes and elevation (SPEC §17.4): a PC (Fighter in `dnd-6`, Bramo in `ravenloft`), out of combat.
 *  - without a fly speed, choosing flight (token HUD) grants it through an engine effect and takes off to 5 ft;
 *    going back to walking lands and removes the effect;
 *  - with a fly speed (temporary effect "fly (scenario)"): going up by elevation while walking makes it fly,
 *    never below 5 ft in flight, coming back down to the ground makes it walk;
 *  - choosing burrowing grants it and sinks to −5 ft, walking brings it back to the ground and removes the effect.
 * Flight goes up at most under the level's ceiling (head included: the core stops the token at the Surface above). On a
 * Surface floor (level below), the core forbids crossing it: burrowing is refused there, mode and elevation
 * unchanged, granted speed removed — that is what the scenario then checks.
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  scene: "keep",   // §83: floors and stairs, in Restored Keep
  name: "modes — vol, marche, fouissement : élévation cohérente",

  async run(ctx) {
    const { tokens, sceneId } = await ctx.scene();
    const name = ["Guerrier", "Bramo"].find(n => tokens.some(t => t.name === n));
    if ( !name ) { ctx.log("Guerrier ou Bramo absent : non applicable"); return; }
    const pc = await ctx.token(name);
    const read = async () => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: pc.id });
      return { mode: data.movementAction ?? null, elevation: data.elevation ?? 0, data };
    };
    const waitFor = async test => {
      for ( let i = 0; i < 24; i++ ) { const s = await read(); if ( test(s) ) return s; await pause(250); }
      return read();
    };
    const setMode = mode => ctx.call("update-scene-object", { type: "Token", objectId: pc.id, data: { movementAction: mode } });
    const setElevation = elevation => ctx.call("update-scene-object", { type: "Token", objectId: pc.id, data: { elevation } });

    const start = await read();
    const ground = start.elevation;
    const { levels = [] } = await ctx.call("list-levels", {});
    const top = levels.find(l => l.id === start.data.level)?.elevation?.top ?? null;
    const high = ground + Math.min(20, (top === null) ? 20 : (top - ground - 5));
    if ( high < ground + 10 ) { ctx.log(`niveau trop bas (plafond ${top}) : non applicable`); return; }

    const target = start.data.actorLink ? { documentType: "Actor", id: start.data.actorId }
      : { uuid: `Scene.${sceneId}.Token.${pc.id}.Actor.${start.data.actorId}` };
    const effectsOf = async () => {
      if ( start.data.actorLink ) {
        const a = await ctx.call("get-actor", { actorId: start.data.actorId });
        return a.effects ?? a.actor?.effects ?? [];
      }
      return (await read()).data.delta?.effects ?? [];
    };
    const grantedIds = async () => (await effectsOf()).filter(e => e.flags?.["dnd5e-combat"]?.grantedSpeed).map(e => e._id);
    const granted = async () => (await grantedIds()).length;
    const speed = key => ({ name: `${key} (scénario)`, img: "icons/svg/wing.svg",
      system: { changes: [{ key: `system.attributes.movement.${key}`, value: 30, type: "upgrade", phase: "initial" }] } });
    ctx.restore(async () => {
      await ctx.removeEffectsNamed(pc, /\(scénario\)/);
      for ( const effectId of await grantedIds() ) await ctx.call("remove-embedded-effect", { ...target, effectId }).catch(() => {});
      await ctx.call("update-scene-object", { type: "Token", objectId: pc.id, data: { movementAction: start.mode ?? "walk" } }).catch(() => {});
      await ctx.call("move-token", { tokenId: pc.id, elevation: ground }).catch(() => {});
    });

    // 1. Without a fly speed: choosing flight grants it; going back to walking removes it.
    const actor = await ctx.call("get-actor", { actorId: start.data.actorId });
    const movement = (actor.system ?? actor.actor?.system)?.attributes?.movement ?? {};
    let s;
    if ( !(Number(movement.speeds?.fly ?? movement.fly ?? 0) > 0) ) {
      await setMode("fly").catch(() => {});
      s = await waitFor(s => (s.mode === "fly") && (s.elevation === ground + 5));
      ctx.expect((s.mode === "fly") && (s.elevation === ground + 5), `${pc.name} sans vol, vol choisi : mode ${s.mode}, élévation ${s.elevation}`);
      const n = await granted();
      ctx.expect(n === 1, `vitesse de vol accordée par un effet (${n})`);
      await setMode("walk").catch(() => {});
      s = await waitFor(s => (s.mode === "walk") && (s.elevation === ground));
      await pause(500);
      const left = await granted();
      ctx.expect((s.mode === "walk") && (s.elevation === ground) && (left === 0), `retour à la marche : mode ${s.mode}, élévation ${s.elevation}, effets accordés ${left}`);
    }

    // 2. Flight by elevation (fly speed lent by a scenario effect).
    await ctx.call("upsert-embedded-effect", { ...target, effectData: speed("fly") });
    await pause(300);
    await setMode("fly").catch(() => {});
    s = await waitFor(s => (s.mode === "fly") && (s.elevation === ground + 5));
    ctx.expect((s.mode === "fly") && (s.elevation === ground + 5), `décolle : mode ${s.mode}, élévation ${s.elevation} (attendu ${ground + 5})`);

    await setMode("walk").catch(() => {});
    s = await waitFor(s => (s.mode === "walk") && (s.elevation === ground));
    ctx.expect((s.mode === "walk") && (s.elevation === ground), `atterrit : mode ${s.mode}, élévation ${s.elevation}`);

    await setElevation(high).catch(() => {});
    s = await waitFor(s => (s.mode === "fly") && (s.elevation === high));
    ctx.expect((s.mode === "fly") && (s.elevation === high), `monte par l'élévation : mode ${s.mode}, élévation ${s.elevation} (attendu ${high})`);

    if ( top !== null ) {
      // The level follows the elevation (levelAt): above the top of the level, the token moves into the one above — except
      // a floor (Surface) above it, which stops it below, head included, level unchanged (regression of 2026-09-26:
      // climbed ONTO this floor, the token could no longer come back down).
      const above = levels.find(l => l.elevation?.bottom === top);
      await setElevation(top + 1).catch(() => {});
      await pause(1500);
      s = await read();
      if ( s.elevation >= top ) ctx.expect(!!above && (s.data.level === above.id), `au-dessus de ${top} : niveau ${s.data.level} (attendu ${above?.name ?? "aucun"})`);
      else ctx.expect((s.data.level === start.data.level) && (s.elevation <= high), `plancher au-dessus : pieds à ${s.elevation} (au plus ${high}), niveau inchangé`);
      await setElevation(ground + 5).catch(() => {});
      s = await waitFor(s => (s.elevation === ground + 5) && (s.data.level === start.data.level));
      ctx.expect((s.mode === "fly") && (s.data.level === start.data.level) && (s.elevation === ground + 5), `redescendu : mode ${s.mode}, élévation ${s.elevation} (attendu ${ground + 5}), niveau de départ (${s.data.level})`);
    }

    await setElevation(ground + 2).catch(() => {});
    s = await waitFor(s => s.elevation === ground + 5);
    ctx.expect((s.mode === "fly") && (s.elevation === ground + 5), `en vol, jamais sous 5 ft : mode ${s.mode}, élévation ${s.elevation}`);

    await setElevation(ground).catch(() => {});
    s = await waitFor(s => (s.mode === "walk") && (s.elevation === ground));
    ctx.expect((s.mode === "walk") && (s.elevation === ground), `redescend au sol : mode ${s.mode}, élévation ${s.elevation}`);

    // 2 bis. Changing level through the HUD (level alone): placed on the chosen level's floor, in its mode; back to the start.
    const upper = levels.find(l => (top !== null) && (l.elevation?.bottom === top));
    if ( upper ) {
      const setLevel = level => ctx.call("update-scene-object", { type: "Token", objectId: pc.id, data: { level } });
      await setLevel(upper.id).catch(() => {});
      s = await waitFor(s => s.data.level === upper.id);
      ctx.expect((s.data.level === upper.id) && (s.mode === "walk") && (s.elevation >= upper.elevation.bottom) && (s.elevation < (upper.elevation.top ?? Infinity)),
        `niveau changé par le HUD : ${s.data.level}, mode ${s.mode}, élévation ${s.elevation} (dans ${upper.elevation.bottom}–${upper.elevation.top})`);
      await setLevel(start.data.level).catch(() => {});
      s = await waitFor(s => (s.data.level === start.data.level) && (s.elevation === ground));
      ctx.expect((s.data.level === start.data.level) && (s.elevation === ground) && (s.mode === "walk"), `retour par le HUD : niveau ${s.data.level}, élévation ${s.elevation}, mode ${s.mode}`);
    }

    // 3. Burrowing: the speed is granted by the mode choice.
    await setMode("burrow").catch(() => {});
    s = await waitFor(s => (s.mode === "burrow") && (s.elevation === ground - 5));
    if ( s.mode !== "burrow" ) {
      // Surface floor: the core does not let it be crossed; the engine changed nothing and removes what it granted.
      await pause(500);
      const left = await granted();
      ctx.expect((s.mode === "walk") && (s.elevation === ground) && (left === 0), `fouir à travers un plancher : refusé, mode ${s.mode}, élévation ${s.elevation}, effets accordés ${left}`);
      return;
    }
    ctx.expect(s.elevation === ground - 5, `s'enfouit : mode ${s.mode}, élévation ${s.elevation}`);

    await setMode("walk").catch(() => {});
    s = await waitFor(s => (s.mode === "walk") && (s.elevation === ground));
    await pause(500);
    const left = await granted();
    ctx.expect((s.mode === "walk") && (s.elevation === ground) && (left === 0), `remonte : mode ${s.mode}, élévation ${s.elevation}, effets accordés ${left}`);
  }
};
