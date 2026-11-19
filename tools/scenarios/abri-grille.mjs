/**
 * §468 (retour de Fanarie, Discord, 2026-11-17) : un mur coché « grille » (`flags.dnd5e-combat.grate`) arrête le déplacement mais
 * pas le chemin d'un sort ni une attaque. Arène : l'Ensorceleur, le Zombi à 4 cases à l'est, un mur nord-sud entre les deux.
 *  - mur plein : la pose d'une Boule de feu sur le Zombi est refusée (« hidden », §200), abri total ;
 *  - le même mur coché grille : la pose est acceptée, abri supérieur (threeQuarters), ligne d'effet présente ;
 *  - la configuration du mur montre la section « DAS · Grille », sur « grille » (choix de la §476) ;
 *  - §476 : réglage de monde `grateWalls` — éteint, un mur qui laisse voir reste plein ; allumé, il devient une grille (pose acceptée,
 *    abri supérieur) ; un mur qui bloque la vue reste plein ; le choix « mur plein » du mur l'emporte.
 * Remet la position du Zombi, le réglage, et retire le mur.
 */
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "grille — un sort et une attaque passent à travers des barreaux (§468, §476)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( ["Ensorceleur", "Zombi"].some(n => !tokens.some(t => t.name === n)) ) { ctx.log("Ensorceleur et Zombi requis : non applicable"); return; }
    const sorc = await ctx.token("Ensorceleur");
    const zombi = await ctx.token("Zombi");
    const g = await ctx.gridSize();
    const fireball = await ctx.ensureItem(sorc, `${PHB}phbsplFireball00`, { system: { method: "atwill" } });
    const zHome = await ctx.position(zombi);
    const s = await ctx.position(sorc);
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: zHome.x, y: zHome.y, elevation: zHome.elevation }).catch(() => {}));
    await ctx.call("move-token", { tokenId: zombi.id, x: s.x + (4 * g), y: s.y, elevation: s.elevation ?? 0 });
    await pause(800);
    const z = await ctx.position(zombi);

    // Un mur nord-sud à deux cases du lanceur, long de huit cases.
    const x = s.x + (2.5 * g);
    const created = await ctx.call("create-walls", { walls: [{ c: [x, s.y - (4 * g), x, s.y + (5 * g)].map(Math.round) }] });
    const wallId = (created?.walls ?? []).map(w => w.id ?? w._id).find(Boolean);
    if ( !wallId ) throw new Error(`mur non créé (${JSON.stringify(created).slice(0, 200)})`);
    ctx.restore(() => ctx.call("delete-scene-object", { type: "Wall", objectId: wallId }).catch(() => {}));
    await pause(800);

    const sphere = { type: "circle", x: z.x + (g / 2), y: z.y + (g / 2), radius: 4 * g };
    const place = () => ctx.engine("rangedPlacement", { tokenId: sorc.id, itemId: fireball, shapes: [sphere] });
    const cover = () => ctx.engine("cover", { attackerId: sorc.id, targetId: zombi.id });

    const solidPlace = await place();
    ctx.expect(solidPlace.problem === "hidden", `mur plein : la Boule de feu derrière est refusée (${solidPlace.problem})`);
    const solidCover = await cover();
    ctx.expect(solidCover?.degree === "total", `mur plein : abri total (${solidCover?.degree ?? "aucun"})`);

    await ctx.call("update-scene-object", { type: "Wall", objectId: wallId, data: { "flags.dnd5e-combat.grate": true } });
    await pause(800);
    const gratePlace = await place();
    ctx.expect(gratePlace.problem === null, `grille : la Boule de feu derrière est acceptée (${gratePlace.problem})`);
    const grateCover = await cover();
    ctx.expect(grateCover?.degree === "threeQuarters", `grille : abri supérieur (${grateCover?.degree ?? "aucun"})`);

    // La section de la configuration du mur (MJ) : un mur coché avant la §476 s'ouvre sur « grille ».
    const sheet = async () => (await ctx.call("run-script", { code: `
      const wall = canvas.scene.walls.get("${wallId}");
      const app = wall.sheet; await app.render({ force: true });
      await new Promise(r => setTimeout(r, 400));
      const select = app.element?.querySelector('.dnd5e-combat-wall-grate select[name="flags.dnd5e-combat.grateMode"]');
      const out = { found: !!select, value: select?.value ?? null, options: [...(select?.options ?? [])].map(o => o.value),
        hint: app.element?.querySelector('.dnd5e-combat-wall-grate .hint')?.textContent ?? null };
      await app.close();
      return out;` }))?.result;
    const ui = await sheet();
    ctx.expect(ui?.found && (ui.value === "grate") && (ui.options?.join() === "auto,grate,solid"),
      `la configuration du mur montre le choix « grille » (auto / grille / mur plein), sur « grille » (${JSON.stringify(ui)})`);

    // §476 (retour de Fanarie) : le réglage de monde « Murs grilles » — tout mur qui ne bloque pas la vue est une grille.
    const setting = value => ctx.call("run-script", { code: value === undefined
      ? `return game.settings.get("dnd5e-combat", "grateWalls");`
      : `await game.settings.set("dnd5e-combat", "grateWalls", ${JSON.stringify(value)}); return game.settings.get("dnd5e-combat", "grateWalls");` });
    const before = (await setting())?.result === true;
    ctx.restore(() => setting(before).catch(() => {}));
    const wallData = data => ctx.call("update-scene-object", { type: "Wall", objectId: wallId, data }).then(() => pause(800));

    await setting(false);
    await wallData({ "flags.dnd5e-combat.grateMode": "auto", sight: 0, light: 0 });
    const offPlace = await place();
    ctx.expect(offPlace.problem === "hidden", `réglage éteint, mur « selon le réglage » qui laisse voir : refusé (${offPlace.problem})`);

    await setting(true);
    await pause(300);
    const onPlace = await place();
    ctx.expect(onPlace.problem === null, `réglage allumé, mur qui laisse voir : la Boule de feu derrière est acceptée (${onPlace.problem})`);
    const onCover = await cover();
    ctx.expect(onCover?.degree === "threeQuarters", `réglage allumé : abri supérieur (${onCover?.degree ?? "aucun"})`);
    const onUi = await sheet();
    ctx.expect(onUi?.value === "auto" && /grille|grate/i.test(onUi?.hint ?? ""), `la configuration du mur dit ce que vaut « selon le réglage » (${JSON.stringify(onUi)})`);

    await wallData({ sight: 20, light: 20 });
    const sightPlace = await place();
    ctx.expect(sightPlace.problem === "hidden", `réglage allumé, mur qui bloque la vue : refusé (${sightPlace.problem})`);

    await wallData({ sight: 0, light: 0, "flags.dnd5e-combat.grateMode": "solid" });
    const solidMode = await place();
    ctx.expect(solidMode.problem === "hidden", `réglage allumé, mur choisi « mur plein » (une vitre) : refusé (${solidMode.problem})`);
    const solidModeCover = await cover();
    ctx.expect(solidModeCover?.degree === "total", `mur choisi « mur plein » : abri total (${solidModeCover?.degree ?? "aucun"})`);

    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
