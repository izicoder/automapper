import { main as runCli } from "./cli/index.js";
import { main as runUi } from "./ui/server.js";

/**
 * Entry point of the packaged executable (`scripts/build-sea.mjs`).
 *
 * Double-clicking the .exe starts the web UI, because that is what someone who
 * just unzipped a release wants. Anything else goes to the CLI:
 *
 *   automapper.exe                     start the UI
 *   automapper.exe ui --port 8080      start the UI with options
 *   automapper.exe convert             convert INPUT/ into OUTPUT/
 *   automapper.exe --help              command line help
 *   automapper.exe --keys 4,10,18      convert with extra difficulties
 */
const args = process.argv.slice(2);
const [first, ...rest] = args;
const wantsUi = args.length === 0 || first === "ui";
const cliArgs = first === "convert" ? rest : args;

if (wantsUi) {
  void runUi(first === "ui" ? rest : []).catch((error: unknown) => {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 1;
  });
} else {
  process.exitCode = runCli(cliArgs);
}
