/**
 * Elevation and volumes (P2, SPEC §14.2): the Zombie rises to 30 ft above its cell; Burning
 * Hands placed on that cell does not reach it — the Cone gets an elevation slice
 * (−7.5 → 7.5 ft around the caster on the ground) and the core judges the Zombie outside: "zone placed on
 * nobody", HP intact. Back on the ground, the same placement reaches it. Restores elevation and HP.
 *
 * The rise goes through the connector's `move-token` (0.27.0: `token.move` in `displace`, regions
 * warmed up against the core's "reading 'testPoint'" trap, see runtime/space.mjs) — an
 * `update-scene-object` of elevation is refused as soon as a floor is crossed.
 */
export default {
  name: "élévation — une zone au sol épargne une créature en vol",

  async run(ctx) {
    const sorc = await ctx.token("Ensorceleur");
    // On a scene with levels (Restored Keep has several Zombies), the one on the caster's level: a floor would stop the area.
    const { tokens } = await ctx.scene();
    const zombi = tokens.find(t => (t.name === "Zombi") && !t.hidden && (t.level === sorc.level)) ?? await ctx.token("Zombi");
    // A volume test, not a gravity test: the Zombie has no flying Speed, and the climbing and falling system (turned on by the
    // runner) would make it fall from its 30 ft (seen on 2026-10-26: Prone, and the return to the ground refused). Switched off for
    // the scenario's duration.
    const climb = await ctx.engine("setting", { key: "climbSystem", value: false });
    ctx.restore(() => ctx.engine("setting", { key: "climbSystem", value: climb.before }).catch(() => {}));
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    const elevation0 = zombi.elevation ?? 0;
    const setElevation = async elevation => {
      const moved = await ctx.call("move-token", { tokenId: zombi.id, elevation });
      if ( !moved.moved ) throw new Error(`move-token : ${moved.warning ?? "élévation non appliquée"} (${JSON.stringify(moved.after)})`);
    };
    ctx.restore(() => setElevation(elevation0));
    const box = await ctx.box(zombi);
    const cast = () => ctx.use({ tokenId: sorc.id, identifier: "burning-hands", activityType: "save", area: { shape: "rectangle", ...box }, collectMs: 3000 });

    // 1. In flight: the area does not reach it.
    await setElevation(elevation0 + 30);
    const high = await cast();
    ctx.expect(high.used && !!high.regionId, "zone posée sur la case du Zombi, lui à 30 ft");
    if ( high.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: high.regionId }).catch(() => {}));
    await new Promise(r => setTimeout(r, 2000));
    const r1 = await ctx.resolution(high.usageMessageId);
    ctx.expect(!r1?.targets?.some(t => t.name === "Zombi"), `le Zombi en vol n'est pas atteint (cibles : ${r1?.targets?.map(t => t.name).join(", ") || "aucune"})`);
    const hpHigh = await ctx.hp(zombi);
    ctx.expect(hpHigh === hp0, `PV intacts (${hpHigh})`);

    // 2. On the ground: the same area reaches it.
    await setElevation(elevation0);
    const low = await cast();
    ctx.expect(low.used && !!low.regionId, "même zone, Zombi au sol");
    if ( low.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: low.regionId }).catch(() => {}));
    const r2 = await ctx.settle(low.usageMessageId);
    const hit = r2.targets.find(t => t.name === "Zombi");
    ctx.expect(r2.step === "done" && !!hit, `au sol, la zone l'atteint (sauvegarde ${hit?.save?.total ?? "—"}, ${hit?.damage?.applied ?? 0} PV)`);
    const after = await ctx.hp(zombi);
    ctx.expect(hp0 - after === (hit?.damage?.applied ?? 0), `PV lus sur le token ${hp0} → ${after}`);
  }
};
