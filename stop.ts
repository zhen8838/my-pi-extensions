import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Add `/stop` as an explicit, discoverable equivalent of pressing Escape. */
export default function registerStop(pi: ExtensionAPI): void {
	pi.registerCommand("stop", {
		description: "Stop the active model response or tool execution",
		handler: (_args, ctx) => {
			if (ctx.isIdle()) {
				ctx.ui.notify("No active response to stop", "info");
				return;
			}

			ctx.abort();
			ctx.ui.notify("Stop requested", "info");
		},
	});
}
