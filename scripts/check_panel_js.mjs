/**
 * Syntax-check the panel's browser JavaScript without executing it.
 *
 * The Python lint and test workflows never look at these files, so a syntax
 * error in the panel passes every check and only fails in the browser, where
 * it leaves an empty sidebar panel. This parses:
 *
 *   - every .js file in custom_components/scrypted as an ES module
 *   - every inline <script> in its .html files, as a module or classic script
 *     according to its type attribute
 *
 * Usage: node scripts/check_panel_js.mjs
 */

import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// Resolve paths from the repository root so the script works from any cwd.
process.chdir(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

const PANEL_DIR = "custom_components/scrypted";

/** Return null when `source` parses as an ES module, else the error text. */
function moduleError(source) {
  // Without --input-type=module node parses stdin as CommonJS and rejects
  // import/export even in a valid module. The flag is only honoured for
  // source on stdin, not for a file path, hence spawning rather than
  // pointing node at the file.
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--check"],
    { input: source, encoding: "utf8" },
  );
  return result.status === 0 ? null : result.stderr.trim();
}

/** Return null when `source` parses as a classic script, else the error text. */
function scriptError(source, label) {
  try {
    // Compiling a vm.Script parses the code; nothing runs until it is invoked.
    new vm.Script(source, { filename: label });
    return null;
  } catch (error) {
    return String(error.stack ?? error).trim();
  }
}

const results = [];

for (const name of (await readdir(PANEL_DIR)).sort()) {
  const file = path.posix.join(PANEL_DIR, name);

  if (name.endsWith(".js")) {
    results.push([file, moduleError(await readFile(file, "utf8"))]);
  } else if (name.endsWith(".html")) {
    const html = await readFile(file, "utf8");
    const blocks = html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi);
    let index = 0;
    for (const [, attributes, body] of blocks) {
      index += 1;
      const label = `${file} <script> #${index}`;
      const isModule = /\btype\s*=\s*["']?module\b/i.test(attributes);
      results.push([
        label,
        isModule ? moduleError(body) : scriptError(body, label),
      ]);
    }
  }
}

const failures = results.filter(([, error]) => error);
for (const [label, error] of results) {
  if (error) {
    console.error(`FAIL ${label}\n${error}\n`);
  } else {
    console.log(`ok   ${label}`);
  }
}

if (results.length === 0) {
  console.error(`No panel JavaScript found under ${PANEL_DIR}.`);
  process.exit(1);
}
if (failures.length) {
  console.error(`${failures.length} of ${results.length} failed to parse.`);
  process.exit(1);
}
