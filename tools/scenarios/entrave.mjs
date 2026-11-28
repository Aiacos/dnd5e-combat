/**
 * Breaking free by a check (SPEC §16.54): the Cleric casts Entangle (added at will for the scenario) on the Fighter
 * — area placed on him, Strength save replayed until failure (Restrained). The Fighter uses Escape: a Strength
 * (Athletics) check against the Cleric's spell save DC, written in the spell's text; replayed until
 * success. Checks: failure ⇔ total < DC and the effect stays; success ⇔ total ≥ DC and the effect leaves. Restores effects,
 * Concentration and areas.
 */
const SPELLS = "Compendium.dnd5e.spells24.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "entrave — Enchevêtrement, S'échapper par un test de Force (Athlétisme)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Clerc", "Guerrier"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Clerc ou Guerrier absent : non applicable"); return; }
    const cleric = await ctx.token("Clerc");
    const fighter = await ctx.token("Guerrier");
    await ctx.ensureItem(cleric, SPELLS + "phbsplEntangle00", { system: { method: "atwill" } });
    const hp0 = await ctx.hp(fighter);
    const regions = [];
    const cleanup = async () => {
      for ( const id of regions.splice(0) ) await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {});
      await ctx.removeEffectsNamed(cleric, /concentr/i);
      await ctx.removeStatusEffects(fighter, "restrained");
      await ctx.setHp(fighter, hp0);
    };
    ctx.restore(cleanup);
    const restraints = async () => (await ctx.effects(fighter)).filter(e => (e.statuses ?? []).includes("restrained"));

    // 1. Entangle, until a failed save.
    let caught = false;
    for ( let n = 1; (n <= 20) && !caught; n++ ) {
      const used = await ctx.use({ tokenId: cleric.id, identifier: "entangle", activityType: "save", consume: false,
        area: { shape: "rectangle", ...(await ctx.box(fighter)) } });
      if ( used.regionId ) regions.push(used.regionId);
      await ctx.settle(used.usageMessageId).catch(() => null);
      await pause(1000);
      caught = (await restraints()).length > 0;
      if ( !caught ) await cleanup();
    }
    ctx.expect(caught, "Enchevêtrement : le Guerrier est Entravé (sauvegarde ratée)");
    if ( !caught ) return;

    // 2. Escape, until success.
    const escapeId = await ctx.itemId(fighter.id, "dnd5e-combat-escape").catch(() => null);
    ctx.expect(!!escapeId, "le Guerrier a l'action de base S'échapper");
    if ( !escapeId ) return;
    let freed = false;
    let failures = 0;
    for ( let n = 1; (n <= 20) && !freed; n++ ) {
      // The engine writes "Guerrier se libère de Enchevêtrement (15 contre DD 13)" — the DC is not on the message. The
      // trace is a rolling buffer: we take the last line, the one from this try. Since §252 the verdict follows the end of the 3D
      // dice (8 s at most): we wait for one more line than before the try.
      const tries = async () => (await ctx.engineLog()).filter(l => /se libère pas de|se libère de|break free of|breaks free of/.test(l));
      const lines0 = await tries();
      await ctx.use({ tokenId: fighter.id, itemId: escapeId });
      let lines = lines0;
      const fresh = () => (lines.length > lines0.length) || (lines.at(-1) !== lines0.at(-1));
      for ( let w = 0; (w < 24) && !fresh(); w++ ) { await pause(500); lines = await tries(); }
      const line = lines.at(-1) ?? "";
      const m = line.match(/\((\d+) (?:contre DD|vs DC) (\d+)\)/);
      const total = m ? Number(m[1]) : null;
      const dc = m ? Number(m[2]) : null;
      const still = (await restraints()).length > 0;
      if ( (total === null) || (dc === null) ) { ctx.expect(false, `test d'évasion lancé et lu (${JSON.stringify({ total, dc })})`); return; }
      if ( total >= dc ) {
        freed = true;
        ctx.expect(!still, `réussite (${total} ≥ DD ${dc}) : l'entrave est retirée`);
      } else {
        failures++;
        if ( failures === 1 ) ctx.expect(still, `échec (${total} < DD ${dc}) : le Guerrier reste Entravé`);
      }
    }
    ctx.expect(freed, "le Guerrier finit par se libérer (en 20 essais au plus)");
    const log = (await ctx.engineLog()).filter(l => /se libère|break free|breaks free|Enchevêtrement|Entangle/.test(l)).slice(-4);
    for ( const l of log ) ctx.log(l);
  }
};
