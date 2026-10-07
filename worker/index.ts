import { interpretTransaction, validateInterpretation } from "../src/lib/transaction";

type Env = Cloudflare.Env & {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  OPENAI_API_KEY?: string;
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

async function getFinancialSummary(env: Env, token: string, userId: string) {
  const params = new URLSearchParams({
    select: "type,amount,currency",
    user_id: "eq." + userId,
    status: "eq.active",
    limit: "1000",
  });
  const response = await supabaseRequest(env, "/rest/v1/transactions?" + params.toString(), token);
  if (!response.ok) throw new Error("Unable to load financial summary.");
  const rows = await response.json() as Array<{ type: string; amount: number | string; currency: string }>;

  const summary = {
    income: 0,
    salary_deductions: 0,
    expenses: 0,
    net_recorded: 0,
    currency: "PKR",
    transaction_count: rows.length,
  };

  for (const row of rows) {
    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) continue;
    if (row.type === "income") summary.income += amount;
    else if (row.type === "salary_deduction") summary.salary_deductions += amount;
    else if (row.type === "expense") summary.expenses += amount;
    if (row.currency) summary.currency = row.currency;
  }

  summary.net_recorded = summary.income - summary.salary_deductions - summary.expenses;
  return summary;
}

async function handleFinancialSummary(request: Request, env: Env) {
  const token = bearerToken(request);
  if (!token) return json({ error: "Authentication required." }, 401);
  const user = await getUser(env, token);
  if (!user?.id) return json({ error: "Invalid or expired session." }, 401);
  try {
    return json({ ok: true, summary: await getFinancialSummary(env, token, user.id) });
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

async function findSingleCardAccount(env: Env, token: string, userId: string) {
  const params = new URLSearchParams({
    select: "id,name,type,currency,is_active",
    user_id: "eq." + userId,
    type: "eq.card",
    is_active: "eq.true",
    limit: "2",
  });
  const response = await supabaseRequest(env, "/rest/v1/accounts?" + params.toString(), token);
  if (!response.ok) throw new Error("Unable to read card accounts.");
  const rows = await response.json() as Array<{ id: string; name: string; type: string; currency: string; is_active: boolean }>;
  return rows.length === 1 ? rows[0] : null;
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

async function createTransaction(env: Env, token: string, userId: string, result: ReturnType<typeof interpretTransaction>) {
  if (!result.amount || !result.currency || !result.description) throw new Error("Incomplete transaction interpretation.");
  let accountId: string | null = null;
  if (result.intent === "expense") {
    if (!result.salary_deduction) {
      const accountName = result.account ?? "Cash";
      const account = accountName === "Cash"
        ? await ensureCashAccount(env, token, userId)
        : accountName === "Credit Card"
          ? await findSingleCardAccount(env, token, userId)
          : await findAccount(env, token, userId, accountName);
      accountId = account?.id ?? null;
      if (!accountId) throw new Error("Payment account could not be resolved.");
    }
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
  const rows = await response.json() as Array<{ id: string; status: string; transaction_id: string | null; parsed_result: ReturnType<typeof interpretTransaction> }>;
  if (rows[0]) return { created: true, event: rows[0] };

  const params = new URLSearchParams({
    select: "id,status,transaction_id,parsed_result",
    user_id: "eq." + userId,
    client_request_id: "eq." + clientRequestId,
    limit: "1",
  });
  const existingResponse = await supabaseRequest(env, "/rest/v1/input_events?" + params.toString(), token);
  if (!existingResponse.ok) throw new Error("Unable to inspect transaction request.");
  const existingRows = await existingResponse.json() as Array<{ id: string; status: string; transaction_id: string | null; parsed_result: ReturnType<typeof interpretTransaction> }>;
  return existingRows[0] ? { created: false, event: existingRows[0] } : null;
}

async function updateInputEvent(env: Env, token: string, userId: string, eventId: string, status: "recorded" | "failed", transactionId: string | null) {
  const params = new URLSearchParams({ id: "eq." + eventId, user_id: "eq." + userId });
  const response = await supabaseRequest(env, "/rest/v1/input_events?" + params.toString(), token, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status, transaction_id: transactionId }),
  });
  if (!response.ok) console.error("input_events update failed", await response.text());
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

  const result = interpretTransaction(input);
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
  if (!reservation.created) {
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

  try {
    const transaction = await createTransaction(env, token, user.id, result);
    await updateInputEvent(env, token, user.id, reservation.event.id, "recorded", transaction?.id ?? null);
    return json({ ok: true, transaction, interpretation: result });
  } catch (error) {
    await updateInputEvent(env, token, user.id, reservation.event.id, "failed", null);
    return json({ ok: false, error: error instanceof Error ? error.message : "Unable to record transaction." }, 422);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    const url = new URL(request.url);
    if (url.pathname === "/api/health" && request.method === "GET") return json({ ok: true, service: "z30-api", ai_key_configured: Boolean(env.OPENAI_API_KEY), diag_env_names: Object.keys(env as unknown as Record<string, unknown>).sort() });
    if (url.pathname === "/api/summary" && request.method === "GET") return handleFinancialSummary(request, env);
    if (url.pathname === "/api/transactions" && request.method === "GET") return handleListTransactions(request, env);
    if (url.pathname === "/api/transactions" && request.method === "POST") return handleTransaction(request, env);
    if (url.pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);
    return env.ASSETS.fetch(request);
  },
};
