# cf_ai_language_professor

An AI-powered Spanish language teacher built entirely on the Cloudflare Developer Platform. This project was created as an assignment for the Cloudflare Summer Internship application.

## Live Demo

- **Frontend:** `https://language-professor-ui.pages.dev/`
- **Worker API:** `https://language-professor.babaremb.workers.dev`

## Architecture & Components 

This project fulfills all the requirements of the AI-powered application assignment using the Cloudflare stack:

1. **LLM (Workers AI + Llama 3.3):** The core intelligence is powered by `@cf/meta/llama-3.3-70b-instruct-fp8-fast` running on Cloudflare Workers AI. It responds natively in Spanish, acting as a conversational teacher.
2. **Workflow / Coordination (Cloudflare Workflows):** When the user signals the end of a lesson (by typing `/recap` or clicking the "Terminer la leçon" button), an asynchronous Cloudflare Workflow (`FLASHCARD_WORKFLOW`) is triggered in the background. It analyzes the conversation history using the LLM to extract key vocabulary and generate JSON study flashcards.
3. **User Input / Frontend (Cloudflare Pages):** A lightweight HTML/Tailwind CSS frontend hosted provides a chat interface to interact with the Durable Object backend via HTTP POST.
4. **Memory & State (Durable Objects + Agents SDK):** The conversation history is maintained continuously over the session using Durable Objects via the new `@cloudflare/agents` SDK, serving as the Stateful Memory for the AI.

## Repository Structure

- [`/language-professor/`](language-professor): The Cloudflare Worker project containing the backend logic (Durable Objects, Workflows, Workers AI).
- [`index.html`](index.html): The lightweight frontend application.
- [`PROMPTS.md`](PROMPTS.md): A log of the AI prompts used to assist in building this application.

## How to Run Locally

### Prerequisites
- Node.js & npm installed
- Cloudflare Wrangler CLI globally installed (`npm i -g wrangler`)

### Running the Backend (Worker)
1. Navigate to the backend directory:
   ```bash
   cd language-professor
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the local development server:
   ```bash
   npm run dev
   ```
   *The backend will run on `http://127.0.0.1:8787`.*

### Running the Frontend (Local)
You can test the frontend locally by serving the `index.html` file using any simple HTTP server. For example:
```bash
npx serve .
```
*(Make sure to update the `WORKER_URL` inside `index.html` to point to `http://127.0.0.1:8787` if you want it to talk to your local worker).*

## Deployment

**Deploying the Backend (Cloudflare Workers):**
```bash
cd language-professor
npm run deploy
```

**Deploying the Frontend (Cloudflare Pages):**
```bash
# In the root 'ai_workers_cloudflare' directory
npx wrangler pages deploy . --project-name language-professor-ui
```
