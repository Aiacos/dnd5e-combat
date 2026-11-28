/**
 * Spell light and darkness (SPEC §16.31, key `light`). World `ravenloft`: Kaalisti casts Darkness on the Zombie →
 * a darkness source (negative light) at the center of the area, and the simulated vision treats the Zombie as unseen and
 * blinded: Sylaene's Starry Wisp carries both reasons "target unseen" and "attacker unseen". On a hit, the
 * Zombie carries "Illuminated" with its 10 ft Dim Light (`token.light.dim`). Then Daylight, next to it: the
 * Darkness is dispelled (region, source and Kaalisti's Concentration), and a 60/120 ft light is placed.
 * Not applicable without Kaalisti, Sylaene and the Zombie (world `dnd-6`).
 */
const DAYLIGHT = "Compendium.dnd-players-handbook.spells.phbsplDaylight00";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "ténèbres et lumière — Ténèbres, Poussière d'étoile, Lumière du jour",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Kaalisti", "Sylaene", "Zombi"].every(n => tokens.some(t => t.name === n)) ) {
      ctx.log("Kaalisti, Sylaene ou le Zombi absent : non applicable"); return;
    }
    const warlock = await ctx.token("Kaalisti");
    const druid = await ctx.token("Sylaene");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    ctx.restore(() => ctx.removeEffectsNamed(zombi, /Illumin|Starry|Poussi/i));
    ctx.restore(() => ctx.removeEffectsNamed(warlock, /concentr/i));
    ctx.restore(() => ctx.removeEffectsNamed(druid, /concentr/i));

    const lights = async () => ((await ctx.call("list-scene-objects", { types: ["AmbientLight"] })).objects?.AmbientLight ?? []);
    const ours = async regionId => {
      const all = await lights();
      const found = [];
      for ( const l of all ) {
        const { data } = await ctx.call("get-scene-object", { type: "AmbientLight", objectId: l.id });
        if ( data.flags?.["dnd5e-combat"]?.region === regionId ) found.push(data);
      }
      return found;
    };

    // 1. Darkness (15 ft Sphere) centered on the Zombie.
    const box = await ctx.box(zombi);
    const centre = { x: box.x + (box.width / 2), y: box.y + (box.height / 2) };
    const dark = await ctx.use({ tokenId: warlock.id, identifier: "darkness", area: { shape: "circle", ...centre, radius: 3 * grid } });
    ctx.expect(dark.used && !!dark.regionId, "Ténèbres posées sur le Zombi");
    if ( !dark.regionId ) return;
    ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: dark.regionId }).catch(() => {}));
    await pause(1500);
    const [shadow] = await ours(dark.regionId);
    ctx.expect(!!shadow && shadow.config?.negative === true, `source de ténèbres posée (négative : ${shadow?.config?.negative}, rayon ${shadow?.config?.dim})`);
    ctx.expect(!!shadow && (Math.abs(shadow.x - centre.x) <= 1) && (Math.abs(shadow.y - centre.y) <= 1), "au centre de la zone");

    // 2. Sylaene's Starry Wisp on the Zombie: unseen, and does not see.
    let hit = null;
    let reasons = null;
    for ( let n = 1; (n <= 10) && !hit; n++ ) {
      const used = await ctx.use({ tokenId: druid.id, identifier: "starry-wisp", activityType: "attack", targetTokenIds: [zombi.id] });
      const r = await ctx.settle(used.usageMessageId);
      if ( !reasons ) {
        const attack = (await ctx.messagesSince(used.usageMessageId)).find(m => m.type === "attack");
        const mods = attack?.flags?.["dnd5e-combat"]?.modifiers ?? { advantage: [], disadvantage: [] };
        reasons = [...(mods.advantage ?? []), ...(mods.disadvantage ?? [])].map(x => `${x.who}.${x.key}`);
        ctx.log(`raisons : ${reasons.join(", ")}`);
      }
      if ( r.targets[0]?.hit ) hit = r;
    }
    ctx.expect(reasons?.includes("target.unseen"), "Zombi dans les ténèbres : « cible non vue » (désavantage)");
    ctx.expect(reasons?.includes("attacker.unseen"), "Zombi dans les ténèbres : il ne voit pas Sylaene (avantage)");
    ctx.expect(!!hit, "Poussière d'étoile finit par toucher");
    if ( hit ) {
      await pause(1500);
      const effect = (await ctx.effects(zombi)).find(e => /Illumin|Starry|Poussi/i.test(e.name ?? ""));
      const change = (effect?.system?.changes ?? effect?.changes ?? []).find(c => c.key === "token.light.dim");
      ctx.expect(!!change, `« ${effect?.name ?? "?"} » fait briller le Zombi (token.light.dim = ${change?.value})`);
    }

    // 3. Daylight 20 ft from the Zombie: the Darkness (level 2) is dispelled.
    await ctx.ensureItem(druid, DAYLIGHT, { system: { method: "atwill" } });
    const day = await ctx.use({ tokenId: druid.id, identifier: "daylight", area: { shape: "circle", x: centre.x + (4 * grid), y: centre.y, radius: 12 * grid } });
    ctx.expect(day.used && !!day.regionId, "Lumière du jour posée");
    if ( !day.regionId ) return;
    ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: day.regionId }).catch(() => {}));
    await pause(2500);
    const regions = (await ctx.call("list-scene-objects", { types: ["Region"] })).objects?.Region ?? [];
    ctx.expect(!regions.some(r => r.id === dark.regionId), "les Ténèbres sont dissipées (région retirée)");
    ctx.expect(!(await ours(dark.regionId)).length, "leur source de ténèbres est éteinte");
    const conc = (await ctx.effects(warlock)).filter(e => /concentr/i.test(e.name ?? ""));
    ctx.expect(!conc.length, "la concentration de Kaalisti est tombée");
    const [sun] = await ours(day.regionId);
    ctx.expect(!!sun && (sun.config?.bright === 60) && (sun.config?.dim === 120) && !sun.config?.negative,
      `lumière du jour posée (${sun?.config?.bright}/${sun?.config?.dim})`);

    await ctx.call("delete-scene-object", { type: "Region", objectId: day.regionId });
    await pause(1500);
    ctx.expect(!(await ours(day.regionId)).length, "zone retirée : sa lumière est éteinte");
  }
};
