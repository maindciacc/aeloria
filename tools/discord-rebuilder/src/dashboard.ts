import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, relative, resolve, sep } from "node:path";
import type { AddressInfo } from "node:net";
import { applyCodeProposal, createCodeProposal, listCodeProposals, validateCodeProposal } from "./change-workflow.js";
import { askWarden, type LocalConfig } from "./local-services.js";
import type { SetupSettings } from "./setup-settings.js";

export type DashboardConfig = {
  enabled: boolean;
  host: string;
  port: number;
  accessToken?: string;
  workspacePath: string;
  repositoryRoot?: string;
  users?: Array<{ id: string; token: string; operator: boolean }>;
  requireCloudflareIdentity?: boolean;
};
export type DashboardStatusProvider = () => Promise<Record<string, unknown>>;
export type DashboardControls = {
  smoke: (action: string, report?: (line: string) => void) => Promise<string[]>;
  lockdown: (action: string) => Promise<string[]>;
  setup: (action: string, update?: Partial<SetupSettings>) => Promise<string[]>;
  setupChat: (question: string, confirmation?: boolean, cancellation?: boolean) => Promise<string[]>;
  restart: () => Promise<string[]>;
};

type WorkspaceKind = "lore" | "territory" | "build-idea" | "task" | "note";
type Session = { userId: string; operator: boolean; expiresAt: number };

const SESSION_COOKIE = "aeloria_dashboard_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1_000;
const kinds: WorkspaceKind[] = ["lore", "territory", "build-idea", "task", "note"];
const folders: Record<WorkspaceKind, string> = {
  lore: "lore/drafts",
  territory: "world/territories",
  "build-idea": "build-ideas",
  task: "tasks",
  note: "notes",
};

export function dashboardConfig(repositoryRoot: string): DashboardConfig {
  const users = (process.env.DASHBOARD_ACCESS_USERS ?? "").split(",").map((entry) => {
    const [id, token] = entry.split(":", 2).map((value) => value.trim());
    return id && token ? { id, token, operator: (process.env.DASHBOARD_OPERATOR_USERS ?? "").split(",").map((value) => value.trim()).includes(id) } : undefined;
  }).filter((user): user is { id: string; token: string; operator: boolean } => Boolean(user));
  return {
    enabled: process.env.ENABLE_DASHBOARD === "true",
    host: process.env.DASHBOARD_HOST ?? "127.0.0.1",
    port: Number.parseInt(process.env.DASHBOARD_PORT ?? "3180", 10) || 3180,
    accessToken: process.env.DASHBOARD_ACCESS_TOKEN?.trim() || undefined,
    workspacePath: resolve(process.env.DASHBOARD_WORKSPACE_PATH ?? join(repositoryRoot, ".warden-workspace")),
    repositoryRoot,
    users,
    requireCloudflareIdentity: process.env.DASHBOARD_REQUIRE_CLOUDFLARE_IDENTITY === "true",
  };
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

function html(response: ServerResponse): void {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(DASHBOARD_HTML);
}

function slug(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "untitled";
}

function safePath(root: string, value: string): string | undefined {
  const candidate = resolve(root, value);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return candidate === root || candidate.startsWith(prefix) ? candidate : undefined;
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function files(root: string, folder = root): Promise<Array<{ path: string; kind: WorkspaceKind; title: string; updatedAt: string }>> {
  try { await mkdir(folder, { recursive: true }); } catch { return []; }
  const entries = await readdir(folder, { withFileTypes: true });
  const result: Array<{ path: string; kind: WorkspaceKind; title: string; updatedAt: string }> = [];
  for (const entry of entries) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) result.push(...await files(root, path));
    else if (extname(entry.name) === ".md") {
      const relativePath = relative(root, path).replaceAll("\\", "/");
      const kind = kinds.find((candidate) => relativePath.startsWith(`${folders[candidate]}/`));
      if (!kind) continue;
      const info = await stat(path);
      result.push({ path: relativePath, kind, title: entry.name.replace(/\.md$/i, ""), updatedAt: info.mtime.toISOString() });
    }
  }
  return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function ensureWorkspace(root: string): Promise<void> {
  await Promise.all(Object.values(folders).map((folder) => mkdir(join(root, folder), { recursive: true })));
  const readme = join(root, "README.md");
  try { await stat(readme); } catch { await writeFile(readme, "# Aeloria Warden Workspace\n\nLocal working notes. Approved canon remains in the repository.\n", "utf8"); }
}

function sessionCookie(value: string, maxAge = SESSION_TTL_MS / 1_000): string {
  return `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

function tokenHash(value: string): string { return createHash("sha256").update(value).digest("hex"); }

export function createDashboardServer(config: DashboardConfig, ownerIds: ReadonlySet<string>, local: LocalConfig, statusProvider?: DashboardStatusProvider, controls?: DashboardControls) {
  const sessions = new Map<string, Session>();
  const eventClients = new Set<ServerResponse>();
  const publish = (event: string, data: unknown): void => {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of eventClients) {
      try { client.write(message); } catch { eventClients.delete(client); }
    }
  };
  const server = createServer(async (request, response) => {
    try {
      if (request.url === "/healthz") return json(response, 200, { ok: true });
      if (request.url === "/") return html(response);
      const url = new URL(request.url ?? "/", `http://${config.host}:${config.port}`);
      if (url.pathname === "/api/login" && request.method === "POST") {
        const cloudflareEmail = request.headers["cf-access-authenticated-user-email"];
        const identity = typeof cloudflareEmail === "string" ? cloudflareEmail.trim().toLocaleLowerCase() : "";
        if (config.requireCloudflareIdentity && !identity) return json(response, 401, { error: "Cloudflare Access identity is required." });
        const input = await body(request);
        const inputToken = typeof input.token === "string" ? input.token : "";
        if (!inputToken) return json(response, 401, { error: "A dashboard token is required." });
        const user = config.users?.find((candidate) => (!identity || candidate.id.toLocaleLowerCase() === identity) && tokenHash(inputToken) === tokenHash(candidate.token));
        const legacy = !config.users?.length && config.accessToken && tokenHash(inputToken) === tokenHash(config.accessToken);
        if (!user && !legacy) return json(response, 401, { error: "Invalid dashboard identity or token." });
        const userId = user?.id ?? [...ownerIds][0];
        if (!userId) return json(response, 503, { error: "No configured Warden owner." });
        const sessionId = randomBytes(32).toString("hex");
        sessions.set(sessionId, { userId, operator: user?.operator ?? true, expiresAt: Date.now() + SESSION_TTL_MS });
        response.setHeader("set-cookie", sessionCookie(sessionId));
        return json(response, 200, { ok: true, userId, operator: user?.operator ?? true });
      }
      if (url.pathname === "/api/logout" && request.method === "POST") {
        const cookie = request.headers.cookie?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
        if (cookie) sessions.delete(cookie);
        response.setHeader("set-cookie", sessionCookie("", 0));
        return json(response, 200, { ok: true });
      }
      const cookie = request.headers.cookie?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
      const session = cookie ? sessions.get(cookie) : undefined;
      if (!session || session.expiresAt < Date.now()) return json(response, 401, { error: "Dashboard authentication required." });
      const operatorOnly = (): boolean => {
        if (session.operator) return false;
        json(response, 403, { error: "Operator approval is required for this action." });
        return true;
      };
      if (url.pathname === "/api/events" && request.method === "GET") {
        response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
        eventClients.add(response);
        response.write(`event: connected\ndata: ${JSON.stringify({ userId: session.userId })}\n\n`);
        request.on("close", () => eventClients.delete(response));
        return;
      }
      if (url.pathname === "/api/workspace" && request.method === "GET") return json(response, 200, { files: await files(config.workspacePath) });
      if (url.pathname === "/api/status" && request.method === "GET") return json(response, 200, statusProvider ? await statusProvider() : { connected: false, detail: "Guild status provider is unavailable." });
      if (url.pathname === "/api/smoke" && request.method === "POST") {
        if (operatorOnly()) return;
        if (!controls) return json(response, 503, { error: "Dashboard controls are unavailable." });
        const input = await body(request);
        const action = typeof input.action === "string" ? input.action : "preview";
        if (!["preview", "run", "cleanup"].includes(action)) return json(response, 400, { error: "Invalid smoke-test action." });
        return json(response, 200, { lines: await controls.smoke(action, (line) => publish("operation-progress", { operation: "smoke", line })) });
      }
      if (url.pathname === "/api/lockdown" && request.method === "POST") {
        if (operatorOnly()) return;
        if (!controls) return json(response, 503, { error: "Dashboard controls are unavailable." });
        const input = await body(request);
        const action = typeof input.action === "string" ? input.action : "status";
        if (!["status", "enable", "disable"].includes(action)) return json(response, 400, { error: "Invalid lockdown action." });
        return json(response, 200, { lines: await controls.lockdown(action) });
      }
      if (url.pathname === "/api/setup" && request.method === "POST") {
        if (operatorOnly()) return;
        if (!controls) return json(response, 503, { error: "Dashboard controls are unavailable." });
        const input = await body(request);
        const action = typeof input.action === "string" ? input.action : "status";
        if (!["status", "preview", "execute", "settings"].includes(action)) return json(response, 400, { error: "Invalid setup action." });
        return json(response, 200, { lines: await controls.setup(action, input.update as Partial<SetupSettings> | undefined) });
      }
      if (url.pathname === "/api/setup/chat" && request.method === "POST") {
        if (operatorOnly()) return;
        if (!controls) return json(response, 503, { error: "Dashboard controls are unavailable." });
        const input = await body(request);
        const question = typeof input.question === "string" ? input.question.trim() : "";
        if (!question || question.length > 4_000) return json(response, 400, { error: "A setup question up to 4,000 characters is required." });
        return json(response, 200, { lines: await controls.setupChat(question, input.confirm === true, input.cancel === true) });
      }
      if (url.pathname === "/api/restart" && request.method === "POST") {
        if (operatorOnly()) return;
        if (!controls) return json(response, 503, { error: "Dashboard controls are unavailable." });
        const input = await body(request);
        if (input.confirm !== true) return json(response, 400, { error: "Explicit restart confirmation is required." });
        return json(response, 200, { lines: await controls.restart() });
      }
      if (url.pathname === "/api/chat" && request.method === "POST") {
        const input = await body(request);
        const question = typeof input.question === "string" ? input.question.trim() : "";
        if (!question || question.length > 4_000) return json(response, 400, { error: "A question up to 4,000 characters is required." });
        return json(response, 200, { answer: await askWarden(local, question) });
      }
      if (url.pathname === "/api/code/proposals" && request.method === "GET") return json(response, 200, { proposals: await listCodeProposals(config.workspacePath) });
      if (url.pathname === "/api/code/proposals" && request.method === "POST") {
        if (!config.repositoryRoot) return json(response, 503, { error: "Repository code workflow is not configured." });
        const input = await body(request);
        const title = typeof input.title === "string" ? input.title : "";
        const patch = typeof input.patch === "string" ? input.patch : "";
        const proposal = await createCodeProposal(config.workspacePath, title, patch, session.userId);
        publish("code-proposal-created", { id: proposal.id, title: proposal.title, userId: session.userId });
        return json(response, 201, { proposal });
      }
      if (url.pathname === "/api/code/validate" && request.method === "POST") {
        if (!config.repositoryRoot) return json(response, 503, { error: "Repository code workflow is not configured." });
        const input = await body(request);
        if (typeof input.id !== "string") return json(response, 400, { error: "Proposal id is required." });
        return json(response, 200, await validateCodeProposal(config.repositoryRoot, config.workspacePath, input.id));
      }
      if (url.pathname === "/api/code/apply" && request.method === "POST") {
        if (operatorOnly()) return;
        if (!config.repositoryRoot) return json(response, 503, { error: "Repository code workflow is not configured." });
        const input = await body(request);
        if (input.confirm !== true || typeof input.id !== "string") return json(response, 400, { error: "Proposal id and explicit confirmation are required." });
        const result = await applyCodeProposal(config.repositoryRoot, config.workspacePath, input.id, session.userId);
        publish("code-proposal-applied", { id: input.id, ok: result.ok, userId: session.userId });
        return json(response, 200, result);
      }
      if (url.pathname === "/api/workspace/file" && request.method === "GET") {
        const path = url.searchParams.get("path");
        const target = path ? safePath(config.workspacePath, path) : undefined;
        if (!target || !target.endsWith(".md")) return json(response, 400, { error: "Invalid workspace path." });
        return json(response, 200, { path, content: await readFile(target, "utf8") });
      }
      if (url.pathname === "/api/workspace/file" && request.method === "PUT") {
        const input = await body(request);
        const path = typeof input.path === "string" ? input.path : "";
        const content = typeof input.content === "string" ? input.content : "";
        const target = safePath(config.workspacePath, path);
        if (!target || !target.endsWith(".md") || content.length > 100_000) return json(response, 400, { error: "Invalid workspace file or content length." });
        await mkdir(resolve(target, ".."), { recursive: true });
        await writeFile(target, content, "utf8");
        publish("workspace-updated", { path, userId: session.userId });
        return json(response, 200, { ok: true });
      }
      if (url.pathname === "/api/workspace" && request.method === "POST") {
        const input = await body(request);
        const kind = input.kind as WorkspaceKind;
        const title = typeof input.title === "string" ? input.title.trim() : "";
        const content = typeof input.content === "string" ? input.content : "";
        if (!kinds.includes(kind) || !title || content.length > 100_000) return json(response, 400, { error: "Kind, title, and valid content are required." });
        const path = `${folders[kind]}/${Date.now()}-${slug(title)}.md`;
        const target = safePath(config.workspacePath, path)!;
        await mkdir(resolve(target, ".."), { recursive: true });
        await writeFile(target, `# ${title}\n\n- Workspace type: ${kind}\n- Status: Draft\n- Owner-reviewed: No\n\n${content.trim()}\n`, "utf8");
        publish("workspace-created", { path, kind, title, userId: session.userId });
        return json(response, 201, { path });
      }
      return json(response, 404, { error: "Not found." });
    } catch (error) {
      console.error("Warden dashboard request failed:", error);
      return json(response, 500, { error: "Dashboard request failed." });
    }
  });
  return { server, start: async () => { await ensureWorkspace(config.workspacePath); return new Promise<AddressInfo>((resolveStart, reject) => { server.once("error", reject); server.listen(config.port, config.host, () => resolveStart(server.address() as AddressInfo)); }); } };
}

const DASHBOARD_HTML = String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aeloria Warden Workarea</title><style>body{font-family:system-ui,sans-serif;max-width:1250px;margin:auto;padding:1rem;background:#111827;color:#e5e7eb}header,section{background:#1f2937;border:1px solid #374151;border-radius:12px;padding:1rem;margin-bottom:1rem}button,select,input,textarea{font:inherit;padding:.6rem;border-radius:6px;border:1px solid #4b5563;background:#111827;color:#e5e7eb}button{cursor:pointer;background:#4f46e5;border:0}.grid{display:grid;grid-template-columns:280px 1fr;gap:1rem}.files{max-height:60vh;overflow:auto}.file{display:block;width:100%;text-align:left;margin:.25rem 0;background:#374151}.muted{color:#9ca3af}textarea{width:100%;min-height:55vh;box-sizing:border-box}.row{display:flex;gap:.5rem;flex-wrap:wrap}</style></head><body><main id="login"><h1>Aeloria Warden</h1><p class="muted">Owner-only local workarea. Workspace notes remain separate from approved canon.</p><input id="token" type="password" placeholder="Dashboard access token" style="width:100%;box-sizing:border-box"><p><button onclick="login()">Unlock workarea</button></p><p id="loginError"></p></main><main id="app" hidden><header><div class="row"><h1 style="margin:0;flex:1">Aeloria Warden Workarea</h1><button onclick="logout()">Lock</button></div><p class="muted">Draft lore, territories, build ideas, tasks, and notes. Approval remains a deliberate owner action.</p><div id="statusCard" class="muted">Loading live guild status...</div></header><section><h2>Safety controls</h2><p class="muted">Smoke posts are marked and removable. Lockdown changes public text-channel send overwrites and must be reviewed after use.</p><div class="row"><button onclick="smoke('preview')">Smoke preview</button><button onclick="smoke('run')">Run smoke posts</button><button onclick="smoke('cleanup')">Clean smoke posts</button><button onclick="lockdown('status')">Lockdown status</button><button onclick="lockdown('enable')">Emergency lockdown</button><button onclick="lockdown('disable')">Lift lockdown</button></div><pre id="safety" class="muted"></pre></section><section><div class="row"><select id="kind"><option value="lore">Lore draft</option><option value="territory">Territory plan</option><option value="build-idea">Build idea</option><option value="task">Project task</option><option value="note">Project note</option></select><input id="title" placeholder="Title" style="flex:1"><button onclick="createFile()">Create</button><button onclick="refresh()">Refresh</button></div></section><section><h2>Talk with Warden</h2><p class="muted">Shared workspace, reviewed Obsidian notes, repository context, and recent conversation.</p><div id="chat" style="max-height:20vh;overflow:auto"></div><div class="row"><input id="question" placeholder="Ask, challenge, brainstorm..." style="flex:1"><button onclick="ask()">Ask Warden</button></div></section><section class="grid"><aside><h2>Workspace</h2><div id="files" class="files"></div></aside><article><h2 id="current">Select a workspace file</h2><textarea id="editor" placeholder="Choose a file or create a new workspace item..."></textarea><p><button onclick="saveFile()">Save draft</button><span id="status" class="muted"></span></p></article></section></main><script>let currentPath="";async function api(url,options){const r=await fetch(url,options);const d=await r.json();if(!r.ok)throw Error(d.error||"Request failed");return d}async function login(){try{await api('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:document.querySelector('#token').value})});showApp();refresh()}catch(e){document.querySelector('#loginError').textContent=e.message}}function showApp(){document.querySelector('#login').hidden=true;document.querySelector('#app').hidden=false}async function logout(){await api('/api/logout',{method:'POST'});location.reload()}async function smoke(action){try{const d=await api('/api/smoke',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action})});document.querySelector('#safety').textContent=d.lines.join('\\n')}catch(e){document.querySelector('#safety').textContent=e.message}}async function lockdown(action){try{const d=await api('/api/lockdown',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action})});document.querySelector('#safety').textContent=d.lines.join('\\n')}catch(e){document.querySelector('#safety').textContent=e.message}}async function refresh(){try{const d=await api('/api/workspace');document.querySelector('#files').innerHTML=d.files.map(f=>'<button class="file" onclick="openFile('+JSON.stringify(f.path)+')">'+f.kind+': '+f.title+'</button>').join('')||'<p class="muted">No workspace items yet.</p>';const s=await api('/api/status');document.querySelector('#statusCard').textContent=s.connected?'Guild: '+s.guildName+' ('+s.guildId+') · '+s.memberCount+' members · '+s.categoryCount+' categories · '+s.channelCount+' channels · '+s.roleCount+' roles':'Guild unavailable: '+(s.detail||'not connected')}catch(e){if(e.message.includes('authentication'))location.reload()}}async function openFile(path){const d=await api('/api/workspace/file?path='+encodeURIComponent(path));currentPath=path;document.querySelector('#current').textContent=path;document.querySelector('#editor').value=d.content}async function saveFile(){if(!currentPath)return;await api('/api/workspace/file',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({path:currentPath,content:document.querySelector('#editor').value})});document.querySelector('#status').textContent='Saved locally';refresh()}async function createFile(){const title=document.querySelector('#title').value.trim();if(!title)return;const d=await api('/api/workspace',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:document.querySelector('#kind').value,title,content:''})});document.querySelector('#title').value='';await refresh();openFile(d.path)}async function ask(){const q=document.querySelector('#question').value.trim();if(!q)return;document.querySelector('#question').value='';const chat=document.querySelector('#chat');chat.innerHTML+='<p><b>You:</b> '+q.replaceAll('&','&amp;').replaceAll('<','&lt;')+'</p>';const d=await api('/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:q})});chat.innerHTML+='<p><b>Warden:</b> '+d.answer.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('\\n','<br>')+'</p>';chat.scrollTop=chat.scrollHeight}</script></body></html>`;
