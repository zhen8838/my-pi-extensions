# my-pi-extensions

Personal extensions for [pi](https://github.com/earendil-works/pi).

## Stop Current Work

`stop.ts` adds `/stop`, an explicit equivalent of pressing Escape. It aborts
the active model response or tool execution. With `ssh.ts`, an active SSH tool
receives the same abort signal and stops its current SSH channel while leaving
the reusable OpenSSH ControlMaster running.

Install it in pi's user extension directory and run `/reload`:

```bash
cp stop.ts ~/.pi/agent/extensions/stop.ts
```

## SSH Remote Execution

`ssh.ts` keeps pi and its subagents local while routing project tools to a remote SSH host.

Features:

- Routes `read`, `write`, `edit`, `bash`, `grep`, `find`, and `ls` to the remote host.
- Shares the resolved SSH target and environment with nicobailon's `pi-subagents` native foreground sessions and detached background runners.
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

For `pi-subagents`, load this extension explicitly in native child sessions. The
following user setting covers the bundled native agents while leaving external
CLI profiles unchanged:

```json
{
  "subagents": {
    "agentOverrides": {
      "delegate": { "subagentOnlyExtensions": ["~/.pi/agent/extensions/ssh.ts"] },
      "oracle": { "subagentOnlyExtensions": ["~/.pi/agent/extensions/ssh.ts"] },
      "researcher": { "subagentOnlyExtensions": ["~/.pi/agent/extensions/ssh.ts"] },
      "reviewer": { "subagentOnlyExtensions": ["~/.pi/agent/extensions/ssh.ts"] },
      "scout": { "subagentOnlyExtensions": ["~/.pi/agent/extensions/ssh.ts"] },
      "worker": { "subagentOnlyExtensions": ["~/.pi/agent/extensions/ssh.ts"] }
    }
  }
}
```

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

`remoteInit` is not rerun for every tool call. The parent session runs it once, captures variables such as `PATH`, `VIRTUAL_ENV`, `CONDA_PREFIX`, `PYTHONPATH`, and compiler/library paths, then shares that snapshot with foreground children through process-global state and with detached background runners through a validated environment payload. The payload excludes the init command text and forwarded values; child processes recover explicitly forwarded values from their inherited local environment. Shell aliases and functions are not captured; expose tools as real executables or wrapper scripts on `PATH`.

OpenSSH `ControlMaster` reuses the authenticated transport only. Each tool call still gets an independent remote shell, preventing concurrent subagents from sharing mutable cwd or shell state.

### Requirements

- Key-based SSH authentication without password prompts.
- A POSIX-compatible shell on the remote host.
- `rg` on the remote host for the `grep` and `find` tools.

### Security

File tools are restricted to the configured remote project root. The `bash` tool can execute arbitrary commands allowed by the remote SSH account. Only variables explicitly named with `--ssh-send-env` are forwarded from the local environment; avoid forwarding secrets unless required.
