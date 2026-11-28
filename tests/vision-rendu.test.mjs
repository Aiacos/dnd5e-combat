import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { DEVILS_SIGHT_OUTLINE, drawnUnderVeil, tintOutlineShader } from "../module/scripts/core/light.mjs";

/**
 * Issue #42, continued (0.281.1): from outside the Darkness, the warlock with Devil's Sight could target the creature inside,
 * but its token was not displayed. The mode, without a detection filter, was only drawn under the core's vision veil.
 */
describe("issue #42: the token seen by Devil's Sight is displayed above the veil", () => {
  it("the edging keeps the whole token (no knockout), without ripple, dark red", () => {
    expect(DEVILS_SIGHT_OUTLINE.knockout).toBe(false);
    expect(DEVILS_SIGHT_OUTLINE.wave).toBe(false);
    const [r, g, b, a] = DEVILS_SIGHT_OUTLINE.outlineColor;
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
    expect(a).toBe(1);
    expect(DEVILS_SIGHT_OUTLINE.thickness).toBeGreaterThan(0);
  });

  it("the edging is distinct from the hearing outline (the screen tester tells them apart by color)", () => {
    const source = readFileSync(new URL("../module/scripts/ui/perception.mjs", import.meta.url), "utf8");
    const hearing = source.match(/outlineColor: \[([^\]]+)\]/)[1].split(",").map(Number);
    expect(hearing).not.toEqual([...DEVILS_SIGHT_OUTLINE.outlineColor]);
  });

  it("the Devil's Sight mode declares a detection filter", () => {
    const source = readFileSync(new URL("../module/scripts/ui/perception.mjs", import.meta.url), "utf8");
    const mode = source.slice(source.indexOf("class DetectionModeDevilsSight"), source.indexOf("return new DetectionModeDevilsSight"));
    expect(mode).toContain("static getDetectionFilter()");
    expect(source).toContain("tintOutlineShader(");
  });

  it("tints the token red (a sharp token means \"normal sight\")", () => {
    const [r, g, b] = DEVILS_SIGHT_OUTLINE.tintColor;
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
    expect(DEVILS_SIGHT_OUTLINE.tintStrength).toBeGreaterThan(0);
    expect(DEVILS_SIGHT_OUTLINE.tintStrength).toBeLessThanOrEqual(1);
  });
});

describe("issue #42: the tint is added to the V14 core's outline shader", () => {
  // The two lines the tint expects, as they are in rendering/filters/outline-overlay.mjs (14.370).
  const core = `uniform bool wave;
    void main(void) {
      vec4 texColor = mix(baseColor, wColor, k) * texAlpha;
      float oAlpha = getOutlineAlpha() * (1.0 - texAlpha);
    }`;
  it("declares its uniforms and tints the token color, before the outline", () => {
    const out = tintOutlineShader(core);
    expect(out).toContain("uniform vec3 tintColor;");
    expect(out).toContain("uniform float tintStrength;");
    expect(out.indexOf("tintColor, tintStrength")).toBeGreaterThan(out.indexOf("vec4 texColor"));
    expect(out.indexOf("tintColor, tintStrength")).toBeLessThan(out.indexOf("float oAlpha"));
  });
  it("null if the core changed: the outline alone", () => {
    expect(tintOutlineShader("void main(void) { gl_FragColor = vec4(1.0); }")).toBeNull();
    expect(tintOutlineShader(undefined)).toBeNull();
  });
});

describe("issue #42: default \"drawn under the veil\"", () => {
  it("visible, without a filter, outside any view: the player does not see it", () => {
    expect(drawnUnderVeil({ visible: true, filtered: false, inSight: false })).toBe(true);
  });
  it("with a filter: redrawn above the veil", () => {
    expect(drawnUnderVeil({ visible: true, filtered: true, inSight: false })).toBe(false);
  });
  it("in the seen area, or the token that sees itself: displayed normally", () => {
    expect(drawnUnderVeil({ visible: true, filtered: false, inSight: true })).toBe(false);
    expect(drawnUnderVeil({ visible: true, filtered: false, ownVision: true, inSight: false })).toBe(false);
  });
  it("not visible: not a display default", () => {
    expect(drawnUnderVeil({ visible: false, filtered: false, inSight: false })).toBe(false);
  });
});
