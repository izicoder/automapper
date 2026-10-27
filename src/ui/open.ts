import { spawn } from "node:child_process";

/**
 * Opens a folder in the OS file manager. Never pass a URL here: Windows
 * Explorer falls back to the Documents folder when it cannot parse an
 * argument, which looks like a bug in this program.
 */
export function openFolder(target: string): void {
  const [command, args] =
    process.platform === "win32"
      ? ["explorer.exe", [target]]
      : process.platform === "darwin"
        ? ["open", [target]]
        : ["xdg-open", [target]];

  spawnDetached(command, args);
}

/** Opens a URL in the default browser. */
export function openUrl(url: string): void {
  const [command, args] =
    process.platform === "win32"
      ? // `start` needs an empty title before the URL, or it treats it as one.
        ["cmd.exe", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];

  spawnDetached(command, args);
}

function spawnDetached(command: string, args: string[]): void {
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    // A missing opener must never crash a running conversion.
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // Ignored on purpose.
  }
}
