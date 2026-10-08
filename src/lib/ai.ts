import type { Interpretation, Intent } from "./transaction";

// AI interprets language. Deterministic code (validateInterpretation + the Worker) decides and writes.
export const AI_MODEL = "gpt-6-luna";

export const KNOWN_ACCOUNTS = [
  "Cash",
  "Bank Alfalah Credit Card",
  "HBL Credit Card",
  "UBL Credit Card",
  "JS Bank Credit Card",
  "Meezan",
  "Credit Card",
  "HBL",
  "Bank Alfalah",
  "UBL",
  "JS Bank",
] as const;

const INTENTS: Intent[] = ["expense", "income", "salary_deduction", "lent", "borrowed", "transfer", "settlement", "correction", "void", "query", "ambiguous"];

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "amount", "currency", "description", "account", "person", "payment_text", "to_account", "direction", "target_text", "target_amount", "query_type", "period", "reply_language", "transaction_time", "date", "confidence", "needs_clarification", "clarification_reason"],
  properties: {
    intent: { type: "string", enum: INTENTS },
    amount: { type: ["number", "null"] },
    currency: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    account: { type: ["string", "null"], enum: [...KNOWN_ACCOUNTS, null] },
    person: { type: ["string", "null"] },
    payment_text: { type: ["string", "null"] },
    to_account: { type: ["string", "null"], enum: [...KNOWN_ACCOUNTS, null] },
    direction: { type: ["string", "null"], enum: ["they_paid_me", "i_paid_them", null] },
    target_text: { type: ["string", "null"] },
    target_amount: { type: ["number", "null"] },
    query_type: { type: ["string", "null"], enum: ["spent", "income", "remaining", "owed_to_me", "i_owe", "last_entries", null] },
    period: { type: ["string", "null"], enum: ["today", "yesterday", "this_week", "this_month", "last_month", "all", null] },
    reply_language: { type: "string", enum: ["en", "roman_ur", "ur"] },
    transaction_time: { type: ["string", "null"] },
    date: { type: ["string", "null"] },
    confidence: { type: "number" },
    needs_clarification: { type: "boolean" },
    clarification_reason: { type: ["string", "null"] },
  },
} as const;

export function buildSystemPrompt(todayIso: string) {
  return [
    "You are the language interpreter for Z30, a personal money tracker for salaried people in Pakistan.",
    "Input may be English, Roman Urdu, Urdu script, or a mix. Understand it; do not change the user's meaning.",
    "You ONLY return structured data. You never record, calculate balances, or decide anything. Software validates your output.",
    "Today in Pakistan (Asia/Karachi) is " + todayIso + ". Default currency PKR.",
    "",
    "Intents:",
    "- expense: user spent money on something. Needs a payment account (Cash or a named card/bank).",
    "- income: money received as earnings or a gift (salary received, gift, bonus). Not a loan. A message like 'salary 90000', 'salary aayi 90k', or 'تنخواہ 90000' is plainly income: do NOT ask.",
    "- salary_deduction: ONLY when the text says an amount was cut/deducted from the salary (tax cut, loan cut, bijli cut from salary). Plain 'salary X' is income, not a deduction. account must be null.",
    "- lent: user paid or gave money that the other person must return (person required).",
    "- borrowed: user received money they must return (person required).",
    "- settlement: money returned for an earlier lent/borrowed item (person required). Direction is not an expense or income.",
    "- transfer: money moved between the user's own accounts (bank to cash, cash to bank). Not income or expense.",
    "- correction: user fixes an earlier entry (amount, account, description).",
    "- void: user deletes or cancels an earlier entry.",
    "- query: user asks a question about their money. No amount needed.",
    "- ambiguous: financial meaning is genuinely unclear.",
    "",
    "Rules:",
    "- NEVER guess. Missing facts stay null. If meaning or a material fact is unclear, set needs_clarification true with ONE short question in clarification_reason, in the user's language style.",
    "- A refund, return, reversal or cashback of money from an earlier purchase is NOT income and NOT an expense: set intent ambiguous, needs_clarification true, and ask which earlier purchase it relates to.",
    "- A bare name plus a number (for example 'Amjad 4800') is ambiguous: do not pick expense, income, lent or borrowed.",
    "- A purchase, bill or service noun with an amount (for example 'mobile personal 1500', 'wife mobile 1500', 'electricity 2000', 'grocery 13500', 'petrol 450', 'dinner 5315') is an expense. Do NOT ask. A family member or word like 'personal' only says who or what it was for (keep it in the description, for example 'Wife mobile'); it does NOT make it lent. Ask only when another person's money is clearly involved (someone paid for the user, the user paid for someone who must return it, 'he owes me', 'wapas', 'udhaar').",
    "- A shop, bakery, store, restaurant, pharmacy or other merchant name ('apf bakers', 'pac commissory', 'Imtiaz', 'Al-Fatah') is NOT a payment method. Put it in the description (for example 'Sweets - APF Bakers') and leave payment_text and account null so the user's default account applies. payment_text is only for words like cash, card, cc, a bank name, or a wallet (JazzCash, Easypaisa).",
    "- If the user PAID for another named person's bill, medicine or purchase ('Asmatullah ki medicine maine pay ki', 'I paid it for him', 'usko diye'), set needs_clarification true and ask whether it was lent (they will return it) or the user's own expense. Never record it silently as an expense.",
    "- Language: clarification_reason MUST be in the same language style as the user's message. English message -> English question. Roman Urdu message (even short, with words like ko, se, diye, liye, kiya) -> Roman Urdu question. Urdu script -> Urdu script. Ask exactly ONE question, never two.",
    "- payment_text: the payment method exactly as the user wrote it (for example 'cash', 'alfalah cc', 'jazzcash'), or null if none was stated.",
    "- If NO payment method is stated, set account null and payment_text null and do NOT ask about it: the software applies the user's default or asks. Do NOT assume Cash. If a payment method IS stated but is not in the allowed account list (for example JazzCash, Easypaisa), set account null but keep payment_text.",
    "- Explicit facts override defaults: if the user states cash, a card, a bank, a date, or a person, use exactly that.",
    "- If the message contains more than one separate money event, or conflicting amounts, set needs_clarification true.",
    "- amount: positive number in PKR. k = 1000, hazar/hazaar/thousand = 1000, lakh/lac = 100000. '2.5k' = 2500. Convert Urdu digits. Ignore clock times when picking the amount.",
    "- account must be exactly one of the allowed values, or null. A bank name with card/cc/credit card maps to that bank's credit card ('alfalah cc' -> 'Bank Alfalah Credit Card', 'hbl card' -> 'HBL Credit Card'). A bank name with no card word ('hbl se', 'hbl account se', 'alfalah se', 'bank alfalah', 'ubl') means that bank's ordinary bank account: 'HBL', 'Bank Alfalah', 'UBL', 'JS Bank', 'Meezan'. A card with no bank is 'Credit Card'.",
    "- description: short English noun phrase for what it was (for example 'Petrol', 'Electricity bill'). No amounts, no payment words.",
    "- date: the exact calendar date the money moved, as YYYY-MM-DD, or null if the user said nothing about a date (means today). Resolve aaj/today, kal/yesterday (for past events), parso, '10 september', '5 sept ko', and numeric dates against today's date. Pakistan writes numeric dates day/month/year, so 02/09/26 is 2 September 2026. A day and month with no year means the most recent past occurrence. Never output a future date; if the user means the future, set needs_clarification.",
    "- transaction_time: 24h 'HH:MM' only if the user said a time, else null. Convert raat/shaam/subah/dopahar sensibly.",
    "- confidence: 0 to 1, how sure you are of the whole interpretation. Use below 0.7 whenever you are unsure.",
    "- reply_language: the language the user wrote in: en, roman_ur (Urdu in Latin letters, or mixed), or ur (Urdu script). Write clarification_reason in that language.",
    "- settlement: direction is they_paid_me when the other person gave money back to the user ('Ali ne 3000 wapas kiye', 'Ali returned 3000'), and i_paid_them when the user gave money back ('maine Ahmed ko 4000 wapis kiye', 'paid back Hanif'). If it is not clear who paid whom, set direction null and needs_clarification true. person is required.",
    "- lent/borrowed: person is the other party's name exactly as written (keep the user's spelling and script). If only a generic word like 'dost' or 'friend' is given with no name, set person null and ask who. amount is required. A due date is not needed. description is optional (what it was for).",
    "- transfer: account is the source and to_account the destination, both from the allowed list. 'hbl se cash nikale' is a transfer from 'HBL' to 'Cash'. If the user says only 'bank se cash nikala' with no bank named, the source is unknown: set account null and ask which bank. If the user also says part of the cash was spent or given away, ask ONE question about the remainder.",
    "- correction: amount is the NEW correct amount; target_amount is the OLD wrong amount if the user mentioned it; target_text is a short keyword for which entry (for example 'petrol'), or null if the user means the latest entry. Pattern 'X tha, Y nahi' / 'it was X not Y' means the NEW amount is X and the OLD amount is Y. If the user is also changing the payment account, set account to the new one.",
    "- void: target_text and/or target_amount identify the entry to delete ('last petrol entry' gives target_text 'petrol'; 'last entry' gives both null). Do not invent a target.",
    "- query: query_type is spent (expenses), income, remaining (income minus spending), owed_to_me (money others owe the user), i_owe, or last_entries. period is today, yesterday, this_week, this_month, last_month or all; use this_month when a spending question names no period, and all for owed_to_me / i_owe. person is set if the question is about one person. query needs no amount.",
    "- For fields that do not apply to the intent, use null.",
  ].join("\n");
}

export type AiResult = { interpretation: Interpretation; usage: { input_tokens: number; output_tokens: number } | null; model: string };

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v ? v.slice(0, 200) : null;
}

// Deterministic sanity layer between the model and the rest of the system.
export function normalizeAiOutput(raw: Record<string, unknown>, todayYmd: string): Interpretation {
  const intent = INTENTS.includes(raw.intent as Intent) ? (raw.intent as Intent) : "ambiguous";
  const amountRaw = typeof raw.amount === "number" && Number.isFinite(raw.amount) ? raw.amount : null;
  const amount = amountRaw !== null && amountRaw > 0 && amountRaw <= 1_000_000_000 ? Math.round(amountRaw * 100) / 100 : null;
  const account = KNOWN_ACCOUNTS.includes(raw.account as (typeof KNOWN_ACCOUNTS)[number]) ? (raw.account as string) : null;
  const time = typeof raw.transaction_time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw.transaction_time) ? raw.transaction_time : null;
  let offsetRaw: number | null = 0;
  let dateOk = true;
  if (raw.date !== null && raw.date !== undefined) {
    const m = typeof raw.date === "string" ? raw.date.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
    if (!m) dateOk = false;
    else {
      const d = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      const t = todayYmd.split("-").map(Number);
      const diff = Math.round((d - Date.UTC(t[0], t[1] - 1, t[2])) / 86_400_000);
      if (!Number.isFinite(diff) || diff > 0 || diff < -366) dateOk = false;
      else offsetRaw = diff;
    }
  }
  const confidenceRaw = typeof raw.confidence === "number" && Number.isFinite(raw.confidence) ? raw.confidence : 0;
  const confidence = Math.max(0, Math.min(1, confidenceRaw));
  let needs = raw.needs_clarification === true;
  let reason = clean(raw.clarification_reason);

  const recordable = intent === "expense" || intent === "income" || intent === "salary_deduction";
  if (!dateOk) { needs = true; reason = reason ?? "Which date was this? I can only record today or past dates."; }
  if (confidence < 0.7) { needs = true; reason = reason ?? "I'm not sure I understood this. Could you rephrase it?"; }
  if (intent === "ambiguous") { needs = true; reason = reason ?? "I need a little more detail to record this."; }
  if (recordable && amount === null) { needs = true; reason = reason ?? "I need a valid amount."; }
  const paymentText = clean(raw.payment_text);
  if (intent === "expense" && account === null && paymentText) { needs = true; reason = "I don't have a payment method called \"" + paymentText + "\". Which account did you use: Cash or one of your cards?"; }
  if (recordable && !clean(raw.description)) { needs = true; reason = reason ?? "What was this for?"; }
  const person = clean(raw.person);
  const direction = raw.direction === "they_paid_me" || raw.direction === "i_paid_them" ? raw.direction : null;
  const toAccount = KNOWN_ACCOUNTS.includes(raw.to_account as (typeof KNOWN_ACCOUNTS)[number]) ? (raw.to_account as string) : null;
  const targetAmountRaw = typeof raw.target_amount === "number" && Number.isFinite(raw.target_amount) && raw.target_amount > 0 ? raw.target_amount : null;
  const queryType = ["spent", "income", "remaining", "owed_to_me", "i_owe", "last_entries"].includes(raw.query_type as string) ? (raw.query_type as string) : null;
  const period = ["today", "yesterday", "this_week", "this_month", "last_month", "all"].includes(raw.period as string) ? (raw.period as string) : null;
  const replyLanguage = raw.reply_language === "roman_ur" || raw.reply_language === "ur" ? raw.reply_language : "en";

  if (!needs && (intent === "lent" || intent === "borrowed")) {
    if (!person) { needs = true; reason = reason ?? "Who is this with?"; }
    else if (amount === null) { needs = true; reason = reason ?? "I need a valid amount."; }
  }
  if (!needs && intent === "settlement") {
    if (!person) { needs = true; reason = reason ?? "Who is this repayment with?"; }
    else if (amount === null) { needs = true; reason = reason ?? "I need a valid amount."; }
    else if (!direction) { needs = true; reason = reason ?? "Who paid whom: did " + person + " pay you, or did you pay " + person + "?"; }
  }
  if (!needs && intent === "transfer") {
    if (amount === null) { needs = true; reason = reason ?? "I need a valid amount."; }
    else if (!account || !toAccount) { needs = true; reason = reason ?? "Which account did the money move from, and to?"; }
    else if (account === toAccount) { needs = true; reason = "The source and destination are the same account."; }
  }
  if (!needs && intent === "correction" && amount === null && !account) { needs = true; reason = reason ?? "What should the corrected amount be?"; }
  if (!needs && intent === "query" && !queryType) { needs = true; reason = reason ?? "What would you like to know about your money?"; }

  if (needs && !reason) reason = "I need a little more detail to record this.";

  return {
    intent,
    amount,
    currency: clean(raw.currency) ?? "PKR",
    description: clean(raw.description),
    account: intent === "salary_deduction" || intent === "income" ? null : account,
    person,
    payment_text: paymentText,
    to_account: toAccount,
    direction,
    target_text: clean(raw.target_text),
    target_amount: targetAmountRaw,
    query_type: queryType,
    period,
    reply_language: replyLanguage,
    transaction_time: time,
    date_offset: dateOk ? offsetRaw : null,
    salary_deduction: intent === "salary_deduction",
    confidence,
    needs_clarification: needs,
    clarification_reason: needs ? reason : null,
  };
}

export async function interpretWithAi(apiKey: string, input: string, todayIso: string, todayYmd: string, signal?: AbortSignal): Promise<AiResult> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
    body: JSON.stringify({
      model: AI_MODEL,
      reasoning: { effort: "none" },
      max_output_tokens: 400,
      store: false,
      input: [
        { role: "system", content: buildSystemPrompt(todayIso) },
        { role: "user", content: input },
      ],
      text: { format: { type: "json_schema", name: "z30_interpretation", strict: true, schema } },
    }),
  });
  if (!response.ok) throw new Error("AI request failed with status " + response.status);
  const data = await response.json() as {
    status?: string;
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; refusal?: string }> }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  if (data.status && data.status !== "completed") throw new Error("AI response not completed: " + data.status);
  const text = data.output?.flatMap((item) => item.content ?? []).find((part) => part.type === "output_text")?.text;
  if (!text) throw new Error("AI returned no structured output.");
  const parsed = JSON.parse(text) as Record<string, unknown>;
  return {
    interpretation: normalizeAiOutput(parsed, todayYmd),
    usage: data.usage ? { input_tokens: data.usage.input_tokens ?? 0, output_tokens: data.usage.output_tokens ?? 0 } : null,
    model: AI_MODEL,
  };
}
