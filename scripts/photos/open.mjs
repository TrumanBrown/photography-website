/**
 * Open a page the local helper commands just wrote, in your default browser.
 * Only `npm run photos` and `npm run social` use this, on your own machine.
 */
import { spawn } from "node:child_process";

/** The command that opens `path` in a browser here, as [program, args]. */
export function openCommand(
  path,
  env = process.env,
  platform = process.platform,
) {
  // WSL: hand the file to Windows, which picks the default browser.
  if (env.WSL_DISTRO_NAME)
    return [
      "explorer.exe",
      [`\\\\wsl$\\${env.WSL_DISTRO_NAME}${path.replaceAll("/", "\\")}`],
    ];
  if (platform === "darwin") return ["open", [path]];
  if (platform === "win32") return ["cmd", ["/c", "start", "", path]];
  return ["xdg-open", [path]];
}

/** Opens the page when run from a terminal; always prints how to open it by hand. */
export function showPage(path, { open = true } = {}) {
  const [program, args] = openCommand(path);
  console.log(`Wrote ${path}`);
  if (open && process.stdout.isTTY) {
    try {
      const child = spawn(program, args, { detached: true, stdio: "ignore" });
      child.on("error", () => {});
      child.unref();
      console.log("Opening it in your browser...");
      return;
    } catch {
      // Fall through to the instructions.
    }
  }
  console.log(`Open it with: ${program} "${args.at(-1)}"`);
}
