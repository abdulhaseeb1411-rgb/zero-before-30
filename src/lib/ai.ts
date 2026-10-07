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
] as const;

const INTENTS: Intent[] = ["expense", "income", "salary_deduction", "lent", "borrowed", "transfer", "settlement", "correction", "void", "query", "ambiguous"];

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "amount", "currency", "description", "account", "person", "payment_text", "transaction_time", "date", "confidence", "needs_clarification", "clarification_reason"],
  properties: {
    intent: { type: "string", enum: INTENTS },
    amount: { type: ["number", "null"] },
    currency: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    account: { type: ["string", "null"], enum: [...KNOWN_ACCOUNTS, null] },
    person: { type: ["string", "null"] },
    payment_text: { type: ["string", "null"] },
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
    "- income: money received as earnings or a gift (salary received, gift, bonus). Not a loan.",
    "- salary_deduction: amount cut from salary before it reached the user (tax, loan cut, bijli cut from salary). account must be null.",
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
    "- A bare name plus a number (for example 'Amjad 4800') is ambiguous: do not pick expense, income, lent or borrowed.",
    "- payment_text: the payment method exactly as the user wrote it (for example 'cash', 'alfalah cc', 'jazzcash'), or null if none was stated.",
    "- If NO payment method is stated, set account null and payment_text null and do NOT ask about it: the software applies the user's default or asks. Do NOT assume Cash. If a payment method IS stated but is not in the allowed account list (for example JazzCash, Easypaisa), set account null but keep payment_text.",
    "- Explicit facts override defaults: if the user states cash, a card, a bank, a date, or a person, use exactly that.",
    "- If the message contains more than one separate money event, or conflicting amounts, set needs_clarification true.",
    "- amount: positive number in PKR. k = 1000, hazar/hazaar/thousand = 1000, lakh/lac = 100000. '2.5k' = 2500. Convert Urdu digits. Ignore clock times when picking the amount.",
    "- account must be exactly one of the allowed values, or null. A card with a named bank maps to that bank's card; a card with no bank is 'Credit Card'. 'Meezan' maps to 'Meezan'.",
    "- description: short English noun phrase for what it was (for example 'Petrol', 'Electricity bill'). No amounts, no payment words.",
    "- date: the exact calendar date the money moved, as YYYY-MM-DD, or null if the user said nothing about a date (means today). Resolve aaj/today, kal/yesterday (for past events), parso, '10 september', '5 sept ko', and numeric dates against today's date. Pakistan writes numeric dates day/month/year, so 02/09/26 is 2 September 2026. A day and month with no year means the most recent past occurrence. Never output a future date; if the user means the future, set needs_clarification.",
    "- transaction_time: 24h 'HH:MM' only if the user said a time, else null. Convert raat/shaam/subah/dopahar sensibly.",
    "- confidence: 0 to 1, how sure you are of the whole interpretation. Use below 0.7 whenever you are unsure.",
    "- For lent/borrowed/settlement/transfer/correction/void/query fill what you can (amount, person, account) and leave the rest null.",
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
  if (!recordable && intent !== "ambiguous" && !needs) {
    needs = true;
    reason = "I understood this as " + intent.replace("_", " ") + ", but I can't record that type yet.";
  }
  if (needs && !reason) reason = "I need a little more detail to record this.";

  return {
    intent,
    amount,
    currency: clean(raw.currency) ?? "PKR",
    description: clean(raw.description),
    account: intent === "salary_deduction" || intent === "income" ? null : account,
    person: clean(raw.person),
    payment_text: paymentText,
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
