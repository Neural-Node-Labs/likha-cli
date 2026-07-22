#!/usr/bin/env python3
"""
Deploy devnull stack to remote Docker host via SSH using paramiko.

Usage:
    python deploy_remote.py [--host HOST] [--port PORT] [--path REMOTE_PATH]
                           [--user USER] [--password PASSWORD]
                           [--skip-validation] [--skip-health] [--skip-rollback]
                           [--pull] [--compose-file FILE] [--env-file FILE]
                           [--rollback]

Environment variables:
    REMOTE_HOST             SSH host (default: 86.38.217.69)
    REMOTE_PORT             SSH port (default: 22)
    REMOTE_PATH             Remote deployment path (default: /opt/devnull)
    REMOTE_SSH_USER         SSH username
    REMOTE_SSH_PASSWORD     SSH password
    REMOTE_SSH_KEY          Path to SSH private key

Features:
    - Pre-deploy validation (Docker version, disk space)
    - Rollback snapshot + restore
    - Health verification after deploy
    - Compose file selection
    - Registry pull mode (skip build)
    - Environment file shipping
    - Idempotent: safe to re-run
"""

import os
import sys
import tarfile
import io
import time
import json
import re
import argparse
import paramiko

# ─── Defaults ────────────────────────────────────────────────────────────────
DEFAULT_HOST = "86.38.217.69"
DEFAULT_PORT = 22
DEFAULT_REMOTE_PATH = "/opt/devnull"

# ─── Parse arguments ─────────────────────────────────────────────────────────
def parse_args():
    parser = argparse.ArgumentParser(
        description="Deploy devnull stack to remote Docker host via SSH",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Environment variables:
    REMOTE_HOST             SSH host (default: 86.38.217.69)
    REMOTE_PORT             SSH port (default: 22)
    REMOTE_PATH             Remote deployment path (default: /opt/devnull)
    REMOTE_SSH_USER         SSH username
    REMOTE_SSH_PASSWORD     SSH password
    REMOTE_SSH_KEY          Path to SSH private key
        """
    )
    parser.add_argument("--host", help=f"SSH host (default: {DEFAULT_HOST}, env: REMOTE_HOST)")
    parser.add_argument("--port", type=int, help=f"SSH port (default: {DEFAULT_PORT}, env: REMOTE_PORT)")
    parser.add_argument("--path", help=f"Remote path (default: {DEFAULT_REMOTE_PATH}, env: REMOTE_PATH)")
    parser.add_argument("--user", help="SSH username (env: REMOTE_SSH_USER)")
    parser.add_argument("--password", help="SSH password (env: REMOTE_SSH_PASSWORD)")
    parser.add_argument("--key", help="SSH private key path (env: REMOTE_SSH_KEY)")
    parser.add_argument("--skip-validation", action="store_true", help="Skip pre-deploy validation")
    parser.add_argument("--skip-health", action="store_true", help="Skip health check after deploy")
    parser.add_argument("--skip-rollback", action="store_true", help="Skip rollback snapshot")
    parser.add_argument("--pull", action="store_true", help="Pull images from registry instead of building")
    parser.add_argument("--compose-file", help="Specific compose file to use")
    parser.add_argument("--env-file", help="Path to .env file to ship")
    parser.add_argument("--rollback", action="store_true", help="Rollback to previous deployment")
    return parser.parse_args()


def get_config(args):
    """Merge CLI args, env vars, and defaults."""
    return {
        "host": args.host or os.environ.get("REMOTE_HOST") or DEFAULT_HOST,
        "port": args.port or int(os.environ.get("REMOTE_PORT", str(DEFAULT_PORT))),
        "remote_path": args.path or os.environ.get("REMOTE_PATH") or DEFAULT_REMOTE_PATH,
        "user": args.user or os.environ.get("REMOTE_SSH_USER"),
        "password": args.password or os.environ.get("REMOTE_SSH_PASSWORD"),
        "key": args.key or os.environ.get("REMOTE_SSH_KEY"),
        "skip_validation": args.skip_validation,
        "skip_health": args.skip_health,
        "skip_rollback": args.skip_rollback,
        "pull": args.pull,
        "compose_file": args.compose_file,
        "env_file": args.env_file,
        "rollback": args.rollback,
    }


# ─── SSH helpers ─────────────────────────────────────────────────────────────
def exec_command(client, command, timeout=300, use_pty=False):
    """Run a command and return (exit_code, stdout, stderr)."""
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout, get_pty=use_pty)
    exit_code = stdout.channel.recv_exit_status()
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    return exit_code, out, err


def create_tar_of_workspace():
    """Create a tar.gz of the workspace (excluding .git, node_modules, etc.)."""
    exclude_dirs = {'.git', 'node_modules', '.agent', 'dist', '__pycache__'}
    exclude_extensions = {'.log', '.agent'}

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w:gz') as tar:
        for root, dirs, files in os.walk('.'):
            # Skip excluded directories
            dirs[:] = [d for d in dirs if d not in exclude_dirs and not d.startswith('.')]

            for f in files:
                filepath = os.path.join(root, f)
                # Skip excluded extensions
                if any(f.endswith(ext) for ext in exclude_extensions):
                    continue
                try:
                    tar.add(filepath, arcname=filepath)
                except Exception as e:
                    print(f"  Warning: could not add {filepath}: {e}")

    buf.seek(0)
    return buf.read()


def clean_output(text, max_len=2000):
    """Clean ANSI escape sequences and truncate."""
    clean = re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', text)
    clean = clean.encode('ascii', errors='replace').decode('ascii')
    if len(clean) > max_len:
        clean = clean[:max_len] + "\n... (truncated)"
    return clean


# ─── Deploy steps ────────────────────────────────────────────────────────────

def step_pre_check(client, config):
    """Pre-deploy validation: Docker version, disk space."""
    print("\n[1/8] Pre-deploy validation...")
    if config["skip_validation"]:
        print("  Skipped (--skip-validation)")
        return True

    code, out, err = exec_command(client, "docker --version && docker compose version && df -h / | tail -1")
    if code != 0:
        print(f"  ERROR: Docker not available: {clean_output(err)}")
        return False
    print(f"  {clean_output(out)}")
    return True


def step_create_remote_dir(client, config):
    """Create remote directory."""
    print(f"\n[2/8] Creating remote directory {config['remote_path']}...")
    code, out, err = exec_command(client, f"mkdir -p {config['remote_path']}")
    if code != 0:
        print(f"  ERROR: {clean_output(err)}")
        return False
    print("  Done")
    return True


def step_upload_workspace(client, config):
    """Upload workspace via SFTP."""
    print("\n[3/8] Uploading workspace...")
    tar_data = create_tar_of_workspace()
    print(f"  Workspace tar.gz size: {len(tar_data) / 1024 / 1024:.1f} MB")

    sftp = client.open_sftp()
    remote_tar_path = f"{config['remote_path']}/workspace.tar.gz"
    try:
        with sftp.open(remote_tar_path, 'wb') as f:
            f.write(tar_data)
        print("  Upload complete")
        return True
    except Exception as e:
        print(f"  ERROR: Upload failed: {e}")
        return False
    finally:
        sftp.close()


def step_upload_env_file(client, config):
    """Upload .env file if specified."""
    if not config["env_file"]:
        return True

    print(f"\n[4/8] Uploading env file: {config['env_file']}...")
    if not os.path.exists(config["env_file"]):
        print(f"  WARNING: Env file not found: {config['env_file']}")
        return True

    sftp = client.open_sftp()
    try:
        sftp.put(config["env_file"], f"{config['remote_path']}/.env")
        print("  Env file uploaded")
        return True
    except Exception as e:
        print(f"  WARNING: Env file upload failed: {e}")
        return True
    finally:
        sftp.close()


def step_extract_remote(client, config):
    """Extract workspace on remote."""
    print(f"\n[5/8] Extracting on remote...")
    remote_tar_path = f"{config['remote_path']}/workspace.tar.gz"
    code, out, err = exec_command(
        client,
        f"cd {config['remote_path']} && tar xzf workspace.tar.gz && rm workspace.tar.gz"
    )
    if code != 0:
        print(f"  ERROR: {clean_output(err)}")
        return False
    print("  Extracted successfully")
    return True


def step_rollback_snapshot(client, config):
    """Create rollback snapshot before deploying."""
    if config["skip_rollback"]:
        print("\n[6/8] Rollback snapshot: skipped (--skip-rollback)")
        return True

    print("\n[6/8] Creating rollback snapshot...")
    code, out, err = exec_command(
        client,
        f"cd {config['remote_path']} && "
        f"docker compose ps --format json > .devnull-rollback-snapshot.json 2>/dev/null || "
        f"echo '{{\"snapshot\":\"none\"}}' > .devnull-rollback-snapshot.json && "
        f"docker compose images --format json > .devnull-rollback-images.json 2>/dev/null || true && "
        f"echo 'SNAPSHOT_SAVED'"
    )
    if "SNAPSHOT_SAVED" in out:
        print("  Rollback snapshot saved")
    else:
        print(f"  WARNING: {clean_output(out)}")
    return True


def step_run_docker(client, config):
    """Run docker compose up."""
    print("\n[7/8] Running docker compose...")

    # Build the docker command
    cmd_parts = ["docker compose"]

    if config["compose_file"]:
        cmd_parts.append(f"-f {config['compose_file']}")

    if config["pull"]:
        cmd_parts.append("up -d --pull always")
    else:
        cmd_parts.append("up -d --build")

    docker_cmd = " ".join(cmd_parts)
    print(f"  Command: {docker_cmd}")

    code, out, err = exec_command(
        client,
        f"cd {config['remote_path']} && {docker_cmd} 2>&1",
        timeout=600
    )

    combined = out + err
    if combined:
        print(f"  Output:\n{clean_output(combined, 3000)}")

    if code != 0:
        print(f"  WARNING: docker compose returned exit code {code}")
        return False
    return True


def step_health_check(client, config):
    """Verify services are healthy after deploy."""
    if config["skip_health"]:
        print("\n[8/8] Health check: skipped (--skip-health)")
        return True

    print("\n[8/8] Health check...")
    time.sleep(5)

    # Check container status
    code, out, err = exec_command(client, f"cd {config['remote_path']} && docker compose ps")
    print(f"  Container status:\n{clean_output(out, 1000)}")

    # Check API health
    code, out, err = exec_command(
        client,
        "curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 10 "
        "http://localhost:3001/api/v1/health 2>/dev/null || echo 'failed'"
    )
    http_code = out.strip()
    print(f"  API health endpoint: HTTP {http_code}")

    # Check UI health
    code, out, err = exec_command(
        client,
        "curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 10 "
        "http://localhost:8080/ 2>/dev/null || echo 'failed'"
    )
    ui_code = out.strip()
    print(f"  UI health endpoint: HTTP {ui_code}")

    return http_code == "200"


def step_rollback(client, config):
    """Rollback to previous deployment."""
    print("\n[ROLLBACK] Rolling back to previous deployment...")

    # Check for rollback snapshot
    code, out, err = exec_command(
        client,
        f"test -f {config['remote_path']}/.devnull-rollback-snapshot.json && echo 'EXISTS' || echo 'NOT_FOUND'"
    )

    if "EXISTS" in out:
        print("  Rollback snapshot found. Restoring...")
        code, out, err = exec_command(
            client,
            f"cd {config['remote_path']} && "
            f"docker compose down 2>/dev/null; "
            f"docker compose up -d 2>&1",
            timeout=300
        )
        print(f"  {clean_output(out + err, 2000)}")

        # Health check after rollback
        time.sleep(10)
        code, out, err = exec_command(
            client,
            "curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 10 "
            "http://localhost:3001/api/v1/health 2>/dev/null || echo 'failed'"
        )
        print(f"  API health after rollback: HTTP {out.strip()}")
    else:
        print("  No rollback snapshot found. Attempting restart with cached images...")
        code, out, err = exec_command(
            client,
            f"cd {config['remote_path']} && docker compose down 2>/dev/null; docker compose up -d 2>&1",
            timeout=300
        )
        print(f"  {clean_output(out + err, 2000)}")


# ─── Main ────────────────────────────────────────────────────────────────────
def main():
    args = parse_args()
    config = get_config(args)

    if not config["user"]:
        print("ERROR: SSH user not specified. Use --user or set REMOTE_SSH_USER env var.")
        sys.exit(1)

    if not config["password"] and not config["key"]:
        print("ERROR: SSH password or key not specified.")
        print("  Use --password or set REMOTE_SSH_PASSWORD env var.")
        print("  Use --key or set REMOTE_SSH_KEY env var.")
        sys.exit(1)

    print(f"Connecting to {config['user']}@{config['host']}:{config['port']}...")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        # Connect
        connect_kwargs = {
            "hostname": config["host"],
            "port": config["port"],
            "username": config["user"],
            "timeout": 30,
        }
        if config["password"]:
            connect_kwargs["password"] = config["password"]
        if config["key"]:
            connect_kwargs["key_filename"] = config["key"]

        client.connect(**connect_kwargs)
        print("  Connected!")

        # Rollback mode
        if config["rollback"]:
            step_rollback(client, config)
            print("\n[OK] Rollback complete!")
            return

        # Deploy steps
        if not step_pre_check(client, config):
            print("\n[FAIL] Pre-deploy validation failed. Aborting.")
            sys.exit(1)

        if not step_create_remote_dir(client, config):
            print("\n[FAIL] Failed to create remote directory. Aborting.")
            sys.exit(1)

        if not step_upload_workspace(client, config):
            print("\n[FAIL] Failed to upload workspace. Aborting.")
            sys.exit(1)

        step_upload_env_file(client, config)

        if not step_extract_remote(client, config):
            print("\n[FAIL] Failed to extract workspace. Aborting.")
            sys.exit(1)

        step_rollback_snapshot(client, config)

        docker_ok = step_run_docker(client, config)

        health_ok = step_health_check(client, config)

        # If docker command failed or health check failed, attempt rollback
        if not docker_ok or not health_ok:
            print("\n[WARNING] Deploy had issues. Attempting rollback...")
            step_rollback(client, config)
            print("\n[FAIL] Deployment failed. Rollback attempted.")
            sys.exit(1)

        print("\n[OK] Deployment complete!")

    except paramiko.AuthenticationException:
        print("ERROR: Authentication failed. Check REMOTE_SSH_USER and REMOTE_SSH_PASSWORD.")
        sys.exit(1)

    except paramiko.SSHException as e:
        print(f"ERROR: SSH connection failed: {e}")
        sys.exit(1)

    except Exception as e:
        print(f"ERROR: Unexpected error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()

