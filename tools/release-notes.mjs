/**
 * Issue #257: prints the release note of a version as Markdown, for the body of its GitHub release.
 *
 *   node tools/release-notes.mjs [version] [--out file]
 *
 * `version` defaults to the one in module/module.json (a leading "v" is accepted, so the tag name works). Exits with code 1 when
 * that version has no note in module/scripts/content/releases.mjs or one of its English texts is missing.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { RELEASES } from "../module/scripts/content/releases.mjs";
import { findRelease, releaseMarkdown } from "./lib/release-markdown.mjs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
const out = outAt >= 0 ? args[outAt + 1] : null;
const positional = args.filter((a, i) => !a.startsWith("--") && (outAt < 0 || i !== outAt + 1));
const version = (positional[0] ?? JSON.parse(read("module/module.json")).version).replace(/^v/, "");

const note = findRelease(RELEASES, version);
if ( !note ) {
  console.error(`No release note for ${version} in module/scripts/content/releases.mjs.`);
  process.exit(1);
}

let markdown;
try {
  markdown = releaseMarkdown(note, JSON.parse(read("module/lang/en.json")));
} catch ( err ) {
  console.error(`Release note ${version}: ${err.message}`);
  process.exit(1);
}

if ( out ) writeFileSync(out, markdown);
else process.stdout.write(markdown);
