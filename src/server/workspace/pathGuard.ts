import os from 'os';
import path from 'path';

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
  const resolved = path.resolve(p);
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
