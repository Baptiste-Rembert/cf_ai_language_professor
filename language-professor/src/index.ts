import { Agent, routeAgentRequest } from "@cloudflare/agents";
import { WorkflowEvent, WorkflowStep, WorkflowEntrypoint } from "cloudflare:workers";

/**
 * Welcome to Cloudflare Workers! This is your first Durable Objects application.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your Durable Object in action
 * - Run `npm run deploy` to publish your application
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/durable-objects
 */

/** A Durable Object's behavior is defined in an exported Javascript class */

export interface Env {
  AI: any;
  PROFESSOR_AGENT: DurableObjectNamespace;
  FLASHCARD_WORKFLOW: any; // Type should be Workflow
}

export class ProfessorAgent extends Agent<Env> {
  // Strict instructions for Llama 3.3
  private systemPrompt = `You are "El Profesor", a friendly and encouraging Spanish teacher.
  Your goal is to help the user practice Spanish through natural conversation.
  Absolute rule: DO NOT correct their mistakes directly in the chat, let the conversation flow naturally.
  Keep your answers short (1 or 2 sentences maximum). Ask questions to keep the conversation going.`;

  // Add the messages array to store chat history
  private messages: { role: string, content: string }[] = [];
  // Add a property to store the generated flashcards in the Durable Object memory
  private flashcards: any = null;

  // This method handles incoming messages over Websockets
  async onMessage(connection: any, message: string) {
    if (typeof message !== "string") return;
    
    // If the user asks for the review flashcards
    if (message.trim().toLowerCase() === "/recap") {
      // Start the asynchronous workflow that will run in the background
      await this.env.FLASHCARD_WORKFLOW.create({
        params: { conversation: this.messages }
      });
      connection.send("¡Muy bien! I have finished our lesson. The generation of your vocabulary flashcards is being handled by the Workflow! (Check your terminal logs).");
      return;
    }

    // Prepare the history for Llama 3.3
    const messagesForAI = [
      { role: "system", content: this.systemPrompt },
      ...this.messages, // <-- The complete history managed automatically by the Durable Object
      { role: "user", content: message }
    ];

    // Generate the response
    const aiResponse = await this.env.AI.run(
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      { messages: messagesForAI }
    );

    this.messages.push(
      { role: "user", content: message },
      { role: "assistant", content: aiResponse.response }
    );
    connection.send(aiResponse.response);
  }

  // Handle HTTP POST requests from the browser
  async onRequest(request: Request) {
    if (request.method === "GET") {
      // The frontend wants to see the flashcards
      return new Response(JSON.stringify(this.flashcards || []), {
        headers: { "Content-Type": "application/json" }
      });
    }

    if (request.method === "PUT") {
      // The Workflow is sending the generated flashcards back to the DO memory
      const data = await request.json();
      this.flashcards = data;
      return new Response("OK");
    }

    if (request.method === "POST") {
      const message = await request.text();
      
      // If the user asks for the review flashcards
      if (message.trim().toLowerCase() === "/recap") {
        // Start the asynchronous workflow that will run in the background
        await this.env.FLASHCARD_WORKFLOW.create({
          params: { conversation: this.messages }
        });
        return new Response("¡Muy bien! I have finished our lesson. The generation of your vocabulary flashcards is being handled by the Workflow! (Check your terminal logs).");
      }

      // Prepare the history for Llama 3.3
      const messagesForAI = [
        { role: "system", content: this.systemPrompt },
        ...this.messages, 
        { role: "user", content: message }
      ];

      // Generate the response
      const aiResponse = await this.env.AI.run(
        "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        { messages: messagesForAI }
      );

      // (Optional) save history back to state
      this.messages.push(
        { role: "user", content: message },
        { role: "assistant", content: aiResponse.response }
      );

      return new Response(aiResponse.response);
    }
    
    return new Response("Not found", { status: 404 });
  }
}

// ----------------------------------------------------
// 2) WORKFLOW : Flashcard Workflow
// ----------------------------------------------------
export class FlashcardWorkflow extends WorkflowEntrypoint<Env, { conversation: { role: string, content: string }[] }> {
  async run(event: WorkflowEvent<{ conversation: { role: string, content: string }[] }>, step: WorkflowStep) {
    const { conversation } = event.payload;

    // Step 1: Analyze the conversation with the AI
    const flashcards = await step.do("generate-flashcards", async () => {
      // Convert the history to text
      const historyStr = conversation.map(msg => `${msg.role}: ${msg.content}`).join("\n");

      const prompt = `You are a helpful language teacher assistant. Look at the Spanish conversation below.
      Extract 3 to 5 key vocabulary words or phrases used by the user or the teacher.
      Format your response strictly as a JSON array of objects with properties "spanish" and "english", e.g. [{"spanish": "hola", "english": "hello"}]. Do not output any markdown or explanation, just the raw JSON array.
      
      Conversation:
      ${historyStr}`;

      const aiResponse = await this.env.AI.run(
        "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        { messages: [{ role: "user", content: prompt }] }
      );

      try {
        let textOrObj = aiResponse.response;
        
        // If the AI SDK already parsed it into an array/object, return it directly
        if (typeof textOrObj !== "string") {
          return textOrObj;
        }

        // Clean up the response from potential Markdown backticks and parse the JSON string
        let text = textOrObj.trim();
        if (text.startsWith("\`\`\`json")) text = text.substring(7);
        if (text.startsWith("\`\`\`")) text = text.substring(3);
        if (text.endsWith("\`\`\`")) text = text.substring(0, text.length - 3);
        return JSON.parse(text.trim());
      } catch (err: any) {
        return [{ error: "Failed to parse AI output", raw: aiResponse.response, msg: err.message }];
      }
    });

    // Step 2 (Optional): Send an email, or save to DB (D1, KV...)
    await step.do("save-or-notify", async () => {
      console.log("Flashcards generated:", JSON.stringify(flashcards, null, 2));

      // We will send the flashcards back to the Durable Object memory
      // so the Frontend can easily retrieve them without setting up KV/D1 databases!
      const id = this.env.PROFESSOR_AGENT.idFromName("default");
      const stub = this.env.PROFESSOR_AGENT.get(id);

      // Sending a PUT request back to the ProfessorAgent
      await stub.fetch("http://internal/agents/p-r-o-f-e-s-s-o-r_-a-g-e-n-t/default", {
        method: "PUT",
        body: JSON.stringify(flashcards),
        headers: { "Content-Type": "application/json" }
      });
    });

    return { success: true, flashcards };
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // A. Handle browser security (CORS preflight)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        }
      });
    }
	try {
    // B. Send the request to our Agent via the special SDK function
    // Note: Make sure "PROFESSOR_AGENT" matches the "name" in your wrangler.jsonc
    
    // Rewrite the URL to match the expected format for 'routeAgentRequest'
    // /agents/<binding-name>/<room-name>
    // Because PROFESSOR_AGENT becomes p-r-o-f-e-s-s-o-r_-a-g-e-n-t, let's use a simpler binding name internally by just sending to a specific agent using getAgentByName or routeAgentRequest.
    // However, routeAgentRequest looks at the env object.
    const url = new URL(request.url);
    url.pathname = "/agents/p-r-o-f-e-s-s-o-r_-a-g-e-n-t/default";
    const agentRequest = new Request(url.toString(), request);
    
    const response = await routeAgentRequest(agentRequest, env);
    if (!response) {
      return new Response("Agent Not Found", { status: 404 });
    }
    
    // C. Add CORS headers to the AI's response so your HTML can read it
    const corsResponse = new Response(response.body, response);
    corsResponse.headers.set("Access-Control-Allow-Origin", "*");
    
    return corsResponse;
	} catch (error : any) {
		return new Response("Worker internal error : " + error.message, {
        status: 500,
        headers: { "Access-Control-Allow-Origin": "*" }
      });
  	}
}
};
