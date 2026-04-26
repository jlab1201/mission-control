import os from 'os';
import path from 'path';

/**
 * Expands a leading `~` or `~/` to the current user's home directory.
 * Node's `path.resolve` does NOT do this — and `EnvironmentFile=` in systemd
 * does not perform shell expansion either, so env vars like
 * `MC_CONFIG_PATH=~/.mission-control/config.json` arrive at the process with
 * a literal `~` and must be expanded explicitly before fs use.
 */
export function expandTilde(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * Resolves `p` to an absolute path and asserts it is inside the current user's
 * home directory.  Throws if the resolved path escapes home (e.g. path-traversal
 * sequences like `../../etc`, absolute paths like `/etc/passwd`, or home-tilde
 * expansions that land outside).
 *
 * Returns the resolved (canonical) path so callers can use it directly and
 * avoid a TOCTOU gap between the check and the first fs operation.
 */
export function assertPathInHome(p: string): string {
  const resolved = path.resolve(expandTilde(p));
  const home = os.homedir();
  // Allow the home dir itself or anything strictly inside it
  if (resolved !== home && !resolved.startsWith(home + path.sep)) {
    throw Object.assign(
      new Error(`Path is outside the home directory: ${resolved}`),
      { code: 'PATH_UNSAFE' },
    );
  }
  return resolved;
}
