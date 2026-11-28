/**
 * §184-§186: "BG3" Stealth on a real map — the Redbrand hideout ("Redbrand Hideout [30x20]" of `dnd-6`). The northwest room has
 * no light; a corridor, doors open, leads to the room just south, lit by a lamp at the back, where two Bandits (Hostile, no
 * Darkvision) stand under the door. The Wizard in stealth mode:
 *  1. at the back of the dark room: no check or spotting, and the Bandits do not see the Wizard;
 *  2. the Bandits turned north (toward the door), the Wizard facing them but in complete darkness: still no check —
 *     they cannot see in the dark;
 *  3. in the corridor, in Dim Light: each entry into their field of view is a check (Stealth against passive Perception)
 *     — one failure = doubt, two = spotted; enter and leave until spotted (fourteen entries without two failures:
 *     also consistent);
 *  4. the Bandits turned south (toward the lamp), the Wizard under the lamp in front of them: spotted at once;
 *  5. leaving the mode clears the spottings.
 * A real darkness (the room's light off), where `furtivite-bg3` places an "Adjust darkness" region in the arena.
 * Restores: settings, stealth mode, positions, rotations.
 */
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "furtivite-repaire — BG3 dans le repaire : pièce sombre, doute puis repéré, pièce éclairée",
  scene: "Redbrand Hideout [30x20]",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    // §319: the post's two Bandits, placed by the scenario under the south door — a Bandit left INSIDE the dark room (seen on
    // 2026-11-01, moved by another run) refused the switch to stealth and made it look as if the Bandits saw in the dark. The third
    // ("Bloodied", to the east) stays where it is.
    const posts = [[1200, 1400], [1300, 1300]];
    const near = t => Math.hypot(t.x - 1250, t.y - 1350);
    const bandits = tokens.filter(t => t.name === "Bandit").sort((a, b) => near(a) - near(b)).slice(0, 2);
    const mage = tokens.find(t => t.name === "Magicien");
    if ( !mage || (bandits.length < 2) ) { ctx.log("Magicien ou les deux Bandits absents : non applicable"); return; }
    for ( const [i, b] of bandits.entries() ) {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: b.id });
      ctx.restore(() => ctx.call("move-token", { tokenId: b.id, x: data.x, y: data.y, elevation: data.elevation ?? 0 }));
      await ctx.call("move-token", { tokenId: b.id, x: posts[i][0], y: posts[i][1], elevation: 0 });
    }
    for ( const [key, value] of [["visionCones", true], ["stealthRules", "bg3"]] ) {
      const r = await ctx.engine("setting", { key, value });
      ctx.restore(() => ctx.engine("setting", { key, value: r.before }));
    }
    const st = (op="state", extra={}) => ctx.engine("stealth", { op, tokenId: mage.id, ...extra });
    ctx.restore(() => st("set", { on: false }));
    // The Bandits look north (rotation 180: 0 looks down), toward the door of the dark room.
    for ( const b of bandits ) {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: b.id });
      ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: b.id, data: { rotation: data.rotation ?? 0 } }));
    }
    const face = async rotation => {
      for ( const b of bandits ) await ctx.call("update-scene-object", { type: "Token", objectId: b.id, data: { rotation } });
      await pause(500);
    };
    await face(180);
    const { data: m0 } = await ctx.call("get-scene-object", { type: "Token", objectId: mage.id });
    ctx.restore(() => ctx.call("move-token", { tokenId: mage.id, x: m0.x, y: m0.y, elevation: m0.elevation ?? 0 }));
    // Dark room: x 994–1400, y 688–1094; corridor doors at x 1181–1306 (y 1094 and 1200);
    // Bandits at (1200, 1400) and (1300, 1300).
    const corner = [1000, 700];        // at the back, to the west: off the doors' axis
    const facing = [1200, 900];        // in the dark room, facing the doors: complete darkness
    const corridor = [1200, 1100];     // the corridor between the two doors: Dim Light (the south room's lamp)
    const lamp = [1200, 1550];         // under the lamp (1248, 1671), south of the Bandits: full light
    const go = async ([x, y]) => { await ctx.call("move-token", { tokenId: mage.id, x, y, elevation: 0 }); await pause(900); return st("check"); };
    const seen = async () => Promise.all(bandits.map(async b => (await ctx.engine("sees", { observerId: b.id, targetId: mage.id })).sees));

    // 1. At the back of the dark room.
    await st("set", { on: true });
    let s = await go(corner);
    ctx.expect(s.hidden && !s.spottedBy.length, `au fond de la pièce sombre : caché, pas repéré (lumière ${s.light})`);
    ctx.expect((await seen()).every(v => v === false), "les Bandits ne le voient pas");

    // 2. Facing them, in complete darkness: they cannot see in the dark.
    s = await go(facing);
    ctx.expect(s.light === 0, `face aux portes : noir complet (lumière ${s.light})`);
    ctx.expect(!s.spottedBy.length && !Object.keys(s.views ?? {}).length, `dans le noir complet : aucun test (${JSON.stringify(s.views)})`);

    // 3. In the corridor, in Dim Light: a check on each entry into their view.
    s = await go(corridor);
    ctx.expect(s.light === 1, `le couloir : lumière faible (lumière ${s.light})`);
    if ( !s.spottedBy.length ) s = await go(corner);
    // A doubt (one failure) from a Bandit, seen at an earlier entry or at the moment it spots the Wizard (two failures).
    let entries = 0, doubted = false;
    for ( ; (entries < 14) && !s.spottedBy.length; entries++ ) {
      s = await go(corridor);
      if ( Object.values(s.views ?? {}).some(v => (v.fails ?? 0) >= 1) ) doubted = true;
      if ( !s.spottedBy.length ) s = await go(corner);
    }
    ctx.log(`entrées : ${entries}, lumière ${s.light}, état ${JSON.stringify(s.views)}`);
    const tested = Object.values(s.views ?? {}).some(v => v.inView || (v.fails ?? 0) > 0) || doubted || s.spottedBy.length;
    ctx.expect(tested, "dans le couloir : sa présence est testée (doute ou repérage)");
    if ( s.spottedBy.length ) ctx.expect(doubted, `repéré (${s.spottedBy.join(", ")}) seulement après un premier doute`);
    else ctx.log("quatorze entrées sans deux échecs : la Discrétion a tenu (cohérent)");

    // 4. Under the lamp, in front of them: mode reset, spotted at once.
    await st("set", { on: false });
    await go(corner);
    await face(0);
    await st("set", { on: true });
    s = await go(lamp);
    ctx.expect(s.light === 2, `sous la lampe : pleine lumière (lumière ${s.light})`);
    ctx.expect(s.spottedBy.length > 0, `devant eux en pleine lumière : repéré aussitôt (${s.spottedBy.join(", ") || "personne"})`);

    // 5. Leaving the mode clears the spottings.
    await st("set", { on: false });
    s = await st("state");
    ctx.expect(!s.hidden && !s.spottedBy.length, "hors du mode furtif : plus caché, plus repéré");
  }
};
