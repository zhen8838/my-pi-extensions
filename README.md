# my-pi-extensions

Personal extensions for [pi](https://github.com/earendil-works/pi).

## SSH Remote Execution

`ssh.ts` keeps pi and its in-process subagents local while routing project tools to a remote SSH host.

Features:

- Routes `read`, `write`, `edit`, `bash`, `grep`, `find`, and `ls` to the remote host.
- Shares the resolved SSH target and environment with `@gotgenes/pi-subagents` child sessions.
- Initializes the remote environment once, captures an allowlisted environment snapshot, and replays it in later commands.
- Reuses the SSH transport with OpenSSH `ControlMaster` while keeping each command in an isolated shell.
- Maps both local workspace paths and remote absolute paths to the configured remote project root.
- Streams file writes over stdin instead of embedding their contents in the command line.

### Install

Copy or symlink the extension into pi's user extension directory:

```bash
mkdir -p ~/.pi/agent/extensions
cp ssh.ts ~/.pi/agent/extensions/ssh.ts
```

Restart pi after installation.

### Usage

```bash
pi --ssh user@host:/remote/project
```

Without a path, the remote user's home directory is used:

```bash
pi --ssh user@host
```

Initialize a Python virtual environment once at session startup:

```bash
pi \
  --ssh user@host:/remote/project \
  --ssh-init 'source .venv/bin/activate'
```

Conda example:

```bash
pi \
  --ssh user@host:/remote/project \
  --ssh-init 'source ~/miniconda3/etc/profile.d/conda.sh && conda activate myenv'
```

Optional flags:

```text
--ssh-init <command>       Remote environment initialization command
--ssh-shell <path>         Shell used for environment initialization
--ssh-send-env <names>     Comma-separated local environment variable allowlist
```

`remoteInit` is not rerun for every tool call. The parent session runs it once, captures variables such as `PATH`, `VIRTUAL_ENV`, `CONDA_PREFIX`, `PYTHONPATH`, and compiler/library paths, then shares that snapshot with subagents. Shell aliases and functions are not captured; expose tools as real executables or wrapper scripts on `PATH`.

OpenSSH `ControlMaster` reuses the authenticated transport only. Each tool call still gets an independent remote shell, preventing concurrent subagents from sharing mutable cwd or shell state.

### Requirements

- Key-based SSH authentication without password prompts.
- A POSIX-compatible shell on the remote host.
- `rg` on the remote host for the `grep` and `find` tools.

### Security

File tools are restricted to the configured remote project root. The `bash` tool can execute arbitrary commands allowed by the remote SSH account. Only variables explicitly named with `--ssh-send-env` are forwarded from the local environment; avoid forwarding secrets unless required.
