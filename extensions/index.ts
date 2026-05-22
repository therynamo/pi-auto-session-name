/**
 * Auto Session Name Extension
 *
 * Automatically generates a short working title for the session
 * based on a summary of the conversation. Triggers after the first
 * assistant response (after the first turn completes).
 */

import { complete, getModel } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ContentBlock = {
	type?: string;
	text?: string;
	name?: string;
	arguments?: Record<string, unknown>;
};

const extractTextFromContent = (content: unknown): string => {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	const parts: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const b = block as ContentBlock;
		if (b.type === "text" && typeof b.text === "string") {
			parts.push(b.text);
		}
		if (b.type === "toolCall" && typeof b.name === "string") {
			parts.push(`Tool call: ${b.name}(${JSON.stringify(b.arguments ?? {})})`);
		}
	}
	return parts.join("\n");
};

const buildSummaryPrompt = (conversation: string): string =>
	`You are naming a conversation session. Based on the conversation below, produce a single short title (max 60 characters, no quotes). Be specific — mention the main task, file, or topic. Use sentence case.

<conversation>
${conversation}
</conversation>`;

export default function (pi: ExtensionAPI) {
	let hasNamed = false;

	// Trigger after the first turn completes (agent has responded)
	pi.on("turn_end", async (_event, ctx) => {
		if (hasNamed) return;

		// Only auto-name on the first turn — let the user rename manually later
		const branch = ctx.sessionManager.getBranch();

		// Gather user + assistant messages (skip tool results)
		const messages = branch
			.filter((e) => e.type === "message" && e.message?.role === "user")
			.map((e) => {
				const text = extractTextFromContent(e.message.content);
				return `User: ${text}`;
			})
			.join("\n\n");

		if (!messages.trim()) return;

		// Use the same model the user selected for the session
		const model = ctx.model;
		if (!model) return;

		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok || !auth.apiKey) return;

		const prompt = buildSummaryPrompt(messages);

		const response = await complete(
			model,
			{ messages: [{ role: "user" as const, content: [{ type: "text" as const, text: prompt }] }] },
			{ apiKey: auth.apiKey, headers: auth.headers },
		);

		const title = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text.trim())
			.join("\n")
			.slice(0, 60)
			.replace(/["'"]/g, "");

		if (title) {
			pi.setSessionName(title);
			hasNamed = true;
		}
	});
}
