/**
 * SSH Remote Execution for pi
 *
 * Routes read, write, edit, bash, grep, find, and ls to an SSH host. The
 * resolved target and one-time environment snapshot are shared with in-process
 * subagents, whose extension runtimes do not inherit the parent's CLI flags.
 *
 * Usage:
 *   pi --ssh user@host
 *   pi --ssh user@host:/remote/path
 *   pi --ssh user@host:/remote/path --ssh-init 'source .venv/bin/activate'
 *
 * Optional flags:
 *   --ssh-init <command>       Initialize the remote environment once per parent session
 *   --ssh-shell <path>         Shell used for environment initialization
 *   --ssh-send-env <names>     Comma-separated local environment variable allowlist
 *
 * Requirements:
 *   - SSH key-based auth (no password prompts)
 *   - A POSIX-compatible shell on the remote host
 *   - ripgrep (rg) on the remote host for grep/find
 */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	type BashOperations,
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
	type EditOperations,
	type FindToolInput,
	type GrepToolInput,
	type LsToolInput,
	type ReadOperations,
	type WriteOperations,
} from "@earendil-works/pi-coding-agent";

const MAX_CAPTURE_BYTES = 50 * 1024;
const SHARED_SSH_STATE = Symbol.for("pi.ssh-remote.shared-state");
const REMOTE_ENV_ALLOWLIST = new Set([
	"PATH",
	"SHELL",
	"LANG",
	"LC_ALL",
	"VIRTUAL_ENV",
	"CONDA_PREFIX",
	"CONDA_DEFAULT_ENV",
	"PYTHONPATH",
	"LD_LIBRARY_PATH",
	"DYLD_LIBRARY_PATH",
	"LIBRARY_PATH",
	"CPATH",
	"C_INCLUDE_PATH",
	"CPLUS_INCLUDE_PATH",
	"PKG_CONFIG_PATH",
	"CMAKE_PREFIX_PATH",
	"CC",
	"CXX",
	"AR",
	"LD",
]);

interface SshConfig {
	raw: string;
	remote: string;
	remoteCwd: string;
	init?: string;
	shell?: string;
	forwardedEnv: Record<string, string>;
	remoteEnv: Record<string, string>;
}

interface SharedSshState {
	config?: SshConfig;
}

interface SshResult {
	stdout: Buffer;
	stderr: Buffer;
	exitCode: number | null;
}

function getSharedState(): SharedSshState {
	const store = globalThis as unknown as Record<symbol, SharedSshState | undefined>;
	return (store[SHARED_SSH_STATE] ??= {});
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function boundedText(buffer: Buffer): string {
	if (buffer.byteLength <= MAX_CAPTURE_BYTES) return buffer.toString();
	return `${buffer.subarray(0, MAX_CAPTURE_BYTES).toString()}\n[Truncated at ${MAX_CAPTURE_BYTES / 1024}KB]`;
}

function forwardedEnvironment(raw: string | undefined): Record<string, string> {
	const result: Record<string, string> = {};
	for (const name of raw?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? []) {
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
		const value = process.env[name];
		if (value !== undefined) result[name] = value;
	}
	return result;
}

function environmentExports(values: Record<string, string>): string[] {
	return Object.entries(values).map(([name, value]) => `export ${name}=${shellQuote(value)}`);
}

function buildRemoteCommand(config: SshConfig, command: string): string {
	const steps: string[] = [];
	steps.push(...environmentExports({ ...config.remoteEnv, ...config.forwardedEnv }));
	steps.push(`cd -- ${shellQuote(config.remoteCwd)}`);
	steps.push(command);

	const launcher = shellQuote(config.shell || config.remoteEnv.SHELL || "/bin/sh");
	return `exec ${launcher} -c ${shellQuote(steps.join(" && "))}`;
}

function buildEnvironmentProbe(config: SshConfig): string {
	const steps = [
		...environmentExports(config.forwardedEnv),
		`cd -- ${shellQuote(config.remoteCwd)}`,
		...(config.init ? [config.init] : []),
		"env -0",
	];
	const launcher = config.shell ? shellQuote(config.shell) : '"${SHELL:-/bin/sh}"';
	return `exec ${launcher} -lc ${shellQuote(steps.join(" && "))}`;
}

function sshMultiplexArgs(): string[] {
	try {
		const controlDir = path.join(homedir(), ".pi", "agent", "ssh-control");
		mkdirSync(controlDir, { recursive: true, mode: 0o700 });
		return [
			"-o",
			"ControlMaster=auto",
			"-o",
			"ControlPersist=600",
			"-o",
			`ControlPath=${controlDir}/%C`,
		];
	} catch {
		return [];
	}
}

function spawnSsh(
	remote: string,
	command: string,
	options: { signal?: AbortSignal; timeoutSeconds?: number; input?: Buffer; onData?: (data: Buffer) => void } = {},
): Promise<SshResult> {
	return new Promise((resolve, reject) => {
		const child = spawn("ssh", [...sshMultiplexArgs(), remote, command], {
			stdio: [options.input ? "pipe" : "ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		const chunks: Buffer[] = [];
		const errChunks: Buffer[] = [];
		let timedOut = false;
		let settled = false;
		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
			fn();
		};
		const onAbort = () => child.kill();
		const timer = options.timeoutSeconds
			? setTimeout(() => {
				timedOut = true;
				child.kill();
			}, options.timeoutSeconds * 1000)
			: undefined;

		options.signal?.addEventListener("abort", onAbort, { once: true });
		child.stdout.on("data", (data: Buffer) => {
			chunks.push(data);
			options.onData?.(data);
		});
		child.stderr.on("data", (data: Buffer) => {
			errChunks.push(data);
			options.onData?.(data);
		});
		child.on("error", (error) => finish(() => reject(error)));
		child.on("close", (code) => {
			finish(() => {
				if (options.signal?.aborted) reject(new Error("aborted"));
				else if (timedOut) reject(new Error(`timeout:${options.timeoutSeconds}`));
				else resolve({ stdout: Buffer.concat(chunks), stderr: Buffer.concat(errChunks), exitCode: code });
			});
		});
		if (options.input && child.stdin) child.stdin.end(options.input);
	});
}

async function sshExec(config: SshConfig, command: string, input?: Buffer): Promise<Buffer> {
	const result = await spawnSsh(config.remote, buildRemoteCommand(config, command), { input });
	if (result.exitCode !== 0) {
		throw new Error(`SSH failed (${result.exitCode}): ${boundedText(result.stderr).trim()}`);
	}
	return result.stdout;
}

function parseRemoteEnvironment(buffer: Buffer): Record<string, string> {
	const result: Record<string, string> = {};
	for (const entry of buffer.toString().split("\0")) {
		const separator = entry.indexOf("=");
		if (separator <= 0) continue;
		const name = entry.slice(0, separator);
		if (REMOTE_ENV_ALLOWLIST.has(name)) result[name] = entry.slice(separator + 1);
	}
	return result;
}

async function initializeRemoteEnvironment(config: SshConfig): Promise<SshConfig> {
	const result = await spawnSsh(config.remote, buildEnvironmentProbe(config), { timeoutSeconds: 20 });
	if (result.exitCode !== 0) {
		throw new Error(`SSH environment initialization failed (${result.exitCode}): ${boundedText(result.stderr).trim()}`);
	}
	return { ...config, remoteEnv: parseRemoteEnvironment(result.stdout) };
}

async function resolveSshConfig(raw: string, init?: string, shell?: string, envNames?: string): Promise<SshConfig> {
	const separator = raw.indexOf(":");
	const remote = separator >= 0 ? raw.slice(0, separator) : raw;
	let remoteCwd = separator >= 0 ? raw.slice(separator + 1) : "";
	if (!remote) throw new Error("--ssh requires a non-empty host");
	if (!remoteCwd) {
		const result = await spawnSsh(remote, "pwd");
		if (result.exitCode !== 0) throw new Error(`SSH failed (${result.exitCode}): ${boundedText(result.stderr).trim()}`);
		remoteCwd = result.stdout.toString().trim();
	}
	return initializeRemoteEnvironment({
		raw,
		remote,
		remoteCwd: path.posix.normalize(remoteCwd),
		init: init?.trim() || undefined,
		shell: shell?.trim() || undefined,
		forwardedEnv: forwardedEnvironment(envNames),
		remoteEnv: {},
	});
}

function isWithinLocalRoot(root: string, candidate: string): boolean {
	const relative = path.relative(path.resolve(root), path.resolve(candidate));
	return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function isWithinRemoteRoot(root: string, candidate: string): boolean {
	const relative = path.posix.relative(path.posix.normalize(root), path.posix.normalize(candidate));
	return relative === "" || (!relative.startsWith("../") && relative !== ".." && !path.posix.isAbsolute(relative));
}

function toRemotePath(input: string, config: SshConfig, localCwd: string): string {
	const normalizedInput = input.replaceAll("\\", "/");
	if (path.posix.isAbsolute(normalizedInput) && isWithinRemoteRoot(config.remoteCwd, normalizedInput)) {
		return path.posix.normalize(normalizedInput);
	}

	const localPath = path.isAbsolute(input) ? path.resolve(input) : path.resolve(localCwd, input);
	if (!isWithinLocalRoot(localCwd, localPath)) {
		throw new Error(`Path is outside the SSH workspace: ${input}`);
	}
	const relative = path.relative(path.resolve(localCwd), localPath).split(path.sep).join("/");
	return relative ? path.posix.join(config.remoteCwd, relative) : config.remoteCwd;
}

function createRemoteReadOps(config: SshConfig, localCwd: string): ReadOperations {
	return {
		readFile: (p) => sshExec(config, `cat -- ${shellQuote(toRemotePath(p, config, localCwd))}`),
		access: (p) => sshExec(config, `test -r ${shellQuote(toRemotePath(p, config, localCwd))}`).then(() => {}),
		detectImageMimeType: async (p) => {
			try {
				const r = await sshExec(config, `file --mime-type -b -- ${shellQuote(toRemotePath(p, config, localCwd))}`);
				const m = r.toString().trim();
				return ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(m) ? m : null;
			} catch {
				return null;
			}
		},
	};
}

function createRemoteWriteOps(config: SshConfig, localCwd: string): WriteOperations {
	return {
		writeFile: async (p, content) => {
			await sshExec(config, `cat > ${shellQuote(toRemotePath(p, config, localCwd))}`, Buffer.from(content));
		},
		mkdir: (dir) => sshExec(config, `mkdir -p -- ${shellQuote(toRemotePath(dir, config, localCwd))}`).then(() => {}),
	};
}

function createRemoteEditOps(config: SshConfig, localCwd: string): EditOperations {
	const r = createRemoteReadOps(config, localCwd);
	const w = createRemoteWriteOps(config, localCwd);
	return { readFile: r.readFile, access: r.access, writeFile: w.writeFile };
}

function createRemoteBashOps(config: SshConfig, localCwd: string): BashOperations {
	return {
		exec: (command, cwd, { onData, signal, timeout }) =>
			spawnSsh(
				config.remote,
				buildRemoteCommand({ ...config, remoteCwd: toRemotePath(cwd, config, localCwd) }, command),
				{ signal, timeoutSeconds: timeout, onData },
			).then((result) => ({ exitCode: result.exitCode })),
	};
}

async function runRemoteSearch(config: SshConfig, command: string, signal?: AbortSignal): Promise<SshResult> {
	return spawnSsh(config.remote, buildRemoteCommand(config, command), { signal, timeoutSeconds: 30 });
}

function shellJoin(args: string[]): string {
	return args.map(shellQuote).join(" ");
}

function remoteFailure(operation: string, result: SshResult): Error {
	const message = boundedText(result.stderr).trim() || `${operation} exited with code ${result.exitCode}`;
	return new Error(message);
}

async function executeRemoteGrep(
	config: SshConfig,
	localCwd: string,
	params: GrepToolInput,
	signal?: AbortSignal,
) {
	const searchPath = toRemotePath(params.path || ".", config, localCwd);
	const limit = Math.max(1, Math.floor(params.limit ?? 100));
	const args = ["rg", "--line-number", "--color=never", "--hidden", "--no-heading"];
	if (params.ignoreCase) args.push("--ignore-case");
	if (params.literal) args.push("--fixed-strings");
	if (params.context && params.context > 0) args.push("--context", String(Math.floor(params.context)));
	if (params.glob) args.push("--glob", params.glob);
	args.push("--", params.pattern, searchPath);

	const command = `command -v rg >/dev/null 2>&1 || { echo 'ripgrep (rg) is required on the remote host' >&2; exit 127; }; ${shellJoin(args)} | head -n ${limit}`;
	const result = await runRemoteSearch(config, command, signal);
	if (result.exitCode !== 0 && result.stdout.byteLength === 0) throw remoteFailure("remote grep", result);
	const text = boundedText(result.stdout).trim();
	if (!text) return { content: [{ type: "text" as const, text: "No matches found" }], details: undefined };
	const lineCount = text.split("\n").length;
	return {
		content: [{ type: "text" as const, text }],
		details: lineCount >= limit ? { matchLimitReached: limit } : undefined,
	};
}

async function executeRemoteFind(
	config: SshConfig,
	localCwd: string,
	params: FindToolInput,
	signal?: AbortSignal,
) {
	const searchPath = toRemotePath(params.path || ".", config, localCwd);
	const limit = Math.max(1, Math.floor(params.limit ?? 1000));
	const args = [
		"rg",
		"--files",
		"--hidden",
		"--glob",
		params.pattern,
		"--glob",
		"!**/.git/**",
		"--glob",
		"!**/node_modules/**",
		"--",
		searchPath,
	];
	const command = `command -v rg >/dev/null 2>&1 || { echo 'ripgrep (rg) is required on the remote host' >&2; exit 127; }; ${shellJoin(args)} | head -n ${limit}`;
	const result = await runRemoteSearch(config, command, signal);
	if (result.exitCode !== 0 && result.stdout.byteLength === 0) throw remoteFailure("remote find", result);
	const lines = boundedText(result.stdout)
		.split("\n")
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry) => {
			const normalized = path.posix.normalize(entry);
			return isWithinRemoteRoot(searchPath, normalized) ? path.posix.relative(searchPath, normalized) || "." : normalized;
		});
	if (lines.length === 0) {
		return { content: [{ type: "text" as const, text: "No files found matching pattern" }], details: undefined };
	}
	return {
		content: [{ type: "text" as const, text: lines.join("\n") }],
		details: lines.length >= limit ? { resultLimitReached: limit } : undefined,
	};
}

async function executeRemoteLs(
	config: SshConfig,
	localCwd: string,
	params: LsToolInput,
	signal?: AbortSignal,
) {
	const dirPath = toRemotePath(params.path || ".", config, localCwd);
	const limit = Math.max(1, Math.floor(params.limit ?? 500));
	const quotedPath = shellQuote(dirPath);
	const command = [
		`test -d ${quotedPath} || { echo 'Not a directory: ${dirPath.replaceAll("'", "")}' >&2; exit 2; }`,
		`{ for entry in ${quotedPath}/.[!.]* ${quotedPath}/..?* ${quotedPath}/*; do`,
		'[ -e "$entry" ] || [ -L "$entry" ] || continue',
		'name=${entry##*/}',
		'if [ -d "$entry" ]; then printf \'%s/\\n\' "$name"; else printf \'%s\\n\' "$name"; fi',
		"done; } | LC_ALL=C sort -f | head -n " + limit,
	].join("; ");
	const result = await runRemoteSearch(config, command, signal);
	if (result.exitCode !== 0) throw remoteFailure("remote ls", result);
	const text = boundedText(result.stdout).trim();
	if (!text) return { content: [{ type: "text" as const, text: "(empty directory)" }], details: undefined };
	const lineCount = text.split("\n").length;
	return {
		content: [{ type: "text" as const, text }],
		details: lineCount >= limit ? { entryLimitReached: limit } : undefined,
	};
}

export default function (pi: ExtensionAPI) {
	pi.registerFlag("ssh", { description: "SSH remote: user@host or user@host:/path", type: "string" });
	pi.registerFlag("ssh-init", {
		description: "Remote environment init command, evaluated once per parent session",
		type: "string",
	});
	pi.registerFlag("ssh-shell", { description: "Remote shell used for environment initialization", type: "string" });
	pi.registerFlag("ssh-send-env", {
		description: "Comma-separated local environment variable allowlist to forward",
		type: "string",
	});

	const templateCwd = process.cwd();
	const localRead = createReadTool(templateCwd);
	const localWrite = createWriteTool(templateCwd);
	const localEdit = createEditTool(templateCwd);
	const localBash = createBashTool(templateCwd);
	const localGrep = createGrepTool(templateCwd);
	const localFind = createFindTool(templateCwd);
	const localLs = createLsTool(templateCwd);

	let sessionLocalCwd = templateCwd;
	let resolvedSsh: SshConfig | null = null;

	const getSsh = () => resolvedSsh;

	pi.registerTool({
		...localRead,
		async execute(id, params, signal, onUpdate, ctx) {
			const ssh = getSsh();
			const cwd = ctx.cwd || sessionLocalCwd;
			if (ssh) {
				const tool = createReadTool(cwd, {
					operations: createRemoteReadOps(ssh, cwd),
				});
				return tool.execute(id, params, signal, onUpdate);
			}
			return createReadTool(cwd).execute(id, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		...localWrite,
		async execute(id, params, signal, onUpdate, ctx) {
			const ssh = getSsh();
			const cwd = ctx.cwd || sessionLocalCwd;
			if (ssh) {
				const tool = createWriteTool(cwd, {
					operations: createRemoteWriteOps(ssh, cwd),
				});
				return tool.execute(id, params, signal, onUpdate);
			}
			return createWriteTool(cwd).execute(id, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		...localEdit,
		async execute(id, params, signal, onUpdate, ctx) {
			const ssh = getSsh();
			const cwd = ctx.cwd || sessionLocalCwd;
			if (ssh) {
				const tool = createEditTool(cwd, {
					operations: createRemoteEditOps(ssh, cwd),
				});
				return tool.execute(id, params, signal, onUpdate);
			}
			return createEditTool(cwd).execute(id, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		...localBash,
		async execute(id, params, signal, onUpdate, ctx) {
			const ssh = getSsh();
			const cwd = ctx.cwd || sessionLocalCwd;
			if (ssh) {
				const tool = createBashTool(cwd, {
					operations: createRemoteBashOps(ssh, cwd),
				});
				return tool.execute(id, params, signal, onUpdate);
			}
			return createBashTool(cwd).execute(id, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		...localGrep,
		async execute(id, params, signal, onUpdate, ctx) {
			const ssh = getSsh();
			const cwd = ctx.cwd || sessionLocalCwd;
			if (ssh) return executeRemoteGrep(ssh, cwd, params, signal);
			return createGrepTool(cwd).execute(id, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		...localFind,
		async execute(id, params, signal, onUpdate, ctx) {
			const ssh = getSsh();
			const cwd = ctx.cwd || sessionLocalCwd;
			if (ssh) return executeRemoteFind(ssh, cwd, params, signal);
			return createFindTool(cwd).execute(id, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		...localLs,
		async execute(id, params, signal, onUpdate, ctx) {
			const ssh = getSsh();
			const cwd = ctx.cwd || sessionLocalCwd;
			if (ssh) return executeRemoteLs(ssh, cwd, params, signal);
			return createLsTool(cwd).execute(id, params, signal, onUpdate);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		sessionLocalCwd = ctx.cwd || templateCwd;
		const explicitArg = pi.getFlag("ssh") as string | undefined;
		if (explicitArg) {
			resolvedSsh = await resolveSshConfig(
				explicitArg,
				pi.getFlag("ssh-init") as string | undefined,
				pi.getFlag("ssh-shell") as string | undefined,
				pi.getFlag("ssh-send-env") as string | undefined,
			);
			getSharedState().config = resolvedSsh;
			ctx.ui.setStatus("ssh", ctx.ui.theme.fg("accent", `SSH: ${resolvedSsh.remote}:${resolvedSsh.remoteCwd}`));
			ctx.ui.notify(`SSH mode: ${resolvedSsh.remote}:${resolvedSsh.remoteCwd}`, "info");
			return;
		}

		// Subagents create their own extension runtime without the parent's CLI
		// flagValues. They run in-process, so inherit the resolved parent target
		// and its one-time environment snapshot through process-global state.
		resolvedSsh = getSharedState().config ?? null;
	});

	// Handle user ! commands via SSH
	pi.on("user_bash", (_event) => {
		const ssh = getSsh();
		if (!ssh) return; // No SSH, use local execution
		return { operations: createRemoteBashOps(ssh, sessionLocalCwd) };
	});

	// Replace local cwd with remote cwd in system prompt
	pi.on("before_agent_start", async (event) => {
		const ssh = getSsh();
		if (ssh) {
			let modified = event.systemPrompt.replace(
				`Current working directory: ${sessionLocalCwd}`,
				`Current working directory: ${ssh.remoteCwd} (via SSH: ${ssh.remote})`,
			);
			if (!modified.includes("<ssh_remote_environment>")) {
				const environmentNames = Object.keys({ ...ssh.remoteEnv, ...ssh.forwardedEnv }).sort().join(", ");
				modified += `\n\n<ssh_remote_environment>\nAll read, write, edit, bash, grep, find, and ls operations run on ${ssh.remote}.\nThe remote project root is ${ssh.remoteCwd}. Every bash command already starts there; do not prepend cd to that directory.\nUse command names from the captured remote PATH instead of local absolute executable paths.\nThe remote environment was initialized once for this session${ssh.init ? " using the configured ssh-init command" : " using the remote login shell"}.\nAvailable captured environment names: ${environmentNames || "none"}.\nDo not use the local mirror path ${sessionLocalCwd} while SSH mode is active.\n</ssh_remote_environment>`;
			}
			return { systemPrompt: modified };
		}
	});
}
