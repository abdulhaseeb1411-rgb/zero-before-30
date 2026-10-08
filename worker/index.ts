import { interpretTransaction, validateInterpretation, type Interpretation } from "../src/lib/transaction";
import { interpretWithAi } from "../src/lib/ai";
import { ensureAccount, handleLedgerIntent, type Ctx } from "./ledger";

type Env = Cloudflare.Env & {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  OPENAI_API_KEY?: string;
};

type SupabaseUser = { id: string; email?: string };

// The PWA and API are served from the same origin, so no cross-origin access is granted.
const corsHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders },
  });
}

function bearerToken(request: Request) {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

async function supabaseRequest(env: Env, path: string, token: string, init: RequestInit = {}) {
  return fetch(new URL(path, env.SUPABASE_URL), {
    ...init,
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function getUser(env: Env, token: string): Promise<SupabaseUser | null> {
  const response = await supabaseRequest(env, "/auth/v1/user", token);
  if (!response.ok) return null;
  return (await response.json()) as SupabaseUser;
}

async function getFinancialSummary(env: Env, token: string) {
  const response = await supabaseRequest(env, "/rest/v1/rpc/z30_summary", token, { method: "POST", body: "{}" });
  if (!response.ok) throw new Error("Unable to load financial summary.");
  const row = await response.json() as { income: number | string; salary_deductions: number | string; expenses: number | string; transaction_count: number };
  const income = Number(row.income), salary_deductions = Number(row.salary_deductions), expenses = Number(row.expenses);
  return { income, salary_deductions, expenses, net_recorded: income - salary_deductions - expenses, currency: "PKR", transaction_count: row.transaction_count };
}

async function handleFinancialSummary(request: Request, env: Env) {
  const token = bearerToken(request);
  if (!token) return json({ error: "Authentication required." }, 401);
  const user = await getUser(env, token);
  if (!user?.id) return json({ error: "Invalid or expired session." }, 401);
  try {
    return json({ ok: true, summary: await getFinancialSummary(env, token) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unable to load financial summary." }, 500);
  }
}

async function listTransactions(env: Env, token: string, userId: string) {
  const params = new URLSearchParams({
    select: "id,type,amount,currency,description,transaction_date,transaction_at,created_at",
    user_id: "eq." + userId,
    status: "eq.active",
    order: "created_at.desc",
    limit: "25",
  });
  const response = await supabaseRequest(env, "/rest/v1/transactions?" + params.toString(), token);
  if (!response.ok) throw new Error("Unable to load transactions.");
  return await response.json();
}

async function handleListTransactions(request: Request, env: Env) {
  const token = bearerToken(request);
  if (!token) return json({ error: "Authentication required." }, 401);
  const user = await getUser(env, token);
  if (!user?.id) return json({ error: "Invalid or expired session." }, 401);
  try {
    const transactions = await listTransactions(env, token, user.id);
    return json({ ok: true, transactions });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unable to load transactions." }, 500);
  }
}

async function findDefaultAccount(env: Env, token: string, userId: string) {
  const params = new URLSearchParams({ select: "id,name", user_id: "eq." + userId, is_default: "eq.true", is_active: "eq.true", limit: "1" });
  const response = await supabaseRequest(env, "/rest/v1/accounts?" + params.toString(), token);
  if (!response.ok) return null;
  const rows = await response.json() as Array<{ id: string; name: string }>;
  return rows[0] ?? null;
}

async function findCategory(env: Env, token: string, kind: "expense" | "income", description: string) {
  const params = new URLSearchParams({ select: "id,name,kind", kind: "eq." + kind, limit: "100" });
  const response = await supabaseRequest(env, "/rest/v1/categories?" + params.toString(), token);
  if (!response.ok) throw new Error("Unable to read categories.");
  const categories = await response.json() as Array<{ id: string; name: string; kind: "expense" | "income" }>;
  const text = description.toLowerCase();
  const aliases = kind === "expense"
    ? [
        { terms: ["petrol", "fuel", "diesel"], names: ["transport"] },
        { terms: ["grocery", "groceries", "sabzi", "vegetable", "vegetables", "chicken", "meat", "eggs", "naan"], names: ["groceries"] },
        { terms: ["lunch", "dinner", "breakfast", "restaurant", "meal", "food", "chai", "tea", "snacks", "snack"], names: ["food & dining"] },
        { terms: ["medicine", "doctor", "hospital", "pharmacy"], names: ["health"] },
        { terms: ["electricity", "bijli", "gas bill", "water bill", "internet", "mobile"], names: ["bills & utilities"] },
      ]
    : [{ terms: ["salary", "paycheck", "wage"], names: ["salary"] }];
  for (const alias of aliases) {
    if (alias.terms.some((term) => text.includes(term))) {
      const match = categories.find((category) => alias.names.includes(category.name.toLowerCase()));
      if (match) return match;
    }
  }
  return categories.find((category) => category.name.toLowerCase().startsWith("other")) ?? null;
}

function pakistanTodayYmd() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function pakistanTodayIso() {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Karachi", weekday: "long" }).format(new Date());
  return weekday + " " + pakistanTodayYmd();
}

// AI first. If the AI is unavailable or fails, fall back to the conservative regex interpreter.
async function interpret(env: Env, input: string): Promise<{ result: Interpretation; source: "ai" | "regex"; usage: { input_tokens: number; output_tokens: number } | null }> {
  if (env.OPENAI_API_KEY) {
    try {
      const ai = await interpretWithAi(env.OPENAI_API_KEY, input, pakistanTodayIso(), pakistanTodayYmd(), AbortSignal.timeout(10000));
      return { result: ai.interpretation, source: "ai", usage: ai.usage };
    } catch (error) {
      console.error("AI interpretation failed, using regex fallback:", error instanceof Error ? error.message : "unknown");
    }
  }
  return { result: interpretTransaction(input), source: "regex", usage: null };
}

function pakistanNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Karachi" }));
}

function buildTransactionTimestamp(transactionTime: string | null, dateOffset: number) {
  const date = pakistanNow();
  date.setDate(date.getDate() + dateOffset);
  const datePart = date.toISOString().slice(0, 10);
  if (!transactionTime) return dateOffset === 0 ? new Date().toISOString() : datePart + "T12:00:00+05:00";
  return datePart + "T" + transactionTime + ":00+05:00";
}

class AskError extends Error {}

async function createTransaction(env: Env, token: string, userId: string, result: ReturnType<typeof interpretTransaction>, ctx: Ctx) {
  if (!result.amount || !result.currency || !result.description) throw new Error("Incomplete transaction interpretation.");
  let accountId: string | null = null;
  if (result.intent === "expense" && !result.salary_deduction) {
    const resolved = await ensureAccount(ctx, result.account ?? "Cash");
    if ("ask" in resolved) throw new AskError(resolved.ask);
    accountId = resolved.account.id;
  }
  const kind = result.intent === "income" ? "income" : "expense";
  const category = await findCategory(env, token, kind, result.description);
  if (!category) throw new Error("No " + kind + " category is available.");
  const transactionAt = buildTransactionTimestamp(result.transaction_time, result.date_offset);
  const transaction = {
    user_id: userId, type: result.intent, amount: result.amount, currency: result.currency,
    category_id: category.id, description: result.description,
    transaction_date: transactionAt.slice(0, 10), transaction_at: transactionAt,
    account_id: accountId, status: "active",
  };
  const response = await supabaseRequest(env, "/rest/v1/transactions", token, {
    method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(transaction),
  });
  if (!response.ok) { const detail = await response.text(); throw new Error(detail || "Supabase rejected the transaction."); }
  const rows = await response.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

async function reserveInputEvent(env: Env, token: string, userId: string, rawText: string, result: ReturnType<typeof interpretTransaction>, status: "received" | "needs_clarification", clientRequestId: string) {
  const response = await supabaseRequest(env, "/rest/v1/input_events", token, {
    method: "POST",
    headers: { Prefer: "return=representation,resolution=ignore-duplicates" },
    body: JSON.stringify({
      user_id: userId,
      raw_text: rawText,
      channel: "web",
      parsed_result: result,
      confidence: result.confidence,
      status,
      transaction_id: null,
      client_request_id: clientRequestId,
    }),
  });
  if (!response.ok) throw new Error("Unable to reserve transaction request.");
  const rows = await response.json() as Array<{ id: string; status: string; transaction_id: string | null; created_at?: string; parsed_result: ReturnType<typeof interpretTransaction> }>;
  if (rows[0]) return { created: true, event: rows[0] };

  const params = new URLSearchParams({
    select: "id,status,transaction_id,created_at,parsed_result",
    user_id: "eq." + userId,
    client_request_id: "eq." + clientRequestId,
    limit: "1",
  });
  const existingResponse = await supabaseRequest(env, "/rest/v1/input_events?" + params.toString(), token);
  if (!existingResponse.ok) throw new Error("Unable to inspect transaction request.");
  const existingRows = await existingResponse.json() as Array<{ id: string; status: string; transaction_id: string | null; created_at?: string; parsed_result: ReturnType<typeof interpretTransaction> }>;
  return existingRows[0] ? { created: false, event: existingRows[0] } : null;
}

async function updateInputEvent(env: Env, token: string, userId: string, eventId: string, status: "received" | "recorded" | "failed" | "answered" | "needs_clarification", transactionId: string | null, parsedResult?: unknown) {
  const params = new URLSearchParams({ id: "eq." + eventId, user_id: "eq." + userId });
  const response = await supabaseRequest(env, "/rest/v1/input_events?" + params.toString(), token, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(parsedResult === undefined ? { status, transaction_id: transactionId } : { status, transaction_id: transactionId, parsed_result: parsedResult }),
  });
  if (!response.ok) console.error("input_events update failed", await response.text());
}
const DAILY_ENTRY_LIMIT = 60;

async function entriesToday(env: Env, token: string, userId: string) {
  const start = pakistanTodayYmd() + "T00:00:00+05:00";
  const params = new URLSearchParams({ select: "id", user_id: "eq." + userId, created_at: "gte." + start, limit: "1" });
  const response = await supabaseRequest(env, "/rest/v1/input_events?" + params.toString(), token, { headers: { Prefer: "count=exact", Range: "0-0" } });
  const range = response.headers.get("Content-Range") ?? "";
  const total = Number(range.split("/")[1]);
  return Number.isFinite(total) ? total : 0;
}

// A failed event, or one stuck in "received" for over a minute, may be retried with the same client_request_id.
function isRetryable(event: { status: string; created_at?: string }) {
  if (event.status === "failed") return true;
  return event.status === "received" && !!event.created_at && Date.now() - Date.parse(event.created_at) > 60_000;
}

async function handleTransaction(request: Request, env: Env) {
  const token = bearerToken(request);
  if (!token) return json({ error: "Authentication required." }, 401);
  const user = await getUser(env, token);
  if (!user?.id) return json({ error: "Invalid or expired session." }, 401);
  const body = await request.json().catch(() => null) as { input?: string; client_request_id?: string } | null;
  const input = body?.input?.trim();
  if (!input) return json({ error: "Input is required." }, 400);
  const clientRequestId = body?.client_request_id?.trim()
    || request.headers.get("X-Client-Request-Id")?.trim()
    || crypto.randomUUID();

  if (input.length > 300) return json({ error: "Entries can be up to 300 characters." }, 400);
  if (await entriesToday(env, token, user.id) >= DAILY_ENTRY_LIMIT) return json({ error: "Daily limit of " + DAILY_ENTRY_LIMIT + " entries reached. It resets at midnight Pakistan time." }, 429);
  const { result } = await interpret(env, input);
  // Explicit facts override defaults: the default account is applied only when NO payment method was stated.
  if (result.intent === "expense" && !result.salary_deduction && !result.account && !result.needs_clarification && !result.payment_text) {
    const fallback = await findDefaultAccount(env, token, user.id);
    if (fallback) { result.account = fallback.name; result.account_defaulted = true; }
  }
  const validation = validateInterpretation(result);

  if (!validation.valid) {
    const reservation = await reserveInputEvent(env, token, user.id, input, result, "needs_clarification", clientRequestId);
    if (!reservation) return json({ error: "Unable to reserve transaction request." }, 500);
    if (!reservation.created) {
      if (reservation.event.status === "needs_clarification") {
        return json({ ok: false, needs_clarification: true, clarification_reason: reservation.event.parsed_result.clarification_reason, interpretation: reservation.event.parsed_result, idempotent: true }, 422);
      }
      if (reservation.event.status === "recorded" && reservation.event.transaction_id) {
        return json({ ok: true, transaction_id: reservation.event.transaction_id, interpretation: reservation.event.parsed_result, idempotent: true });
      }
      return json({ ok: false, processing: true, idempotent: true }, 409);
    }
    return json({ ok: false, needs_clarification: true, clarification_reason: validation.reason, interpretation: result }, 422);
  }

  const reservation = await reserveInputEvent(env, token, user.id, input, result, "received", clientRequestId);
  if (!reservation) return json({ error: "Unable to reserve transaction request." }, 500);
  if (!reservation.created && isRetryable(reservation.event)) {
    await updateInputEvent(env, token, user.id, reservation.event.id, "received", null);
  } else if (!reservation.created) {
    const stored = (reservation.event.parsed_result as unknown as { ledger?: { message: string; kind: string } })?.ledger;
    if ((reservation.event.status === "recorded" || reservation.event.status === "answered") && stored) {
      return json({ ok: true, kind: stored.kind, message: stored.message, transaction_id: reservation.event.transaction_id, interpretation: reservation.event.parsed_result, idempotent: true });
    }
    if (reservation.event.status === "recorded" && reservation.event.transaction_id) {
      const transactionParams = new URLSearchParams({
        select: "id,type,amount,currency,description,transaction_date,transaction_at,account_id",
        id: "eq." + reservation.event.transaction_id,
        user_id: "eq." + user.id,
        limit: "1",
      });
      const transactionResponse = await supabaseRequest(env, "/rest/v1/transactions?" + transactionParams.toString(), token);
      if (transactionResponse.ok) {
        const rows = await transactionResponse.json();
        if (Array.isArray(rows) && rows[0]) return json({ ok: true, transaction: rows[0], interpretation: reservation.event.parsed_result, idempotent: true });
      }
    }
    if (reservation.event.status === "needs_clarification") {
      return json({ ok: false, needs_clarification: true, clarification_reason: reservation.event.parsed_result.clarification_reason, interpretation: reservation.event.parsed_result, idempotent: true }, 422);
    }
    return json({ ok: false, processing: true, idempotent: true }, 409);
  }

  const ctx: Ctx = { db: (path, init) => supabaseRequest(env, path, token, init), userId: user.id, today: pakistanTodayYmd(), rawText: input };

  if (result.intent !== "expense" && result.intent !== "income" && result.intent !== "salary_deduction") {
    try {
      const outcome = await handleLedgerIntent(ctx, result);
      if (!outcome.ok) {
        await updateInputEvent(env, token, user.id, reservation.event.id, "needs_clarification", null, { ...result, needs_clarification: true, clarification_reason: outcome.ask });
        return json({ ok: false, needs_clarification: true, clarification_reason: outcome.ask, interpretation: result }, 422);
      }
      const status = outcome.kind === "query" ? "answered" : "recorded";
      await updateInputEvent(env, token, user.id, reservation.event.id, status, outcome.transaction_id, { ...result, ledger: { kind: outcome.kind, message: outcome.message, details: outcome.details } });
      return json({ ok: true, kind: outcome.kind, message: outcome.message, transaction_id: outcome.transaction_id, details: outcome.details, interpretation: result });
    } catch (error) {
      console.error("ledger failure:", error instanceof Error ? error.message : "unknown");
      await updateInputEvent(env, token, user.id, reservation.event.id, "failed", null);
      return json({ ok: false, error: "I couldn't record that. Nothing was changed. Please try again." }, 422);
    }
  }

  try {
    const transaction = await createTransaction(env, token, user.id, result, ctx);
    await updateInputEvent(env, token, user.id, reservation.event.id, "recorded", transaction?.id ?? null);
    return json({ ok: true, transaction, interpretation: result });
  } catch (error) {
    if (error instanceof AskError) {
      await updateInputEvent(env, token, user.id, reservation.event.id, "needs_clarification", null, { ...result, needs_clarification: true, clarification_reason: error.message });
      return json({ ok: false, needs_clarification: true, clarification_reason: error.message, interpretation: result }, 422);
    }
    await updateInputEvent(env, token, user.id, reservation.event.id, "failed", null);
    return json({ ok: false, error: error instanceof Error ? error.message : "Unable to record transaction." }, 422);
  }
}

async function handleBetaSignup(request: Request, env: Env) {
  let body: { email?: unknown; name?: unknown; note?: unknown; website?: unknown };
  try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
  if (body.website) return json({ ok: true }); // honeypot: bots fill this hidden field
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return json({ error: "Please enter a valid email." }, 400);
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 100) : null;
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;
  const response = await fetch(new URL("/rest/v1/beta_signups", env.SUPABASE_URL), {
    method: "POST",
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + env.SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ email, name, note }),
  });
  if (response.ok || response.status === 409) return json({ ok: true }); // duplicate email counts as already signed up
  return json({ error: "Could not save your sign-up right now. Please try again." }, 500);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    const url = new URL(request.url);
    if (url.pathname === "/api/health" && request.method === "GET") return json({ ok: true, service: "z30-api", ai_key_configured: Boolean(env.OPENAI_API_KEY) });
    if (url.pathname === "/api/summary" && request.method === "GET") return handleFinancialSummary(request, env);
    if (url.pathname === "/api/transactions" && request.method === "GET") return handleListTransactions(request, env);
    if (url.pathname === "/api/transactions" && request.method === "POST") return handleTransaction(request, env);
    if (url.pathname === "/api/beta-signup" && request.method === "POST") return handleBetaSignup(request, env);
    if (url.pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);
    return env.ASSETS.fetch(request);
  },
};
