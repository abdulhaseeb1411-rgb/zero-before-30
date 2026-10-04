export type Intent =
  | "expense"
  | "salary_deduction"
  | "income"
  | "lent"
  | "borrowed"
  | "transfer"
  | "correction"
  | "void"
  | "query"
  | "ambiguous";

export type Interpretation = {
  intent: Intent;
  amount: number | null;
  currency: string | null;
  description: string | null;
  account: string | null;
  transaction_time: string | null;
  salary_deduction: boolean;
  confidence: number;
  needs_clarification: boolean;
  clarification_reason: string | null;
};

const accountAliases: Array<{ pattern: RegExp; account: string }> = [
  { pattern: /\b(?:cash|cash account)\b/i, account: "Cash" },
  { pattern: /\b(?:alfalah|bank alfalah)\s*(?:cc|credit\s*card|card)\b/i, account: "Bank Alfalah Credit Card" },
  { pattern: /\b(?:hbl|habib bank)\s*(?:cc|credit\s*card|card)\b/i, account: "HBL Credit Card" },
  { pattern: /\b(?:meezan)\s*(?:cc|credit\s*card|card)?\b/i, account: "Meezan" },
  { pattern: /\b(?:ubl|united bank)\s*(?:cc|credit\s*card|card)\b/i, account: "UBL Credit Card" },
  { pattern: /\b(?:js|js bank)\s*(?:cc|credit\s*card|card)\b/i, account: "JS Bank Credit Card" },
];

function isSalaryDeduction(text: string) {
  return /\b(?:cut|deducted|deduct|minus)\s+(?:from\s+)?salary\b|\bsalary\s+(?:se|say)\s+(?:cut|deduct(?:ed)?)\b/i.test(text);
}

function resolveAccount(text: string) {
  return accountAliases.find(({ pattern }) => pattern.test(text))?.account ?? null;
}

function parseTime(text: string): string | null {
  const match =
    text.match(/\b(?:on|at)\s+(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?\b/i) ??
    text.match(/\b(\d{1,2})(?::(\d{2}))\s*(?:am|pm)?\b/i) ??
    text.match(/\b(\d{1,2})\s*(am|pm|baje)\b/i);

  if (!match) return null;

  const hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = (match[3] ?? match[2] ?? "").toLowerCase();
  const suffix = match[0].toLowerCase();
  const isAmPm = /\b(?:am|pm)\b/i.test(suffix);

  if (minute > 59) return null;

  let normalizedHour = hour;
  if (isAmPm) {
    const ampm = suffix.match(/\b(am|pm)\b/i)?.[1].toLowerCase();
    if (hour < 1 || hour > 12 || !ampm) return null;
    if (ampm === "pm" && hour !== 12) normalizedHour += 12;
    if (ampm === "am" && hour === 12) normalizedHour = 0;
  } else if (hour > 23) {
    return null;
  }

  return String(normalizedHour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
}

function timeRanges(text: string) {
  const ranges: Array<[number, number]> = [];
  const patterns = [
    /\b(?:on|at)\s+\d{1,2}(?::?\d{2})?\s*(?:am|pm)?\b/gi,
    /\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/gi,
    /\b\d{1,2}\s*(?:am|pm|baje)\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      ranges.push([start, start + match[0].length]);
    }
  }
  return ranges;
}

function cleanDescription(text: string, account: string | null) {
  let description = text
    .replace(/^\s*(?:spent|paid|bought|purchase|expense)\s+/i, "")
    .replace(/\b\d+(?:\.\d+)?\b/g, " ")
    .replace(/\b(?:on|at)\s+(?:\d{1,2})(?::?\d{2})?\s*(?:am|pm)?\b/gi, " ")
    .replace(/\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/gi, " ")
    .replace(/\b\d{1,2}\s*(?:am|pm|baje)\b/gi, " ")
    .replace(/\b(?:cut|deducted|deduct|minus)\s+(?:from\s+)?salary\b/gi, " ")
    .replace(/\bsalary\s+(?:se|say)\s+(?:cut|deduct(?:ed)?)\b/gi, " ")
    .trim();

  for (const alias of accountAliases) {
    description = description.replace(alias.pattern, " ");
  }

  if (account) {
    description = description.replace(/\s+/g, " ").trim();
  }

  return description.replace(/^[-,:]+|[-,:]+$/g, "").replace(/\s+/g, " ").trim();
}

export function interpretTransaction(input: string): Interpretation {
  const text = input.trim();

  const salary = text.match(/^salary\s+(\d+(?:\.\d+)?)$/i);
  if (salary) {
    return {
      intent: "income",
      amount: Number(salary[1]),
      currency: "PKR",
      description: "Salary",
      account: null,
      transaction_time: null,
      salary_deduction: false,
      confidence: 0.99,
      needs_clarification: false,
      clarification_reason: null,
    };
  }

  const ranges = timeRanges(text);
  const amountCandidates = [...text.matchAll(/\b\d+(?:\.\d+)?\b/g)]
    .filter((match) => {
      const value = match[0];
      const index = match.index ?? 0;
      const isTimeNumber = ranges.some(([start, end]) => index >= start && index < end);
      return !isTimeNumber && Number(value) > 0;
    });

  const amountMatch = amountCandidates.length ? amountCandidates[0] : null;
  if (amountMatch) {
    const amount = Number(amountMatch[0]);
    const account = resolveAccount(text);
    const transaction_time = parseTime(text);
    const salary_deduction = isSalaryDeduction(text);
    const description = cleanDescription(text, account);

    if (description) {
      return {
        intent: salary_deduction ? "salary_deduction" : "expense",
        amount,
        currency: "PKR",
        description,
        account: salary_deduction ? null : account,
        transaction_time,
        salary_deduction,
        confidence: salary_deduction || account ? 0.99 : 0.92,
        needs_clarification: !account && !salary_deduction,
        clarification_reason: account || salary_deduction ? null : "How did you pay?",
      };
    }
  }

  return {
    intent: "ambiguous",
    amount: null,
    currency: null,
    description: null,
    account: null,
    transaction_time: null,
    salary_deduction: false,
    confidence: 0,
    needs_clarification: true,
    clarification_reason: "I need a little more detail to record this.",
  };
}

export function validateInterpretation(result: Interpretation) {
  if (result.intent === "expense" && !result.account && !result.salary_deduction) {
    return { valid: false, reason: "How did you pay?" };
  }

  if (!result.amount || result.amount <= 0) {
    return { valid: false, reason: "I need a valid amount." };
  }

  return { valid: true, reason: null };
}
