import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/**
 * Trust-on-first-use (TOFU) host key verification for ssh2 password-auth connections.
 *
 * Previously, both sshTool.ts and sshConnection.ts either passed `hostVerifier: () => true`
 * or omitted host verification entirely — meaning ssh2 accepted *any* host key for *any*
 * host, silently. That leaves password-auth SSH connections open to a man-in-the-middle: an
 * attacker sitting between xcoder and the target host could present their own key and neither
 * side would notice.
 *
 * This mirrors the behavior the key-based (shell-out `ssh`/`scp`) path already has via
 * `-o StrictHostKeyChecking=accept-new`: the first time we connect to a given host:port, we
 * record its key fingerprint; every subsequent connection must match, or we refuse to connect.
 * A changed fingerprint almost always means either the server was legitimately rebuilt/rekeyed
 * (in which case delete the stale entry) or something is intercepting the connection.
 */

const STORE_DIR = path.join(os.homedir(), ".xcoder");
const STORE_PATH = path.join(STORE_DIR, "known_hosts.json");

interface KnownHostsFile {
  [hostPort: string]: string; // sha256 hex fingerprint
}

function readStore(): KnownHostsFile {
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf-8");
    return JSON.parse(raw) as KnownHostsFile;
  } catch {
    return {};
  }
}

function writeStore(store: KnownHostsFile): void {
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
  } catch {
    // Best-effort persistence — if we can't write the store, verification still runs for this
    // connection using whatever was loaded, it just won't remember new hosts across runs.
  }
}

export type HostKeyVerifyResult = { accepted: boolean; reason: string };

/**
 * TOFU-verify a host's key fingerprint (already hashed by ssh2 as hex, since callers should
 * pass `hostHash: "sha256"` to their ssh2 Client.connect() call so this receives a hex digest
 * rather than the raw key). Records first-seen fingerprints; rejects mismatches.
 */
export function verifyHostKeyTofu(host: string, port: number, fingerprintHex: string): HostKeyVerifyResult {
  const key = `${host}:${port}`;
  const store = readStore();
  const known = store[key];

  if (!known) {
    store[key] = fingerprintHex;
    writeStore(store);
    return { accepted: true, reason: `First connection to ${key} — fingerprint recorded.` };
  }

  if (known === fingerprintHex) {
    return { accepted: true, reason: "Fingerprint matches known host." };
  }

  return {
    accepted: false,
    reason:
      `REFUSED: host key for ${key} does not match the previously recorded fingerprint. ` +
      `This could mean the server was rebuilt/rekeyed, OR that the connection is being intercepted. ` +
      `If you trust this change, remove the "${key}" entry from ${STORE_PATH} and reconnect.`,
  };
}
