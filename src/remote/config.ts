import { parseTargets } from "./sshConnection.js";
import { RemoteConfig } from "./types.js";

/**
 * Loads the preconfigured remote deployment fleet from environment variables:
 *   XCODER_SSH_TARGETS  - comma-separated "host" or "host:port" list, e.g. "10.0.0.5,10.0.0.6:2222"
 *   XCODER_SSH_USER     - shared SSH username for all targets
 *   XCODER_SSH_PASSWORD - shared SSH password for all targets
 *
 * Returns null if XCODER_SSH_TARGETS is unset, so ssh_copy_tool/ssh_run_command can report a
 * clear "not configured" error instead of the agent hitting a confusing crash.
 */
export function loadRemoteConfig(): RemoteConfig | null {
  const targetsRaw = process.env.XCODER_SSH_TARGETS;
  if (!targetsRaw) return null;

  const targets = parseTargets(targetsRaw);
  if (targets.length === 0) return null;

  const user = process.env.XCODER_SSH_USER ?? "";
  const password = process.env.XCODER_SSH_PASSWORD ?? "";

  return { targets, auth: { user, password } };
}

