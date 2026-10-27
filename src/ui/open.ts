import { spawn } from "node:child_process";

/** Opens a folder or URL in the OS default handler. Failures are silent. */
export function openPath(target: string): void {
  const [command, args] =
    process.platform === "win32"
      ? ["explorer.exe", [target]]
      : process.platform === "darwin"
        ? ["open", [target]]
        : ["xdg-open", [target]];

  try {
    spawn(command, args as string[], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // A missing opener must never crash a running conversion.
  }
}
