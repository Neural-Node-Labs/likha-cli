import { Client, SFTPWrapper } from "ssh2";
import fs from "node:fs";
import path from "node:path";
import { execCommand } from "./sshConnection.js";

function getSftp(conn: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)));
  });
}

function sftpFastPut(sftp: SFTPWrapper, local: string, remote: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.fastPut(local, remote, (err) => (err ? reject(err) : resolve()));
  });
}

function shellQuote(p: string): string {
  return `"${p.replace(/(["\\$`])/g, "\\$1")}"`;
}

export interface UploadStats {
  filesUploaded: number;
  dirsCreated: number;
}

/**
 * Uploads a local file or directory (recursively) to a remote path over SFTP.
 * Remote directories are created via a plain `mkdir -p` exec call first since
 * ssh2's SFTP mkdir doesn't support recursive creation on its own.
 */
export async function uploadPath(conn: Client, localPath: string, remotePath: string): Promise<UploadStats> {
  const sftp = await getSftp(conn);
  const stats: UploadStats = { filesUploaded: 0, dirsCreated: 0 };

  async function recurse(local: string, remote: string): Promise<void> {
    const stat = fs.statSync(local);
    if (stat.isDirectory()) {
      await execCommand(conn, `mkdir -p ${shellQuote(remote)}`);
      stats.dirsCreated++;
      for (const entry of fs.readdirSync(local)) {
        await recurse(path.join(local, entry), `${remote}/${entry}`);
      }
    } else {
      await sftpFastPut(sftp, local, remote);
      stats.filesUploaded++;
    }
  }

  await recurse(localPath, remotePath);
  sftp.end();
  return stats;
}

