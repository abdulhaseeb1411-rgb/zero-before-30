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
  { pattern: /\b(?:alfalah|bank alfalah)(?:\s+bank)?\s*(?:cc|credit\s*card|card)\b/i, account: "Bank Alfalah Credit Card" },
  { pattern: /\b(?:hbl|habib bank)\s*(?:cc|credit\s*card|card)\b/i, account: "HBL Credit Card" },
  { pattern: /\b(?:meezan)\s*(?:cc|credit\s*card|card)?\b/i, account: "Meezan" },
  { pattern: /\b(?:ubl|united bank)\s*(?:cc|credit\s*card|card)\b/i, account: "UBL Credit Card" },
  { pattern: /\b(?:js|js bank)\s*(?:cc|credit\s*card|card)\b/i, account: "JS Bank Credit Card" },
];

function isSalaryDeduction(text: string) {
  return /\b(?:cut|deducted|deduct|minus)\s+(?:from\s+)?salary\b|\bsalary\s+(?:se|say)\s+(?:cut|deduct(?:ed)?)\b/i.test(text);
}

function hasComplexFinancialMeaning(text: string) {
  return [
    /\b(?:withdraw|withdrawal|cash\s+nikal|nikal(?:a|e|i)?)\b.*\b(?:bank|account)\b/i,
    /\b(?:borrow(?:ed)?|udhaar|qarz|loan)\b/i,
    /\b(?:wapas\s+(?:mile|milay|mila|mil|kar|kiya)|returned|return\s+mil|refund)\b/i,
    /\b(?:lend|lent|receivable|dena\s+hai|dena\s+hain)\b/i,
    /\b(?:pehle|previously|already)\s+(?:diye|pay|paid)\b/i,
    /\b(?:split|baqi|remaining|aur\s+baqi)\b/i,
  ].some((pattern) => pattern.test(text));
}

function resolveAccount(text: string) {
  return accountAliases.find(({ pattern }) => pattern.test(text))?.account ?? null;
}

function parseTime(text: string): string | null {
  const patterns = [
    /\b(?:on|at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
    /\b(?:on|at)\s+(\d{1,2}):(\d{2})\s*(am|pm)?\b/i,
    /\b(?:on|at)\s+(\d{1,2})(\d{2})\b/i,
    /\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i,
    /\b(\d{1,2})\s*(am|pm|baje)\b/i,
  ];

  let match: RegExpMatchArray | null = null;
  for (const pattern of patterns) {
    match = text.match(pattern);
    if (match) break;
  }
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const suffix = match[0].toLowerCase();
  const ampm = suffix.match(/\b(am|pm)\b/i)?.[1]?.toLowerCase();

  if (minute > 59) return null;

  let normalizedHour = hour;
  if (ampm) {
    if (hour < 1 || hour > 12) return null;
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
    /\b(?:on|at)\s+\d{1,2}(?::\d{2}|\d{2})\s*(?:am|pm)?\b/gi,
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

function numberFromToken(text: string, index: number, token: string) {
  const before = text.slice(Math.max(0, index - 20), index);
  if (/\b(?:hazar|hazaar|thousand|k)\s*$/i.test(before)) return Number(token) * 1000;
  if (/\b(?:lakh|lac|lacs)\s*$/i.test(before)) return Number(token) * 100000;
  return Number(token);
}

function extractAmount(text: string) {
  const ranges = timeRanges(text);
  const candidates = [...text.matchAll(/\b\d+(?:\.\d+)?\b/g)]
    .filter((match) => {
      const index = match.index ?? 0;
      return !ranges.some(([start, end]) => index >= start && index < end);
    })
    .map((match) => ({
      raw: match[0],
      index: match.index ?? 0,
      amount: numberFromToken(text, match.index ?? 0, match[0]),
    }))
    .filter((candidate) => candidate.amount > 0);

  return candidates[0] ?? null;
}

function cleanDescription(text: string, account: string | null) {
  let description = text
    .replace(/^\s*(?:spent|paid|bought|purchase|expense)\s+/i, "")
    .replace(/\b\d+(?:\.\d+)?\b/g, " ")
    .replace(/\b(?:on|at)\s+(?:\d{1,2})(?::\d{2}|\d{2})?\s*(?:am|pm)?\b/gi, " ")
    .replace(/\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/gi, " ")
    .replace(/\b\d{1,2}\s*(?:am|pm|baje)\b/gi, " ")
    .replace(/\b(?:cut|deducted|deduct|minus)\s+(?:from\s+)?salary\b/gi, " ")
    .replace(/\bsalary\s+(?:se|say)\s+(?:cut|deduct(?:ed)?)\b/gi, " ");

  for (const alias of accountAliases) {
    description = description.replace(alias.pattern, " ");
  }

  if (account) description = description.replace(/\s+/g, " ").trim();

  return description.replace(/^[-,:]+|[-,:]+$/g, "").replace(/\s+/g, " ").trim();
}

function clarification(reason: string): Interpretation {
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
    clarification_reason: reason,
  };
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

  if (hasComplexFinancialMeaning(text)) {
    return clarification("This may involve more than one financial event. I need to clarify it before recording.");
  }

  const ranges = timeRanges(text);
  const amountCandidates = [...text.matchAll(/\b\d+(?:\.\d+)?\b/g)]
    .filter((match) => {
      const index = match.index ?? 0;
      return !ranges.some(([start, end]) => index >= start && index < end);
    });

  const amountMatch = amountCandidates.length ? amountCandidates[0] : null;
  const amount = amountMatch
    ? numberFromToken(text, amountMatch.index ?? 0, amountMatch[0])
    : null;

  const account = resolveAccount(text);
  const transaction_time = parseTime(text);
  const salary_deduction = isSalaryDeduction(text);

  if (!amount) return clarification("I need a valid amount.");

  if (amountCandidates.length > 1) {
    return clarification("I found more than one amount. I need to know whether this is one transaction or multiple transactions.");
  }

  const description = cleanDescription(text, account);
  if (!description) return clarification("I need a description of what you paid for.");

  if (salary_deduction) {
    return {
      intent: "salary_deduction",
      amount,
      currency: "PKR",
      description,
      account: null,
      transaction_time,
      salary_deduction: true,
      confidence: 0.99,
      needs_clarification: false,
      clarification_reason: null,
    };
  }

  if (!account) {
    return clarification("How did you pay? For example: cash or Bank Alfalah Credit Card.");
  }

  return {
    intent: "expense",
    amount,
    currency: "PKR",
    description,
    account,
    transaction_time,
    salary_deduction: false,
    confidence: 0.96,
    needs_clarification: false,
    clarification_reason: null,
  };
}

export function validateInterpretation(result: Interpretation) {
  if (result.needs_clarification) return { valid: false, reason: result.clarification_reason ?? "I need a little more detail." };

  if (result.intent === "expense" && !result.account && !result.salary_deduction) {
    return { valid: false, reason: "How did you pay?" };
  }

  if (!result.amount || result.amount <= 0) {
    return { valid: false, reason: "I need a valid amount." };
  }

  return { valid: true, reason: null };
}
