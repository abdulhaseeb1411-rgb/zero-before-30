import { interpretTransaction, validateInterpretation } from "../src/lib/transaction";

type Env = Cloudflare.Env & {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
};

type SupabaseUser = { id: string; email?: string };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-request-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

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

async function findAccount(env: Env, token: string, userId: string, name: string) {
  const params = new URLSearchParams({
    select: "id,name,type,currency,is_active",
    user_id: "eq." + userId,
    name: "eq." + name,
    is_active: "eq.true",
    limit: "1",
  });
  const response = await supabaseRequest(env, "/rest/v1/accounts?" + params.toString(), token);
  if (!response.ok) throw new Error("Unable to read accounts.");
  const rows = await response.json() as Array<{ id: string; name: string; type: string; currency: string; is_active: boolean }>;
  return rows[0] ?? null;
}

async function ensureCashAccount(env: Env, token: string, userId: string) {
  const existing = await findAccount(env, token, userId, "Cash");
  if (existing) return existing;
  const response = await supabaseRequest(env, "/rest/v1/accounts", token, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ user_id: userId, name: "Cash", type: "cash", currency: "PKR", is_default: false, is_active: true }),
  });
  if (response.ok) {
    const rows = await response.json() as Array<{ id: string; name: string; type: string; currency: string; is_active: boolean }>;
    return rows[0] ?? null;
  }
  const retry = await findAccount(env, token, userId, "Cash");
  if (retry) return retry;
  throw new Error("Unable to create the Cash account.");
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
        { terms: ["lunch", "dinner", "breakfast", "restaurant", "meal", "food"], names: ["food & dining"] },
        { terms: ["medicine", "doctor", "hospital", "pharmacy"], names: ["health"] },
        { terms: ["electricity", "gas bill", "water bill", "internet", "mobile"], names: ["bills & utilities"] },
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

function pakistanNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Karachi" }));
}

function buildTransactionTimestamp(transactionTime: string | null) {
  const now = pakistanNow();
  const date = now.toISOString().slice(0, 10);
  if (!transactionTime) return new Date().toISOString();
  return date + "T" + transactionTime + ":00+05:00";
}

async function createTransaction(env: Env, token: string, userId: string, result: ReturnType<typeof interpretTransaction>) {
  if (!result.amount || !result.currency || !result.description) throw new Error("Incomplete transaction interpretation.");
  let accountId: string | null = null;
  if (result.intent === "expense") {
    const accountName = result.account ?? "Cash";
    const account = accountName === "Cash"
      ? await ensureCashAccount(env, token, userId)
      : await findAccount(env, token, userId, accountName);
    accountId = account?.id ?? null;
    if (!accountId) throw new Error("Payment account could not be resolved.");
  }
  const kind = result.intent === "income" ? "income" : "expense";
  const category = await findCategory(env, token, kind, result.description);
  if (!category) throw new Error("No " + kind + " category is available.");
  const transactionAt = buildTransactionTimestamp(result.transaction_time);
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

async function recordInputEvent(env: Env, token: string, userId: string, rawText: string, result: ReturnType<typeof interpretTransaction>, status: string, clientRequestId: string, transactionId: string | null = null) {
  const response = await supabaseRequest(env, "/rest/v1/input_events", token, {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ user_id: userId, raw_text: rawText, channel: "web", parsed_result: result, confidence: result.confidence, status, transaction_id: transactionId, client_request_id: clientRequestId }),
  });
  if (!response.ok) console.error("input_events write failed", await response.text());
}

async function handleTransaction(request: Request, env: Env) {
  const token = bearerToken(request);
  if (!token) return json({ error: "Authentication required." }, 401);
  const user = await getUser(env, token);
  if (!user?.id) return json({ error: "Invalid or expired session." }, 401);
  const body = await request.json().catch(() => null) as { input?: string; client_request_id?: string } | null;
  const input = body?.input?.trim();
  if (!input) return json({ error: "Input is required." }, 400);
  const clientRequestId = body?.client_request_id?.trim() || crypto.randomUUID();
  const result = interpretTransaction(input);
  const validation = validateInterpretation(result);
  if (!validation.valid) {
    await recordInputEvent(env, token, user.id, input, result, "needs_clarification", clientRequestId);
    return json({ ok: false, needs_clarification: true, clarification_reason: validation.reason, interpretation: result }, 422);
  }
  try {
    const transaction = await createTransaction(env, token, user.id, result);
    await recordInputEvent(env, token, user.id, input, result, "recorded", clientRequestId, transaction?.id ?? null);
    return json({ ok: true, transaction, interpretation: result });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Unable to record transaction." }, 422);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    const url = new URL(request.url);
    if (url.pathname === "/api/health" && request.method === "GET") return json({ ok: true, service: "z30-api" });
    if (url.pathname === "/api/transactions" && request.method === "GET") return handleListTransactions(request, env);
    if (url.pathname === "/api/transactions" && request.method === "POST") return handleTransaction(request, env);
    if (url.pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);
    return env.ASSETS.fetch(request);
  },
};
