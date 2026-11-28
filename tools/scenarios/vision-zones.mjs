/**
 * Issue #42, follow-up: sight and hearing facing zones and walls, in the "Vision Arena" (`node tools/arene-vision.mjs` first).
 * Each phase places its zone or walls, surveys rules and screen for each observer (`api.mcp.visionMatrix`), then removes them.
 *
 *  1. Fog Cloud (20 ft Sphere) on the Target in the darkness: the mist is pierced only by Blindsight, Tremorsense
 *     and Sense All — not Truesight, nor Devil's Sight, nor Darkvision. The rest is heard.
 *  2. Silence (20 ft Sphere) in the same place: sight does not change, but nothing is heard inside or through ("no sound can
 *     be created within or pass through the Sphere"); elsewhere, it is heard.
 *  3. Walls between the left observers and the far Target: solid wall (neither sight nor sound), glass pane (sight passes, not
 *     sound), curtain (sound passes, not sight). Sense All ignores walls.
 *  4. A target flying in the dark: Tremorsense no longer perceives it (detection-modes/tremor-perception.mjs), Darkvision
 *     does.
 *  5. The Invisible revealed: See Invisibility (the Human, on themselves); Faerie Fire on the invisible Target — all see it.
 *  6. Dim Light: the Target in the dark, first in obscurity, then under a Dim Light. In the dark, the Human does not see it
 *     and the Ranger (Darkvision) sees it as in Dim Light (Disadvantage on Perception); in Dim Light, the Human
 *     sees it, with Disadvantage on Perception, the Ranger and the Warlock (Devil's Sight) as in Bright Light, without
 *     Disadvantage.
 *  7. "Unconscious: neither sight nor hearing" setting: the Unconscious Ranger neither sees nor hears anything (rules and
 *     screen); setting unchecked, it keeps its senses.
 * Screen: what the rules see is shown (sharp or by the outline of its sense); the rest is heard (hearing outline) or absent.
 */
import { ARENE_VISION } from "../lib/stages.mjs";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const SPELLS = "Compendium.dnd-players-handbook.spells.";
const FOG = `${SPELLS}phbsplFogCloud00`;
const SILENCE = `${SPELLS}phbsplSilence000`;
const OBSERVERS = ["Humain", "Occultiste du diable", "Rôdeur elfe", "Vision véritable", "Vision aveugle", "Vibrations", "Sens tout", "Voir l'invisible"];
const LEFT = ["Humain", "Occultiste du diable", "Rôdeur elfe", "Vision véritable", "Sens tout", "Voir l'invisible"];   // left of wall
const WALL = { NONE: 0, NORMAL: 20 };

export default {
  name: "vision — brume, Silence, murs (vue, son), vibrations et vol (Arène de la vision)",
  scene: ARENE_VISION.name,

  async run(ctx) {
    const tokens = {};
    for ( const name of [...OBSERVERS, ...Object.keys(ARENE_VISION.tokens).filter(n => n.startsWith("Cible"))] ) tokens[name] = await ctx.token(name);
    const caster = tokens["Occultiste du diable"];
    const grid = await ctx.gridSize();
    const { sceneId } = await ctx.scene();
    ctx.restore(() => ctx.removeEffectsNamed(caster, /concentr/i));
    const matrix = async (observers, targets) => (await ctx.engine("visionMatrix", { observerIds: observers.map(n => tokens[n].id),
      targetIds: targets.map(n => tokens[n].id) })).rows;
    const show = rows => { for ( const r of rows ) ctx.log(`  ${r.observer} → ${r.target} : règles ${r.rules.sees ? "voit" : "ne voit pas"}${r.rules.hears ? ", entend" : ", n'entend pas"} (${r.rules.distance} ft${r.rules.blocked.length ? `, ${r.rules.blocked.join("+")}` : ""}) ; écran ${r.screen}`); };
    /** One row: expected rules (sight, hearing), and the screen that follows from them. */
    const check = (r, sees, hears, label) => {
      ctx.expect(r.rules.sees === sees, `${label} : ${r.observer} ${sees ? "voit" : "ne voit pas"} ${r.target} (règles)`);
      if ( hears !== null ) ctx.expect(r.rules.hears === hears, `${label} : ${r.observer} ${hears ? "entend" : "n'entend pas"} ${r.target}`);
      // #118: a target located without being seen (Tremorsense) keeps the outline of its sense on screen.
      const screen = r.rules.sees ? ["seen", "outline"] : (r.rules.locates ? ["outline"] : [r.rules.hears ? "heard" : "hidden"]);
      if ( r.observer === "Vibrations" && !r.rules.sees ) ctx.expect(r.rules.locates === (label !== "en vol"), `${label} : Vibrations ${label !== "en vol" ? "localise" : "ne localise pas"} ${r.target} (règles)`);
      ctx.expect(screen.includes(r.screen), `${label} : ${r.observer} → ${r.target} à l'écran ${screen.join(" ou ")} (écran : ${r.screen})`);
    };
    const box = await ctx.box(tokens["Cible dans les ténèbres"]);
    const centre = { x: box.x + (box.width / 2), y: box.y + (box.height / 2) };
    const zone = async (uuid, identifier) => {
      await ctx.ensureItem(caster, uuid, { system: { method: "atwill" } });
      const used = await ctx.use({ tokenId: caster.id, identifier, area: { shape: "circle", ...centre, radius: 4 * grid } });
      ctx.expect(used.used && !!used.regionId, `${identifier} posé`);
      if ( used.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: used.regionId }).catch(() => {}));
      await pause(2000);
      return used.regionId;
    };
    const drop = async id => { if ( id ) await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {}); await pause(1200); };
    const IN = "Cible dans les ténèbres", BEHIND = "Cible derrière les ténèbres", FAR = "Cible au loin";

    // 1. Nappe de brouillard.
    const fog = await zone(FOG, "fog-cloud");
    if ( fog ) {
      // [inside, behind]: does sight reach them through the mist?
      const FOG_SEES = { "Humain": [false, false], "Occultiste du diable": [false, false], "Rôdeur elfe": [false, false],
        "Vision véritable": [false, false], "Vision aveugle": [true, false], "Vibrations": [false, false], "Sens tout": [true, true],
        "Voir l'invisible": [false, false] };
      const rows = await matrix(OBSERVERS, [IN, BEHIND, FAR]);
      ctx.log("Nappe de brouillard :"); show(rows);
      for ( const r of rows ) {
        const sees = (r.target === FAR) ? true : FOG_SEES[r.observer][(r.target === IN) ? 0 : 1];
        check(r, sees, true, "brume");
      }
      await drop(fog);
      await ctx.removeEffectsNamed(caster, /concentr/i);
    }

    // 2. Silence.
    const silence = await zone(SILENCE, "silence");
    if ( silence ) {
      const rows = await matrix(["Humain", "Rôdeur elfe", "Vision aveugle", "Vibrations"], [IN, BEHIND, FAR]);
      ctx.log("Silence :"); show(rows);
      for ( const r of rows ) {
        // Sight does not change (full light); hearing stops at the Sphere — the target inside, or behind it.
        check(r, true, (r.target === FAR) ? true : ((r.target === IN) ? false : null), "Silence");
        if ( r.target === BEHIND ) {
          const crosses = r.rules.blocked.includes("silence");
          ctx.expect(r.rules.hears === !crosses, `Silence : ${r.observer} ${crosses ? "n'entend pas" : "entend"} ${r.target} (le trait ${crosses ? "traverse" : "évite"} la sphère)`);
        }
      }
      await drop(silence);
      await ctx.removeEffectsNamed(caster, /concentr/i);
    }

    // 3. Walls between the left (column 6) and the far Target (column 10): column 9, rows 0 to 7.
    const x = 9 * grid;
    const listWalls = async () => ((await ctx.call("list-scene-objects", { sceneId, types: ["Wall"] })).objects?.Wall ?? []).map(w => w.id);
    for ( const [label, sight, sound] of [["mur plein", WALL.NORMAL, WALL.NORMAL], ["vitre", WALL.NONE, WALL.NORMAL], ["rideau", WALL.NORMAL, WALL.NONE]] ) {
      const before = new Set(await listWalls());
      await ctx.call("create-walls", { sceneId, walls: [{ c: [x, 0, x, 7 * grid], move: WALL.NORMAL, sight, light: sight, sound }] });
      const added = (await listWalls()).filter(id => !before.has(id));
      ctx.restore(async () => { for ( const id of added ) await ctx.call("delete-scene-object", { type: "Wall", objectId: id }).catch(() => {}); });
      await pause(1500);
      const rows = await matrix(LEFT, [FAR]);
      ctx.log(`${label} :`); show(rows);
      for ( const r of rows ) {
        const always = r.observer === "Sens tout";   // Sense All: no walls, no light
        check(r, always || (sight === WALL.NONE), sound === WALL.NONE, label);
      }
      for ( const id of added ) await ctx.call("delete-scene-object", { type: "Wall", objectId: id }).catch(() => {});
      await pause(1000);
    }

    // 4. Flying in the dark: Darkvision sees it; Tremorsense locates it on the ground (without seeing it, #118), not in flight.
    const [dx, dy, dw, dh] = ARENE_VISION.dark;
    const night = await ctx.call("create-region", { sceneId, name: "Obscurité (essai)", color: "#000000",
      shapes: [{ type: "rectangle", x: dx * grid, y: dy * grid, width: dw * grid, height: dh * grid }],
      behaviors: [{ type: "adjustDarknessLevel", name: "Obscurité", system: { mode: 0, modifier: 1 } }] });
    const nightId = night?.id ?? night?.regionId ?? night?.region?.id;
    ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: nightId }).catch(() => {}));
    const dark = tokens["Cible dans le noir"];
    const fly = active => ctx.call("set-status", { tokenId: dark.id, statusId: "flying", active });
    ctx.restore(() => fly(false).catch(() => {}));
    await pause(1500);
    let rows = await matrix(["Vibrations", "Rôdeur elfe"], ["Cible dans le noir"]);
    ctx.log("dans le noir, au sol :"); show(rows);
    for ( const r of rows ) check(r, r.observer === "Rôdeur elfe", true, "au sol");
    await fly(true);
    await pause(1500);
    rows = await matrix(["Vibrations", "Rôdeur elfe"], ["Cible dans le noir"]);
    ctx.log("dans le noir, en vol :"); show(rows);
    for ( const r of rows ) check(r, r.observer === "Rôdeur elfe", true, "en vol");
    await fly(false);
    await ctx.call("delete-scene-object", { type: "Region", objectId: nightId }).catch(() => {});
    await pause(1000);

    // 5. The Invisible revealed: See Invisibility (on themselves, the Human); Faerie Fire on the invisible Target (Warlock).
    const invisible = "Cible invisible";
    await ctx.call("set-status", { tokenId: tokens[invisible].id, statusId: "invisible", active: true });
    await ctx.removeEffectsNamed(tokens[invisible], /outlined|silhouette|faerie|lueur/i);
    await pause(1000);
    let rowsInv = await matrix(["Humain", "Rôdeur elfe"], [invisible]);
    for ( const r of rowsInv ) check(r, false, true, "Invisible");
    const human = tokens["Humain"];
    await ctx.ensureItem(human, `${SPELLS}phbsplSeeInvisib`, { system: { method: "atwill" } });
    ctx.restore(() => ctx.removeEffectsNamed(human, /see invisib|détection|concentr/i));
    // The spell's effect (special sense "Invisible creatures") is placed by the dnd5e card button: placed here directly.
    const seeItem = await ctx.itemId(human.id, "see-invisibility");
    await ctx.engine("placeItemEffect", { tokenId: human.id, casterId: human.id, itemId: seeItem, effectId: "BRwB0T8buWhJAuDx" });
    await pause(1500);
    rowsInv = await matrix(["Humain", "Rôdeur elfe"], [invisible]);
    ctx.log("Détection de l'invisibilité (Humain) :"); show(rowsInv);
    for ( const r of rowsInv ) check(r, r.observer === "Humain", true, "Détection de l'invisibilité");
    await ctx.removeEffectsNamed(human, /see invisib|détection|concentr/i);
    await pause(1000);
    // Faerie Fire: the target's Dexterity saving throw — replayed until it fails (10 attempts at most).
    await ctx.ensureItem(caster, `${SPELLS}phbsplFaerieFire`, { system: { method: "atwill" } });
    const ib = await ctx.box(tokens[invisible]);
    let lit = false;
    for ( let n = 1; (n <= 10) && !lit; n++ ) {
      const used = await ctx.use({ tokenId: caster.id, identifier: "faerie-fire",
        area: { shape: "rectangle", x: ib.x - (grid / 2), y: ib.y - (grid / 2), width: grid * 2, height: grid * 2 } });
      if ( used.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: used.regionId }).catch(() => {}));
      await pause(2500);
      lit = (await ctx.effects(tokens[invisible])).some(e => /outlined|silhouette|faerie|lueur/i.test(e.name ?? ""));
      if ( !lit ) { await ctx.removeEffectsNamed(caster, /concentr/i); if ( used.regionId ) await ctx.call("delete-scene-object", { type: "Region", objectId: used.regionId }).catch(() => {}); }
    }
    ctx.expect(lit, "Lueurs féeriques : la Cible invisible a raté sa sauvegarde");
    if ( lit ) {
      ctx.restore(() => ctx.removeEffectsNamed(tokens[invisible], /outlined|silhouette|faerie|lueur/i));
      rowsInv = await matrix(["Humain", "Rôdeur elfe", "Voir l'invisible"], [invisible]);
      ctx.log("Lueurs féeriques sur la Cible invisible :"); show(rowsInv);
      for ( const r of rowsInv ) check(r, true, true, "Lueurs féeriques");
    }

    // 6. Dim Light: obscurity on the Target in the dark, then a Dim Light on it.
    const LIGHTS = ["Humain", "Rôdeur elfe", "Occultiste du diable"];
    const DIM = 1, BRIGHT = 2;
    const night2 = await ctx.call("create-region", { sceneId, name: "Obscurité (lumière faible)", color: "#000000",
      shapes: [{ type: "rectangle", x: dx * grid, y: dy * grid, width: dw * grid, height: dh * grid }],
      behaviors: [{ type: "adjustDarknessLevel", name: "Obscurité", system: { mode: 0, modifier: 1 } }] });
    const night2Id = night2?.id ?? night2?.regionId ?? night2?.region?.id;
    ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: night2Id }).catch(() => {}));
    await pause(1500);
    rows = await matrix(LIGHTS, ["Cible dans le noir"]);
    ctx.log("obscurité :"); show(rows);
    for ( const r of rows ) {
      ctx.log(`    lumière ${r.rules.light.level} perçue ${r.rules.light.perceived}, Désavantage en Perception : ${r.rules.light.perceptionDisadvantage}`);
      if ( r.observer === "Humain" ) check(r, false, true, "obscurité");
      if ( r.observer === "Rôdeur elfe" ) {
        check(r, true, true, "obscurité");
        ctx.expect(r.rules.light.perceived === DIM && r.rules.light.perceptionDisadvantage === true,
          "obscurité : le Rôdeur la perçoit comme en lumière faible, Désavantage en Perception");
      }
    }
    const listLights = async () => ((await ctx.call("list-scene-objects", { sceneId, types: ["AmbientLight"] })).objects?.AmbientLight ?? []).map(l => l.id);
    const beforeLights = new Set(await listLights());
    const db = await ctx.box(dark);
    await ctx.call("place-light", { sceneId, x: db.x + (db.width / 2), y: db.y + (db.height / 2), bright: 0, dim: 1.5 * grid });
    const addedLights = (await listLights()).filter(id => !beforeLights.has(id));
    ctx.restore(async () => { for ( const id of addedLights ) await ctx.call("delete-scene-object", { type: "AmbientLight", objectId: id }).catch(() => {}); });
    ctx.expect(addedLights.length === 1, "lumière faible posée");
    await pause(1500);
    rows = await matrix(LIGHTS, ["Cible dans le noir"]);
    ctx.log("lumière faible :"); show(rows);
    for ( const r of rows ) {
      ctx.log(`    lumière ${r.rules.light.level} perçue ${r.rules.light.perceived}, Désavantage en Perception : ${r.rules.light.perceptionDisadvantage}`);
      check(r, true, true, "lumière faible");
      ctx.expect(r.rules.light.level === DIM, `lumière faible : la cible est en lumière faible (${r.observer})`);
      const human = r.observer === "Humain";
      ctx.expect(r.rules.light.perceived === (human ? DIM : BRIGHT) && r.rules.light.perceptionDisadvantage === human,
        `lumière faible : ${r.observer} ${human ? "a" : "n'a pas"} le Désavantage en Perception`);
    }
    for ( const id of addedLights ) await ctx.call("delete-scene-object", { type: "AmbientLight", objectId: id }).catch(() => {});
    await ctx.call("delete-scene-object", { type: "Region", objectId: night2Id }).catch(() => {});
    await pause(1000);

    // 7. "Unconscious: neither sight nor hearing" setting.
    const ranger = tokens["Rôdeur elfe"];
    const got = await ctx.call("get-setting", { namespace: "dnd5e-combat", key: "unconsciousSenses" });
    const wasRule = got?.value ?? got ?? false;
    ctx.restore(() => ctx.call("set-setting", { namespace: "dnd5e-combat", key: "unconsciousSenses", value: wasRule }));
    const asleep = active => ctx.call("set-status", { tokenId: ranger.id, statusId: "unconscious", active });
    ctx.restore(async () => { await asleep(false).catch(() => {}); await ctx.call("set-status", { tokenId: ranger.id, statusId: "prone", active: false }).catch(() => {}); });
    await asleep(true);
    for ( const rule of [true, false] ) {
      await ctx.call("set-setting", { namespace: "dnd5e-combat", key: "unconsciousSenses", value: rule });
      await pause(1500);
      rows = await matrix(["Rôdeur elfe"], [FAR, "Cible dans le noir"]);
      ctx.log(`Rôdeur Inconscient, réglage ${rule ? "coché" : "décoché"} :`); show(rows);
      for ( const r of rows ) check(r, !rule, !rule, `Inconscient (réglage ${rule ? "coché" : "décoché"})`);
    }
    await asleep(false);
    await ctx.call("set-status", { tokenId: ranger.id, statusId: "prone", active: false }).catch(() => {});
  }
};
