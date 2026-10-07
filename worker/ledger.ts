import type { Interpretation } from "../src/lib/transaction";

// Deterministic ledger engine. The AI only supplies structured fields; everything here validates,
// decides and writes through the user's own session (RLS applies; database constraints are the last line of defence).

export type Db = (path: string, init?: RequestInit) => Promise<Response>;
export type Ctx = { db: Db; userId: string; today: string; rawText: string };
export type LedgerOutcome =
  | { ok: true; kind: string; message: string; transaction_id: string | null; details?: Record<string, unknown> }
  | { ok: false; ask: string };

type Lang = "en" | "roman_ur" | "ur";
const lang = (r: Interpretation): Lang => r.reply_language ?? "en";

function rs(n: number) {
  return "Rs " + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

// ---------- dates ----------
function ymdAdd(ymd: string, days: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
export function timestampFor(today: string, dateOffset: number | null, time: string | null) {
  const offset = dateOffset ?? 0;
  const date = ymdAdd(today, offset);
  if (!time) return offset === 0 ? new Date().toISOString() : date + "T12:00:00+05:00";
  return date + "T" + time + ":00+05:00";
}
function periodRange(today: string, period: string | null): { from: string; to: string; key: string } {
  const [y, m] = today.split("-").map(Number);
  const monthStart = today.slice(0, 8) + "01";
  switch (period) {
    case "today": return { from: today, to: today, key: "today" };
    case "yesterday": { const d = ymdAdd(today, -1); return { from: d, to: d, key: "yesterday" }; }
    case "this_week": return { from: ymdAdd(today, -6), to: today, key: "this_week" };
    case "last_month": {
      const lastEnd = ymdAdd(monthStart, -1);
      return { from: lastEnd.slice(0, 8) + "01", to: lastEnd, key: "last_month" };
    }
    case "all": return { from: "2000-01-01", to: today, key: "all" };
    default: void y; void m; return { from: monthStart, to: today, key: "this_month" };
  }
}

const periodLabel: Record<string, Record<Lang, string>> = {
  today: { en: "Today", roman_ur: "Aaj", ur: "آج" },
  yesterday: { en: "Yesterday", roman_ur: "Kal", ur: "کل" },
  this_week: { en: "Last 7 days", roman_ur: "Pichle 7 din", ur: "پچھلے 7 دن" },
  this_month: { en: "This month", roman_ur: "Is mahine", ur: "اس مہینے" },
  last_month: { en: "Last month", roman_ur: "Pichle mahine", ur: "پچھلے مہینے" },
  all: { en: "Overall", roman_ur: "Kul", ur: "کل" },
};

// ---------- people ----------
function cleanName(name: string) {
  return name.replace(/[%*_,()\\"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

async function findPeople(ctx: Ctx, name: string): Promise<Array<{ id: string; name: string }>> {
  const clean = cleanName(name);
  if (!clean) return [];
  const params = new URLSearchParams({ select: "id,name", user_id: "eq." + ctx.userId, is_active: "eq.true", name: "ilike." + clean, limit: "5" });
  const response = await ctx.db("/rest/v1/people?" + params.toString());
  if (!response.ok) throw new Error("Unable to read people.");
  return await response.json() as Array<{ id: string; name: string }>;
}

async function createPerson(ctx: Ctx, name: string) {
  const clean = cleanName(name);
  const response = await ctx.db("/rest/v1/people", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ user_id: ctx.userId, name: clean, is_active: true }),
  });
  if (!response.ok) throw new Error("Unable to save this person.");
  const rows = await response.json() as Array<{ id: string; name: string }>;
  return rows[0];
}

// ---------- accounts ----------
const accountTypes: Record<string, string> = {
  "Cash": "cash", "Bank Alfalah Credit Card": "card", "HBL Credit Card": "card", "UBL Credit Card": "card",
  "JS Bank Credit Card": "card", "Meezan": "bank", "Credit Card": "card",
};

type Account = { id: string; name: string; type: string };

async function findAccountsByName(ctx: Ctx, name: string): Promise<Account[]> {
  const params = new URLSearchParams({ select: "id,name,type", user_id: "eq." + ctx.userId, is_active: "eq.true", name: "eq." + name, limit: "1" });
  const response = await ctx.db("/rest/v1/accounts?" + params.toString());
  if (!response.ok) throw new Error("Unable to read accounts.");
  return await response.json() as Account[];
}

// Explicit account named by the user: use it, creating it on first mention (progressive accounts).
export async function ensureAccount(ctx: Ctx, name: string): Promise<{ account: Account } | { ask: string }> {
  const type = accountTypes[name];
  if (!type) return { ask: "I don't have an account called \"" + name + "\". Which account did you use?" };
  if (name === "Credit Card") {
    const params = new URLSearchParams({ select: "id,name,type", user_id: "eq." + ctx.userId, type: "eq.card", is_active: "eq.true", limit: "3" });
    const response = await ctx.db("/rest/v1/accounts?" + params.toString());
    if (!response.ok) throw new Error("Unable to read card accounts.");
    const cards = await response.json() as Account[];
    if (cards.length === 1) return { account: cards[0] };
    if (cards.length > 1) return { ask: "Which card: " + cards.map((c) => c.name).join(", ") + "?" };
  }
  const existing = await findAccountsByName(ctx, name);
  if (existing[0]) return { account: existing[0] };
  const response = await ctx.db("/rest/v1/accounts", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ user_id: ctx.userId, name, type, currency: "PKR", is_default: false, is_active: true }),
  });
  if (response.ok) {
    const rows = await response.json() as Account[];
    if (rows[0]) return { account: rows[0] };
  }
  const retry = await findAccountsByName(ctx, name);
  if (retry[0]) return { account: retry[0] };
  throw new Error("Unable to create the " + name + " account.");
}

// ---------- recording ----------
async function insertTransaction(ctx: Ctx, row: Record<string, unknown>) {
  const response = await ctx.db("/rest/v1/transactions", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) });
  if (!response.ok) throw new Error(await dbMessage(response));
  const rows = await response.json() as Array<{ id: string }>;
  return rows[0];
}

async function dbMessage(response: Response) {
  const text = await response.text();
  try { const j = JSON.parse(text) as { message?: string }; return j.message ?? text; } catch { return text; }
}

function when(ctx: Ctx, r: Interpretation) {
  const at = timestampFor(ctx.today, r.date_offset, r.transaction_time);
  return { transaction_at: at, transaction_date: at.slice(0, 10) };
}

async function optionalAccountId(ctx: Ctx, accountName: string | null | undefined): Promise<{ id: string | null } | { ask: string }> {
  if (!accountName) return { id: null };
  const resolved = await ensureAccount(ctx, accountName);
  return "ask" in resolved ? resolved : { id: resolved.account.id };
}

async function personForLoan(ctx: Ctx, name: string): Promise<{ person: { id: string; name: string } } | { ask: string }> {
  const matches = await findPeople(ctx, name);
  if (matches.length > 1) return { ask: "I have more than one \"" + name + "\" saved: " + matches.map((m) => m.name).join(", ") + ". Which one?" };
  if (matches[0]) return { person: matches[0] };
  return { person: await createPerson(ctx, name) };
}

const loanMsg = {
  lent: {
    en: (n: string, a: number) => "Recorded: you lent " + rs(a) + " to " + n + ".",
    roman_ur: (n: string, a: number) => "Record ho gaya: aap ne " + n + " ko " + rs(a) + " udhaar diye.",
    ur: (n: string, a: number) => "درج ہو گیا: آپ نے " + n + " کو " + rs(a) + " ادھار دیے۔",
  },
  borrowed: {
    en: (n: string, a: number) => "Recorded: you borrowed " + rs(a) + " from " + n + ".",
    roman_ur: (n: string, a: number) => "Record ho gaya: aap ne " + n + " se " + rs(a) + " udhaar liye.",
    ur: (n: string, a: number) => "درج ہو گیا: آپ نے " + n + " سے " + rs(a) + " ادھار لیے۔",
  },
};

async function recordLoan(ctx: Ctx, r: Interpretation, type: "lent" | "borrowed"): Promise<LedgerOutcome> {
  const resolved = await personForLoan(ctx, r.person ?? "");
  if ("ask" in resolved) return { ok: false, ask: resolved.ask };
  const account = await optionalAccountId(ctx, r.account);
  if ("ask" in account) return { ok: false, ask: account.ask };
  const tx = await insertTransaction(ctx, {
    user_id: ctx.userId, type, amount: r.amount, currency: r.currency ?? "PKR", person_id: resolved.person.id,
    description: r.description, account_id: account.id, status: "active", ...when(ctx, r),
  });
  return { ok: true, kind: type, transaction_id: tx.id, message: loanMsg[type][lang(r)](resolved.person.name, r.amount ?? 0), details: { person: resolved.person.name, amount: r.amount } };
}

async function recordSettlement(ctx: Ctx, r: Interpretation): Promise<LedgerOutcome> {
  const matches = await findPeople(ctx, r.person ?? "");
  if (matches.length === 0) return { ok: false, ask: "I don't have anyone called \"" + r.person + "\" in your records, so there is nothing to settle. Did you mean someone else?" };
  if (matches.length > 1) return { ok: false, ask: "I have more than one \"" + r.person + "\": " + matches.map((m) => m.name).join(", ") + ". Which one?" };
  const person = matches[0];
  const account = await optionalAccountId(ctx, r.account);
  if ("ask" in account) return { ok: false, ask: account.ask };
  const response = await ctx.db("/rest/v1/rpc/z30_settle", {
    method: "POST",
    body: JSON.stringify({
      p_person_id: person.id, p_direction: r.direction, p_amount: r.amount, p_currency: r.currency ?? "PKR",
      p_date: when(ctx, r).transaction_date, p_at: when(ctx, r).transaction_at, p_description: r.description, p_account_id: account.id,
    }),
  });
  if (!response.ok) {
    const message = await dbMessage(response);
    const exceeded = message.match(/AMOUNT_EXCEEDS_OUTSTANDING:([\d.]+)/);
    if (exceeded) {
      const covered = Number(exceeded[1]);
      const who = r.direction === "they_paid_me" ? person.name + " owes you only " : "you owe " + person.name + " only ";
      return { ok: false, ask: covered > 0 ? "That is more than what is outstanding: " + who + rs(covered) + ". Did you mean a different amount?" : "There is nothing outstanding " + (r.direction === "they_paid_me" ? "from " : "to ") + person.name + " to settle." };
    }
    throw new Error(message);
  }
  const result = await response.json() as { transaction_ids: string[]; outstanding_after: number };
  const left = Number(result.outstanding_after);
  const m: Record<Lang, string> = r.direction === "they_paid_me"
    ? {
        en: "Recorded: " + person.name + " paid you back " + rs(r.amount ?? 0) + "." + (left > 0 ? " Still owed to you: " + rs(left) + "." : " Fully settled."),
        roman_ur: "Record ho gaya: " + person.name + " ne " + rs(r.amount ?? 0) + " wapas kiye." + (left > 0 ? " Abhi baqi: " + rs(left) + "." : " Hisaab barabar."),
        ur: "درج ہو گیا: " + person.name + " نے " + rs(r.amount ?? 0) + " واپس کیے۔" + (left > 0 ? " باقی: " + rs(left) + "۔" : " حساب برابر۔"),
      }
    : {
        en: "Recorded: you paid " + person.name + " back " + rs(r.amount ?? 0) + "." + (left > 0 ? " You still owe: " + rs(left) + "." : " Fully settled."),
        roman_ur: "Record ho gaya: aap ne " + person.name + " ko " + rs(r.amount ?? 0) + " wapas kiye." + (left > 0 ? " Abhi baqi: " + rs(left) + "." : " Hisaab barabar."),
        ur: "درج ہو گیا: آپ نے " + person.name + " کو " + rs(r.amount ?? 0) + " واپس کیے۔" + (left > 0 ? " باقی: " + rs(left) + "۔" : " حساب برابر۔"),
      };
  return { ok: true, kind: "settlement", transaction_id: result.transaction_ids[0] ?? null, message: m[lang(r)], details: { person: person.name, outstanding_after: left } };
}

async function recordTransfer(ctx: Ctx, r: Interpretation): Promise<LedgerOutcome> {
  const from = await ensureAccount(ctx, r.account ?? "");
  if ("ask" in from) return { ok: false, ask: from.ask };
  const to = await ensureAccount(ctx, r.to_account ?? "");
  if ("ask" in to) return { ok: false, ask: to.ask };
  if (from.account.id === to.account.id) return { ok: false, ask: "The source and destination are the same account." };
  const tx = await insertTransaction(ctx, {
    user_id: ctx.userId, type: "transfer", amount: r.amount, currency: r.currency ?? "PKR",
    source_account_id: from.account.id, destination_account_id: to.account.id, description: r.description, status: "active", ...when(ctx, r),
  });
  const m: Record<Lang, string> = {
    en: "Recorded: moved " + rs(r.amount ?? 0) + " from " + from.account.name + " to " + to.account.name + ". Not counted as income or expense.",
    roman_ur: "Record ho gaya: " + rs(r.amount ?? 0) + " " + from.account.name + " se " + to.account.name + " mein gaye. Ye income ya kharcha nahi hai.",
    ur: "درج ہو گیا: " + rs(r.amount ?? 0) + " " + from.account.name + " سے " + to.account.name + " میں منتقل ہوئے۔",
  };
  return { ok: true, kind: "transfer", transaction_id: tx.id, message: m[lang(r)] };
}

// ---------- finding the entry to correct or delete ----------
type Row = { id: string; type: string; amount: number | string; description: string | null; transaction_date: string; account_id: string | null; person_id: string | null };

async function findTarget(ctx: Ctx, r: Interpretation): Promise<{ row: Row } | { ask: string }> {
  const params = new URLSearchParams({
    select: "id,type,amount,description,transaction_date,account_id,person_id",
    user_id: "eq." + ctx.userId, status: "eq.active", transaction_date: "gte." + ymdAdd(ctx.today, -60),
    order: "created_at.desc", limit: "100",
  });
  const response = await ctx.db("/rest/v1/transactions?" + params.toString());
  if (!response.ok) throw new Error("Unable to read recent entries.");
  const rows = await response.json() as Row[];
  const text = (r.target_text ?? "").toLowerCase().trim();
  const wantAmount = r.target_amount ?? null;
  const matches = rows.filter((row) =>
    (!text || (row.description ?? "").toLowerCase().includes(text)) &&
    (wantAmount === null || Number(row.amount) === wantAmount));
  if (matches.length === 0) {
    const what = [text, wantAmount !== null ? rs(wantAmount) : ""].filter(Boolean).join(" ");
    return { ask: what ? "I couldn't find a recent entry matching \"" + what + "\". Which entry did you mean?" : "I don't see any recent entries." };
  }
  return { row: matches[0] };
}

function describe(row: Row) {
  return (row.description ?? row.type) + " " + rs(Number(row.amount)) + " (" + row.transaction_date + ")";
}

function friendlyDbError(message: string) {
  if (/active settlements exist/i.test(message)) return "This loan already has repayments recorded. Delete those repayments first.";
  if (/below the already-settled/i.test(message)) return "That amount is lower than what has already been repaid on this loan.";
  if (/settlement of .* exceeds/i.test(message)) return "That would be more than what is outstanding on this loan.";
  return null;
}

async function applyUpdate(ctx: Ctx, id: string, changes: Record<string, unknown>) {
  const reason = ("User request: " + ctx.rawText).slice(0, 500).padEnd(3, " ");
  const response = await ctx.db("/rest/v1/rpc/update_transaction", { method: "POST", body: JSON.stringify({ p_transaction_id: id, p_changes: changes, p_reason: reason }) });
  if (!response.ok) {
    const message = await dbMessage(response);
    const friendly = friendlyDbError(message);
    if (friendly) return { ask: friendly };
    throw new Error(message);
  }
  return { ok: true as const };
}

async function applyCorrection(ctx: Ctx, r: Interpretation): Promise<LedgerOutcome> {
  const target = await findTarget(ctx, r);
  if ("ask" in target) return { ok: false, ask: target.ask };
  const row = target.row;
  const changes: Record<string, unknown> = {};
  if (r.amount !== null && r.amount !== Number(row.amount)) changes.amount = r.amount;
  if (r.account) {
    if (row.type === "salary_deduction") return { ok: false, ask: "A salary deduction has no payment account." };
    const acct = await ensureAccount(ctx, r.account);
    if ("ask" in acct) return { ok: false, ask: acct.ask };
    if (acct.account.id !== row.account_id) changes.account_id = acct.account.id;
  }
  if (Object.keys(changes).length === 0) return { ok: false, ask: "That entry already has those values: " + describe(row) + ". What should change?" };
  const done = await applyUpdate(ctx, row.id, changes);
  if ("ask" in done) return { ok: false, ask: done.ask };
  const before = describe(row);
  const newAmount = typeof changes.amount === "number" ? changes.amount : Number(row.amount);
  const m: Record<Lang, string> = {
    en: "Corrected: " + before + " is now " + rs(newAmount) + (changes.account_id ? " with the new account" : "") + ".",
    roman_ur: "Theek kar diya: " + before + " ab " + rs(newAmount) + " hai" + (changes.account_id ? " (naya account)" : "") + ".",
    ur: "درست کر دیا: " + before + " اب " + rs(newAmount) + " ہے۔",
  };
  return { ok: true, kind: "correction", transaction_id: row.id, message: m[lang(r)], details: { before, changes } };
}

async function applyVoid(ctx: Ctx, r: Interpretation): Promise<LedgerOutcome> {
  const target = await findTarget(ctx, r);
  if ("ask" in target) return { ok: false, ask: target.ask };
  const done = await applyUpdate(ctx, target.row.id, { status: "voided" });
  if ("ask" in done) return { ok: false, ask: done.ask };
  const d = describe(target.row);
  const m: Record<Lang, string> = {
    en: "Deleted: " + d + ". It stays in your history log.",
    roman_ur: "Delete kar diya: " + d + ". History mein record rahega.",
    ur: "حذف کر دیا: " + d + "۔",
  };
  return { ok: true, kind: "void", transaction_id: target.row.id, message: m[lang(r)], details: { voided: d } };
}

// ---------- questions ----------
async function totals(ctx: Ctx, from: string, to: string) {
  const response = await ctx.db("/rest/v1/rpc/z30_period_totals", { method: "POST", body: JSON.stringify({ p_from: from, p_to: to }) });
  if (!response.ok) throw new Error("Unable to load totals.");
  const t = await response.json() as { income: number | string; expenses: number | string; salary_deductions: number | string; expense_count: number };
  return { income: Number(t.income), expenses: Number(t.expenses), salary_deductions: Number(t.salary_deductions), count: Number(t.expense_count) };
}

async function balances(ctx: Ctx, r: Interpretation) {
  const response = await ctx.db("/rest/v1/person_balances?select=person_id,they_owe_me,i_owe_them&user_id=eq." + ctx.userId);
  if (!response.ok) throw new Error("Unable to load balances.");
  const rows = await response.json() as Array<{ person_id: string; they_owe_me: number | string; i_owe_them: number | string }>;
  const peopleResponse = await ctx.db("/rest/v1/people?select=id,name&user_id=eq." + ctx.userId + "&limit=500");
  const people = peopleResponse.ok ? await peopleResponse.json() as Array<{ id: string; name: string }> : [];
  const names = new Map(people.map((p) => [p.id, p.name]));
  const wanted = r.person ? cleanName(r.person).toLowerCase() : null;
  return rows
    .map((row) => ({ name: names.get(row.person_id) ?? "?", owedToMe: Number(row.they_owe_me), iOwe: Number(row.i_owe_them) }))
    .filter((row) => !wanted || row.name.toLowerCase() === wanted);
}

async function answerQuery(ctx: Ctx, r: Interpretation): Promise<LedgerOutcome> {
  const L = lang(r);
  const range = periodRange(ctx.today, r.period ?? null);
  const label = periodLabel[range.key][L];
  switch (r.query_type) {
    case "spent": {
      const t = await totals(ctx, range.from, range.to);
      const m: Record<Lang, string> = {
        en: label + ": you spent " + rs(t.expenses) + " across " + t.count + " entries.",
        roman_ur: label + " aap ne " + rs(t.expenses) + " kharch kiye (" + t.count + " entries).",
        ur: label + " آپ نے " + rs(t.expenses) + " خرچ کیے (" + t.count + " اندراجات)۔",
      };
      return { ok: true, kind: "query", transaction_id: null, message: m[L], details: t };
    }
    case "income": {
      const t = await totals(ctx, range.from, range.to);
      const m: Record<Lang, string> = {
        en: label + ": you received " + rs(t.income) + ".",
        roman_ur: label + " aap ko " + rs(t.income) + " mile.",
        ur: label + " آپ کو " + rs(t.income) + " ملے۔",
      };
      return { ok: true, kind: "query", transaction_id: null, message: m[L], details: t };
    }
    case "remaining": {
      const t = await totals(ctx, range.from, range.to);
      const left = t.income - t.salary_deductions - t.expenses;
      const m: Record<Lang, string> = {
        en: label + ": recorded income " + rs(t.income) + ", minus salary deductions " + rs(t.salary_deductions) + " and spending " + rs(t.expenses) + " leaves " + rs(left) + ".",
        roman_ur: label + ": income " + rs(t.income) + ", salary cut " + rs(t.salary_deductions) + " aur kharcha " + rs(t.expenses) + " ke baad " + rs(left) + " bachte hain.",
        ur: label + ": آمدنی " + rs(t.income) + "، تنخواہ کٹوتی " + rs(t.salary_deductions) + " اور خرچ " + rs(t.expenses) + " کے بعد " + rs(left) + " بچتے ہیں۔",
      };
      return { ok: true, kind: "query", transaction_id: null, message: m[L], details: { ...t, left } };
    }
    case "owed_to_me":
    case "i_owe": {
      const rows = await balances(ctx, r);
      const mine = r.query_type === "owed_to_me";
      const list = rows.map((row) => ({ name: row.name, amount: mine ? row.owedToMe : row.iOwe })).filter((row) => row.amount > 0);
      const total = list.reduce((sum, row) => sum + row.amount, 0);
      if (list.length === 0) {
        const m: Record<Lang, string> = mine
          ? { en: "Nobody owes you anything right now.", roman_ur: "Abhi kisi ne aap ke paise nahi dene.", ur: "ابھی کسی نے آپ کے پیسے نہیں دینے۔" }
          : { en: "You don't owe anyone anything right now.", roman_ur: "Abhi aap ne kisi ke paise nahi dene.", ur: "ابھی آپ نے کسی کے پیسے نہیں دینے۔" };
        return { ok: true, kind: "query", transaction_id: null, message: m[L] };
      }
      const detail = list.map((row) => row.name + " " + rs(row.amount)).join(", ");
      const m: Record<Lang, string> = mine
        ? { en: "Owed to you: " + rs(total) + " (" + detail + ").", roman_ur: "Aap ko lene hain: " + rs(total) + " (" + detail + ").", ur: "آپ کو لینے ہیں: " + rs(total) + " (" + detail + ")۔" }
        : { en: "You owe: " + rs(total) + " (" + detail + ").", roman_ur: "Aap ne dene hain: " + rs(total) + " (" + detail + ").", ur: "آپ نے دینے ہیں: " + rs(total) + " (" + detail + ")۔" };
      return { ok: true, kind: "query", transaction_id: null, message: m[L], details: { total, list } };
    }
    case "last_entries": {
      const params = new URLSearchParams({ select: "type,amount,description,transaction_date", user_id: "eq." + ctx.userId, status: "eq.active", order: "created_at.desc", limit: "5" });
      const response = await ctx.db("/rest/v1/transactions?" + params.toString());
      if (!response.ok) throw new Error("Unable to read recent entries.");
      const rows = await response.json() as Array<{ type: string; amount: number | string; description: string | null; transaction_date: string }>;
      const text = rows.length ? rows.map((row) => (row.description ?? row.type) + " " + rs(Number(row.amount)) + " (" + row.transaction_date + ")").join("; ") : "No entries yet.";
      return { ok: true, kind: "query", transaction_id: null, message: text, details: { rows } };
    }
    default:
      return { ok: false, ask: "What would you like to know about your money?" };
  }
}

export async function handleLedgerIntent(ctx: Ctx, r: Interpretation): Promise<LedgerOutcome> {
  switch (r.intent) {
    case "lent": return recordLoan(ctx, r, "lent");
    case "borrowed": return recordLoan(ctx, r, "borrowed");
    case "settlement": return recordSettlement(ctx, r);
    case "transfer": return recordTransfer(ctx, r);
    case "correction": return applyCorrection(ctx, r);
    case "void": return applyVoid(ctx, r);
    case "query": return answerQuery(ctx, r);
    default: return { ok: false, ask: "I can't record that type yet." };
  }
}
