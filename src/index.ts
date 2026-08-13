/**
 * Saratam Digiplex AI Chat
 *
 * Cloudflare Workers AI + AI Search (RAG)
 */

import { Env, ChatMessage } from "./types";

const MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";
const AI_SEARCH_INSTANCE = "saratam-knowledge";

const SYSTEM_PROMPT = `
You are the official AI assistant of Saratam Digiplex.

Your job is to help visitors understand Saratam Digiplex, its services,
digital marketing, website development, mobile app development, Flutter,
SEO, advertising, branding and other digital solutions.

IMPORTANT RULES:
- Use the knowledge provided from the Saratam Digiplex knowledge base.
- Do not invent company information.
- Do not invent prices, guarantees, clients, awards, statistics or policies.
- If the knowledge base does not contain the answer to a company-specific
  question, clearly say that you don't have that information.
- Be professional, friendly and helpful.
- Give simple explanations to non-technical visitors.
- Give technical explanations when the visitor asks technical questions.
- If someone wants to start a project, encourage them to contact Saratam Digiplex.
`;

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		// Serve website files
		if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
			return env.ASSETS.fetch(request);
		}

		// Chat API
		if (url.pathname === "/api/chat") {
			if (request.method === "POST") {
				return handleChatRequest(request, env);
			}

			return new Response("Method not allowed", { status: 405 });
		}

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;

async function handleChatRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	try {
		const { messages = [] } = (await request.json()) as {
			messages: ChatMessage[];
		};

		// Find the visitor's latest question
		const latestUserMessage = [...messages]
			.reverse()
			.find((message) => message.role === "user");

		if (!latestUserMessage) {
			return new Response(
				JSON.stringify({ error: "No user message provided" }),
				{
					status: 400,
					headers: { "content-type": "application/json" },
				},
			);
		}

		/*
		 * Search Saratam Digiplex knowledge base.
		 */
		const searchInstance =
			env.AI_SEARCH.get(AI_SEARCH_INSTANCE);

		const searchResults = await searchInstance.search({
			messages: [
				{
					role: "user",
					content: latestUserMessage.content,
				},
			],
		});

		/*
		 * Extract relevant knowledge.
		 */
		const knowledge = searchResults.chunks
			.map((result: { content?: string }) => result.content || "")
			.filter(Boolean)
			.join("\n\n---\n\n");

		/*
		 * Give the retrieved knowledge to Llama.
		 */
		const systemMessage = `${SYSTEM_PROMPT}

Saratam Digiplex knowledge retrieved for this question:

${knowledge || "No relevant knowledge was found."}

Use the retrieved knowledge above when answering the visitor.
`;

		const chatMessages: ChatMessage[] = messages.filter(
			(message) => message.role !== "system",
		);

		chatMessages.unshift({
			role: "system",
			content: systemMessage,
		});

		const inputs = {
			messages: chatMessages,
			max_tokens: 1024,
			stream: true,
		} satisfies AiTextGenerationInput & { stream: true };

		const stream = await env.AI.run<typeof MODEL_ID>(
			MODEL_ID,
			inputs,
		);

		return new Response(stream, {
			headers: {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache",
				connection: "keep-alive",
			},
		});
	} catch (error) {
		console.error("Error processing chat request:", error);

		return new Response(
			JSON.stringify({
				error: "Failed to process request",
			}),
			{
				status: 500,
				headers: {
					"content-type": "application/json",
				},
			},
		);
	}
}
