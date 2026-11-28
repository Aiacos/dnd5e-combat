/**
 * Issue #42: Darkness and Devil's Sight, in the "Vision Arena" (`node tools/arene-vision.mjs` first). The Devil's Sight
 * Warlock casts Darkness from their sheet on the Target in the darkness; then, for each observer, what the rules judge
 * (`api.mcp.visionMatrix`, `canSee` — it is what refuses a "not in view" target) and what the screen shows through their eyes.
 *
 * Expected rules (PHB 2024):
 *  - Human, Elf Ranger (Darkvision): see neither the target in the darkness, nor the one behind; see the witness far away.
 *  - Devil's Sight Warlock (Devil's Sight, 120 ft): sees in the darkness and through; not beyond 120 ft.
 *  - Truesight (120 ft): sees in and through. Blindsight (30 ft): the target in the darkness (25 ft), not the one behind.
 * Then Blinded (Warlock, Truesight, Blindsight) and Deafened (Human): only Blindsight still perceives, the rest
 * is heard (hearing outline); the Deafened hears nothing.
 * Then Daylight next to it: the Darkness is dispelled, the Human sees again.
 * Screen: what the rules see is shown sharp ("seen") or by the outline of its sense ("outline": Blindsight, Truesight,
 * dnd5e filters; Devil's Sight, sharp with its dark red edging) — never "veiled" (judged visible but drawn under the vision
 * veil: black silhouette for the player, issue #42 follow-up); what they do not see is never sharp (hidden, or hearing outline,
 * "heard", §62). Then the same survey with the "Simulated Vision" setting off, to compare with the core's rendering alone
 * (log, without waiting).
 *
 * Without the Vision Arena (another world), not applicable: the runner skips a scenario whose scene is missing.
 */
import { ARENE_VISION } from "../lib/stages.mjs";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const OBSERVERS = ["Humain", "Occultiste du diable", "Rôdeur elfe", "Vision véritable", "Vision aveugle", "Vibrations", "Sens tout", "Voir l'invisible"];
const TARGETS = ["Cible dans les ténèbres", "Cible derrière les ténèbres", "Cible au loin", "Cible dans le noir", "Cible invisible"];

// observer → [in the darkness, behind the darkness, far away (witness), in the dark (ordinary dark), invisible]: do the
// rules see? Distances (diagonals at 5 ft): see ARENE_VISION.
const EXPECTED = Object.fromEntries(Object.entries({
  "Humain":               [false, false, true, false, false],
  "Rôdeur elfe":          [false, false, true, true,  false],   // Darkvision 60 ft: ordinary dark, not Darkness
  "Occultiste du diable": [true,  true,  true, true,  false],   // Devil's Sight 120 ft: "sees normally", not the invisible
  "Vision véritable":     [true,  true,  true, true,  true],
  "Vision aveugle":       [true,  false, true, true,  true],    // 30 ft: the target behind the Darkness is at 55 ft
  "Vibrations":           [false, false, true, false, false],   // Tremorsense locates, it does not see (#118): only its sight counts
  "Sens tout":            [true,  true,  true, true,  true],    // the core's generic mode, 120 ft, no walls or light
  "Voir l'invisible":     [false, false, true, false, true]     // a sight: no Darkness, no dark, but the invisible in full light
}).map(([name, row]) => [name, Object.fromEntries(TARGETS.map((t, i) => [t, row[i]]))]));

export default {
  name: "vision — Ténèbres, Vision du diable, vision dans le noir, vision véritable, vision aveugle (Arène de la vision)",
  scene: ARENE_VISION.name,

  async run(ctx) {
    const tokens = {};
    for ( const name of [...OBSERVERS, ...TARGETS] ) tokens[name] = await ctx.token(name);
    const warlock = tokens["Occultiste du diable"];
    const grid = await ctx.gridSize();
    ctx.restore(() => ctx.removeEffectsNamed(warlock, /concentr/i));

    const matrix = async () => (await ctx.engine("visionMatrix", { observerIds: OBSERVERS.map(n => tokens[n].id), targetIds: TARGETS.map(n => tokens[n].id) })).rows;
    const show = rows => {
      for ( const r of rows ) {
        const why = [r.rules.blocked.length ? `zone ${r.rules.blocked.join("+")}` : null, `${r.rules.distance} ${r.rules.units ?? "ft"}`,
          r.rules.devilsSight ? `Vision du diable ${r.rules.devilsSight}` : null, r.rules.lineOfSight ? null : (r.rules.lineOfSightThroughDarkness ? "vue coupée par les ténèbres seules" : "pas de ligne de vue"),
          r.rules.hears ? "entend" : null].filter(Boolean).join(", ");
        ctx.log(`  ${r.observer} → ${r.target} : règles ${r.rules.sees ? "voit" : "ne voit pas"} (${why}) ; écran ${r.screen}`);
      }
    };

    // 0. Before the Darkness and the dark: everyone sees everything (full light), except the invisible Target.
    const before = (await matrix()).filter(r => r.target !== "Cible invisible");
    ctx.expect(before.every(r => r.rules.sees === true), "pleine lumière : chaque observateur voit chaque cible visible (règles)");
    ctx.expect(before.every(r => ["seen", "outline"].includes(r.screen)), "pleine lumière : chaque cible visible s'affiche");

    // 1. Darkness from the Devil's Sight Warlock's sheet, centered on the Target in the darkness.
    const box = await ctx.box(tokens[ARENE_VISION.darknessOn]);
    const centre = { x: box.x + (box.width / 2), y: box.y + (box.height / 2) };
    const dark = await ctx.use({ tokenId: warlock.id, identifier: "darkness", area: { shape: "circle", ...centre, radius: 3 * grid } });
    ctx.expect(dark.used && !!dark.regionId, "Ténèbres posées");
    if ( !dark.regionId ) return;
    ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: dark.regionId }).catch(() => {}));

    // 1 bis. Ordinary dark (no spell) around the Target in the dark: an "Adjust Darkness" region, like `furtivite-bg3`.
    const { sceneId } = await ctx.scene();
    const [dx, dy, dw, dh] = ARENE_VISION.dark;
    const night = await ctx.call("create-region", { sceneId, name: "Obscurité (essai)", color: "#000000",
      shapes: [{ type: "rectangle", x: dx * grid, y: dy * grid, width: dw * grid, height: dh * grid }],
      behaviors: [{ type: "adjustDarknessLevel", name: "Obscurité", system: { mode: 0, modifier: 1 } }] });
    const nightId = night?.id ?? night?.regionId ?? night?.region?.id;
    ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: nightId }).catch(() => {}));
    await pause(2000);

    // 2. Rules and screen, observer by observer. The witness: Devil's Sight and Truesight see through the darkness.
    const rows = await matrix();
    show(rows);
    for ( const r of rows ) {
      const want = EXPECTED[r.observer]?.[r.target];
      if ( want === undefined ) continue;
      ctx.expect(r.rules.sees === want, `${r.observer} ${want ? "voit" : "ne voit pas"} ${r.target} (règles)`);
      // #118: Tremorsense does not see, but it locates (60 ft, no walls or light) — every target has a known position.
      if ( r.observer === "Vibrations" ) ctx.expect(r.rules.locates === true, `Vibrations localise ${r.target} (règles)`);
      // Sight: sharp, or by the outline of its own sense (Blindsight, Truesight: dnd5e's filter) — never hearing.
      if ( r.rules.sees ) ctx.expect(["seen", "outline"].includes(r.screen), `${r.observer} : ${r.target} vue par les règles, affichée par sa vue ou son sens (écran : ${r.screen})`);
      else ctx.expect(r.screen !== "seen", `${r.observer} : ${r.target} non vue par les règles, jamais nette à l'écran (écran : ${r.screen})`);
    }

    // 2 bis. Target refusal (the issue's panel): Hex, "a creature you can see", lent to the Warlock and the Human.
    const HEX = "Compendium.dnd-players-handbook.spells.phbsplHex0000000";
    for ( const name of ["Occultiste du diable", "Humain"] ) await ctx.ensureItem(tokens[name], HEX, { system: { method: "atwill" } });
    const aimed = ["Cible dans les ténèbres", "Cible derrière les ténèbres"].map(n => tokens[n].id);
    const seer = await ctx.engine("sightIssues", { tokenId: warlock.id, identifier: "hex", targetIds: aimed });
    ctx.expect(seer.requiresSight, "Maléfice demande de voir sa cible");
    ctx.expect(!seer.unseen.length, `l'Occultiste du diable peut viser dans et derrière les Ténèbres (refusées : ${seer.unseen.join(", ") || "aucune"})`);
    const blind = await ctx.engine("sightIssues", { tokenId: tokens["Humain"].id, identifier: "hex", targetIds: aimed });
    ctx.expect(blind.unseen.length === 2, `l'Humain, lui, ne peut pas (refusées : ${blind.unseen.join(", ") || "aucune"})`);

    // 2 ter. Issue #42, follow-up (Archibald, 0.281.0): the targeting cursor (`rangeStatus`) — from outside the Darkness, it
    // refused "not in view" a target the rules saw (crossed circle). The edges of the Darkness are no longer a cut line of sight:
    // seeing is `canSee`.
    ctx.expect(!seer.cursorRefused.length, `de l'extérieur, le curseur de l'Occultiste du diable accepte les cibles dans et derrière les Ténèbres (refusées : ${seer.cursorRefused.join(", ") || "aucune"})`);
    ctx.expect(!blind.cursorRefused.length, `le curseur ne refuse plus l'Humain sur les seules Ténèbres — la légalité juge la vue (refusées : ${blind.cursorRefused.join(", ") || "aucune"})`);

    // 2 quater. Archibald's effect (`token.detectionModes.devilsSight.range` as an override, instead of the PHB's): with it, each
    // actor update rebuilt the token data and erased the Devil's Sight given in memory — hearing outline on screen.
    // Survey without resetting all the sources (`screenAfterUpdate`), which `visionMatrix` does not see.
    const archibald = async () => {
      const after = await ctx.engine("screenAfterUpdate", { observerId: warlock.id, targetIds: aimed });
      ctx.log(`  après une mise à jour de l'acteur : ${Object.entries(after.after).map(([n, v]) => `${n} ${v}`).join(", ")} (modes : ${after.modes.join(", ")})`);
      return after;
    };
    const plain = await archibald();
    ctx.expect(Object.values(plain.after).every(v => v === "seen"), "effet du PHB : après une mise à jour de l'acteur, les cibles dans et derrière les Ténèbres restent nettes");
    const { data: wtok } = await ctx.call("get-scene-object", { type: "Token", objectId: warlock.id });
    const sightId = await ctx.itemId(warlock.id, "devils-sight");
    const sightItem = ((await ctx.call("get-actor", { actorId: wtok.actorId })).items ?? []).find(i => i._id === sightId);
    const itemUuid = `Actor.${wtok.actorId}.Item.${sightId}`;
    const phb = (sightItem?.effects ?? []).find(e => JSON.stringify(e.system?.changes ?? e.changes ?? []).includes("senses.darkvision"));
    if ( phb ) {
      ctx.restore(() => ctx.call("upsert-embedded-effect", { uuid: itemUuid, effectData: { disabled: false }, match: { path: "_id", value: phb._id } }).catch(() => {}));
      await ctx.call("upsert-embedded-effect", { uuid: itemUuid, effectData: { disabled: true }, match: { path: "_id", value: phb._id } });
    }
    const PLAYER = "Vision du diable (effet du joueur, issue 42)";
    ctx.restore(() => ctx.call("remove-embedded-effect", { uuid: itemUuid, match: { path: "name", value: PLAYER } }).catch(() => {}));
    await ctx.call("upsert-embedded-effect", { uuid: itemUuid, effectData: { name: PLAYER, transfer: true,
      system: { changes: [{ key: "token.detectionModes.devilsSight.range", value: "120", type: "override", phase: "initial" }] } } });
    await pause(1500);
    const withEffect = await archibald();
    ctx.expect(Object.values(withEffect.after).every(v => v === "seen"), "effet du joueur : après une mise à jour de l'acteur, les cibles dans et derrière les Ténèbres restent nettes (pas le contour de l'ouïe)");
    ctx.expect(withEffect.modes.includes("devilsSight") && withEffect.modes.includes("dasHearing"), "effet du joueur : la Vision du diable et l'ouïe sont redonnées après la mise à jour");
    const withRules = await ctx.engine("sightIssues", { tokenId: warlock.id, identifier: "hex", targetIds: aimed });
    ctx.expect(!withRules.unseen.length && !withRules.cursorRefused.length, "effet du joueur : visée acceptée dans et derrière les Ténèbres");
    await ctx.call("remove-embedded-effect", { uuid: itemUuid, match: { path: "name", value: PLAYER } }).catch(() => {});
    if ( phb ) await ctx.call("upsert-embedded-effect", { uuid: itemUuid, effectData: { disabled: false }, match: { path: "_id", value: phb._id } });
    await pause(1000);

    // 2 quinquies. In meters (Archibald's table): the scene switches to 1.5 m cells — 120 ft is 36 m; rules, cursor, screen.
    const { data: sceneData } = await ctx.call("get-scene", { sceneId }).then(r => ({ data: r.data ?? r })).catch(() => ({ data: null }));
    const grid0 = { units: sceneData?.grid?.units ?? "ft", distance: sceneData?.grid?.distance ?? 5 };
    ctx.restore(() => ctx.call("update-scene", { sceneId, sceneData: { "grid.units": grid0.units, "grid.distance": grid0.distance } }).catch(() => {}));
    await ctx.call("update-scene", { sceneId, sceneData: { "grid.units": "m", "grid.distance": 1.5 } });
    await pause(2500);
    const metric = (await ctx.engine("visionMatrix", { observerIds: [warlock.id], targetIds: aimed })).rows;
    show(metric);
    for ( const r of metric ) ctx.expect(r.rules.sees && (r.screen === "seen"), `en mètres : l'Occultiste du diable voit ${r.target} de l'extérieur (${r.rules.distance} m, écran : ${r.screen})`);
    const metricAim = await ctx.engine("sightIssues", { tokenId: warlock.id, identifier: "hex", targetIds: aimed });
    ctx.expect(!metricAim.unseen.length && !metricAim.cursorRefused.length, "en mètres : visée de l'extérieur acceptée (règles et curseur)");
    const metricAfter = await archibald();
    ctx.expect(Object.values(metricAfter.after).every(v => v === "seen"), "en mètres : après une mise à jour de l'acteur, les cibles restent nettes");
    await ctx.call("update-scene", { sceneId, sceneData: { "grid.units": grid0.units, "grid.distance": grid0.distance } });
    await pause(2500);

    // 2 sexies. Issue #42, follow-up (0.281.1): the RENDERING. Targeting accepted, but the token in the Darkness stayed a black
    // silhouette for the player: the mode, without a filter, was drawn only under the vision veil ("veiled"). It now carries
    // the dark red edging of Devil's Sight, whole token, above the veil.
    const drawn = (await ctx.engine("visionMatrix", { observerIds: [warlock.id], targetIds: aimed })).rows;
    for ( const r of drawn ) {
      ctx.log(`  rendu : ${r.target} écran ${r.screen}, filtre ${JSON.stringify(r.filter)}`);
      ctx.expect(r.screen === "seen" && r.filter === "devilsSight", `de l'extérieur, ${r.target} s'affiche avec le liseré de la Vision du diable, au-dessus du voile (écran : ${r.screen}, filtre : ${JSON.stringify(r.filter)})`);
    }
    // The witness in full light: seen by base sight, no edging.
    const lit = (await ctx.engine("visionMatrix", { observerIds: [warlock.id], targetIds: [tokens["Cible au loin"].id] })).rows[0];
    ctx.expect(lit.screen === "seen" && lit.filter === null, `en pleine lumière, aucun liseré (écran : ${lit.screen}, filtre : ${JSON.stringify(lit.filter)})`);
    // Blinded: Devil's Sight is a sight — no more edging, the hearing outline alone.
    ctx.restore(() => ctx.call("set-status", { tokenId: warlock.id, statusId: "blinded", active: false }).catch(() => {}));
    await ctx.call("set-status", { tokenId: warlock.id, statusId: "blinded", active: true });
    await pause(1500);
    const blindDrawn = (await ctx.engine("visionMatrix", { observerIds: [warlock.id], targetIds: aimed })).rows;
    for ( const r of blindDrawn ) ctx.expect(r.screen === "heard" && r.filter === "hearing", `Aveuglé, l'Occultiste n'a plus que l'ouïe pour ${r.target} (écran : ${r.screen}, filtre : ${JSON.stringify(r.filter)})`);
    await ctx.call("set-status", { tokenId: warlock.id, statusId: "blinded", active: false });
    await pause(1000);

    // 2 septies. The Ethereal plane (§225; skipped if the "Automated Ethereal Plane" setting is off). Ethereal Warlock: sees the
    // material plane up to 60 ft — the target in the Darkness (55 ft) with the Devil's Sight tint, not the one behind (85 ft).
    // Then ethereal target and material Warlock: Devil's Sight does not see into the Ethereal.
    const ethereal = await ctx.call("get-setting", { namespace: "dnd5e-combat", key: "etherealPlane" }).then(r => r?.value ?? r).catch(() => null);
    if ( ethereal === false ) ctx.log("  plan Éthéré automatisé coupé : phase sautée");
    else {
      const inside = tokens["Cible dans les ténèbres"];
      const shown = async () => Object.fromEntries((await ctx.engine("visionMatrix", { observerIds: [warlock.id], targetIds: aimed })).rows
        .map(r => [r.target, r]));
      ctx.restore(() => ctx.call("set-status", { tokenId: warlock.id, statusId: "ethereal", active: false }).catch(() => {}));
      ctx.restore(() => ctx.call("set-status", { tokenId: inside.id, statusId: "ethereal", active: false }).catch(() => {}));
      await ctx.call("set-status", { tokenId: warlock.id, statusId: "ethereal", active: true });
      await pause(1500);
      const fromEthereal = await shown();
      const near = fromEthereal["Cible dans les ténèbres"], beyond = fromEthereal["Cible derrière les ténèbres"];
      ctx.expect(near?.screen === "seen" && near.filter === "devilsSight", `Éthéré : la cible dans les Ténèbres (55 ft) s'affiche teintée par la Vision du diable (écran : ${near?.screen}, filtre : ${JSON.stringify(near?.filter)})`);
      ctx.expect(beyond?.screen === "hidden", `Éthéré : la cible derrière les Ténèbres (85 ft, au-delà de 60 ft) n'est pas vue (écran : ${beyond?.screen})`);
      await ctx.call("set-status", { tokenId: warlock.id, statusId: "ethereal", active: false });
      await ctx.call("set-status", { tokenId: inside.id, statusId: "ethereal", active: true });
      await pause(1500);
      const intoEthereal = (await shown())["Cible dans les ténèbres"];
      ctx.expect(intoEthereal?.screen === "hidden", `cible éthérée : la Vision du diable ne voit pas dans l'Éthéré (écran : ${intoEthereal?.screen})`);
      await ctx.call("set-status", { tokenId: inside.id, statusId: "ethereal", active: false });
      await pause(1000);
    }

    // 3. Devil's Sight range: the Warlock 125 ft from the target in the darkness (column 42).
    const [, row] = ARENE_VISION.tokens["Occultiste du diable"];
    const far = await ctx.call("move-token", { tokenId: warlock.id, x: 42 * grid, y: row * grid, elevation: 0 });
    ctx.expect(!!far, "Occultiste du diable déplacé à 125 ft");
    await pause(800);
    const away = (await ctx.engine("visionMatrix", { observerIds: [warlock.id], targetIds: [tokens["Cible dans les ténèbres"].id], screen: true })).rows[0];
    show([away]);
    ctx.expect(away.rules.sees === false, `au-delà de 120 ft, la Vision du diable ne voit plus dans les ténèbres (${away.rules.distance} ft)`);
    ctx.expect(away.screen !== "seen", `au-delà de 120 ft, la cible n'est pas nette à l'écran (écran : ${away.screen})`);
    const [x0, y0] = ARENE_VISION.tokens["Occultiste du diable"];
    await ctx.call("move-token", { tokenId: warlock.id, x: x0 * grid, y: y0 * grid, elevation: 0 });
    await pause(800);

    // 4 bis. Blinded and Deafened: Devil's Sight and Truesight go out, Blindsight stays; the Deafened hears
    // nothing (no outline, no ear).
    const status = (name, statusId, active) => ctx.call("set-status", { tokenId: tokens[name].id, statusId, active });
    const BLINDED = ["Occultiste du diable", "Vision véritable", "Vision aveugle"];
    for ( const name of BLINDED ) { ctx.restore(() => status(name, "blinded", false).catch(() => {})); await status(name, "blinded", true); }
    ctx.restore(() => status("Humain", "deafened", false).catch(() => {}));
    await status("Humain", "deafened", true);
    await pause(1000);
    const BLIND_EXPECTED = {
      "Occultiste du diable": [false, false, false, false, false],
      "Vision véritable":     [false, false, false, false, false],
      "Vision aveugle":       [true,  false, true,  true,  true]    // 30 ft: in the Darkness, the witness, the dark, the Invisible
    };
    const impaired = (await ctx.engine("visionMatrix", { observerIds: [...BLINDED, "Humain"].map(n => tokens[n].id), targetIds: TARGETS.map(n => tokens[n].id) })).rows;
    ctx.log("Aveuglé (Occultiste, Vision véritable, Vision aveugle), Assourdi (Humain) :");
    show(impaired);
    for ( const r of impaired ) {
      if ( r.observer === "Humain" ) {
        const want = EXPECTED.Humain[r.target];
        ctx.expect(r.rules.hears === false, `Humain Assourdi : n'entend pas ${r.target}`);
        if ( !want ) ctx.expect(r.screen === "hidden", `Humain Assourdi : ${r.target} ni vue ni entendue à l'écran (écran : ${r.screen})`);
        continue;
      }
      const want = BLIND_EXPECTED[r.observer][TARGETS.indexOf(r.target)];
      ctx.expect(r.rules.sees === want, `${r.observer} Aveuglé ${want ? "perçoit" : "ne voit pas"} ${r.target} (règles)`);
      if ( r.rules.sees ) ctx.expect(["seen", "outline"].includes(r.screen), `${r.observer} Aveuglé : ${r.target} affichée par son sens (écran : ${r.screen})`);
      // What it does not perceive, it hears: the hearing outline, even Blinded (the core skips light perception from a blinded
      // source; the engine's `dasHearing` mode takes over).
      else ctx.expect(r.screen === (r.rules.hears ? "heard" : "hidden"), `${r.observer} Aveuglé : ${r.target} ${r.rules.hears ? "entendue" : "absente"} à l'écran (écran : ${r.screen})`);
    }
    for ( const name of BLINDED ) await status(name, "blinded", false);
    await status("Humain", "deafened", false);
    await pause(800);

    // 4 ter. The GM's gesture: the Elf Ranger already selected, then Blinded by hand — the core redoes only its vision source
    // (placeables/token.mjs:4580), not all of them: the hearing in memory must survive (it disappeared, seen on 2026-11-08).
    const ranger = tokens["Rôdeur elfe"];
    ctx.restore(() => ctx.engine("controlToken", { tokenId: null }).catch(() => {}));
    await ctx.engine("controlToken", { tokenId: ranger.id });
    await pause(800);
    ctx.restore(() => status("Rôdeur elfe", "blinded", false).catch(() => {}));
    await status("Rôdeur elfe", "blinded", true);
    await pause(1500);
    const heardBlind = await ctx.engine("screenHere", { targetIds: TARGETS.map(n => tokens[n].id) });
    ctx.log(`Rôdeur elfe sélectionné puis Aveuglé : ${heardBlind.tokens.map(t => `${t.name} ${t.shown}`).join(", ")}`);
    ctx.expect(heardBlind.tokens.every(t => t.shown === "heard"), "Rôdeur elfe Aveuglé à la main : chaque cible entendue (contour de l'ouïe)");
    await status("Rôdeur elfe", "blinded", false);
    await ctx.engine("controlToken", { tokenId: null });
    await pause(800);

    // 4 quater. Daylight (level 3) placed 20 ft from the Darkness (level 2): they are dispelled, the Human sees the target.
    const human = tokens["Humain"];
    await ctx.ensureItem(human, "Compendium.dnd-players-handbook.spells.phbsplDaylight00", { system: { method: "atwill" } });
    ctx.restore(() => ctx.removeEffectsNamed(human, /concentr/i));
    const day = await ctx.use({ tokenId: human.id, identifier: "daylight", area: { shape: "circle", x: centre.x - (4 * grid), y: centre.y, radius: 12 * grid } });
    ctx.expect(day.used && !!day.regionId, "Lumière du jour posée");
    if ( day.regionId ) {
      ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: day.regionId }).catch(() => {}));
      await pause(2500);
      const regions = (await ctx.call("list-scene-objects", { sceneId, types: ["Region"] })).objects?.Region ?? [];
      ctx.expect(!regions.some(r => r.id === dark.regionId), "les Ténèbres sont dissipées");
      const after = (await ctx.engine("visionMatrix", { observerIds: [human.id], targetIds: [tokens["Cible dans les ténèbres"].id, tokens["Cible derrière les ténèbres"].id] })).rows;
      show(after);
      for ( const r of after ) ctx.expect(r.rules.sees && (r.screen === "seen"), `Ténèbres dissipées : l'Humain voit ${r.target} (écran : ${r.screen})`);
      await ctx.call("delete-scene-object", { type: "Region", objectId: day.regionId }).catch(() => {});
      await pause(1000);
    }

    // 4. "Simulated Vision" setting off: the core's rendering alone, for comparison (log).
    const setting = await ctx.call("get-setting", { namespace: "dnd5e-combat", key: "vision" });
    const was = setting?.value ?? setting;
    ctx.restore(() => ctx.call("set-setting", { namespace: "dnd5e-combat", key: "vision", value: was }));
    await ctx.call("set-setting", { namespace: "dnd5e-combat", key: "vision", value: false });
    await pause(800);
    ctx.log("réglage « Vision simulée » coupé (rendu du cœur seul) :");
    show(await matrix());
  }
};
