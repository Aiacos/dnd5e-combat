/**
 * §181, §541 (issue #275): the Factions window with many factions. The core caps every window at the viewport height and hides what
 * overflows; with sixteen factions the matrix and the "Names, colours and rules" table no longer fit, and the Save button must
 * still be reachable by scrolling the window. Restores the factions setting.
 */
const EXTRA = 16;

export default {
  name: "factions-fenetre — many factions: the window scrolls, Save stays reachable (#275)",

  async run(ctx) {
    const f = args => ctx.engine("factions", args);
    const snap = await f({ op: "snapshot" });
    ctx.restore(() => f({ op: "restore", value: snap.value }));
    for ( let i = 1; i <= EXTRA; i++ ) await f({ op: "add", name: `Faction test ${i}` });

    const w = await f({ op: "window" });
    ctx.log(`viewport ${w.viewport} px, window ${w.window.height} px, content ${w.clientHeight}/${w.scrollHeight} px, overflow-y ${w.overflowY}, scrolled to ${w.scrollTop}`);
    ctx.expect(w.rows >= EXTRA && w.editRows === w.rows, `${w.rows} matrix rows and ${w.editRows} edit rows`);
    ctx.expect(w.scrollHeight > w.clientHeight, "enough factions to overflow the window (otherwise the check proves nothing)");
    ctx.expect(w.window.bottom <= w.viewport, `the window fits the viewport (bottom ${w.window.bottom} ≤ ${w.viewport})`);
    ctx.expect(w.header.top >= 0, "the window header stays visible");
    ctx.expect(["auto", "scroll"].includes(w.overflowY), `the window content scrolls (overflow-y ${w.overflowY})`);
    ctx.expect(w.saveReachable, `Save is visible once scrolled down (button ${w.save.top}–${w.save.bottom}, content ${w.content.top}–${w.content.bottom})`);
  }
};
