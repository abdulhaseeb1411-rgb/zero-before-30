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
  date_offset: number | null;
  salary_deduction: boolean;
  confidence: number;
  needs_clarification: boolean;
  clarification_reason: string | null;
};

const accountAliases: Array<{ pattern: RegExp; account: string }> = [
  { pattern: /\b(?:alfalah|bank alfalah)(?:\s+bank)?\s*(?:cc|credit\s*card|card)\b/i, account: "Bank Alfalah Credit Card" },
  { pattern: /\b(?:hbl|habib bank)\s*(?:cc|credit\s*card|card)\b/i, account: "HBL Credit Card" },
  { pattern: /\b(?:meezan)\s*(?:cc|credit\s*card|card)?\b/i, account: "Meezan" },
  { pattern: /\b(?:ubl|united bank)\s*(?:cc|credit\s*card|card)\b/i, account: "UBL Credit Card" },
  { pattern: /\b(?:js|js bank)\s*(?:cc|credit\s*card|card)\b/i, account: "JS Bank Credit Card" },
  { pattern: /\b(?:cc|credit\s*card|card)\s+(?:se|say|pe|pay|par|on|from)\b/i, account: "Credit Card" },
  { pattern: /\b(?:cash|cash account)\b/i, account: "Cash" },
];

function isSalaryDeduction(text: string) {
  return /\b(?:cut|deducted|deduct|minus)\s+(?:from\s+)?salary\b/i.test(text)
    || /\bsalary\s+(?:se|say)\b.{0,80}\b(?:cut|deduct(?:ed)?|minus)\b/i.test(text);
}

function isSimpleSalaryIncome(text: string) {
  return /\bsalary\b.*\b\d+(?:\.\d+)?\b.*\b(?:received|receive|mili|mila|mile|ayi|aayi|aaye|credited|credit|got|mili hai|mila hai)\b/i.test(text)
    || /\bsalary\s+\d+(?:\.\d+)?\s*(?:received|receive|mili|mila|ayi|aayi|aaye|credited|credit|got)?\s*$/i.test(text);
}

function isAccountTransfer(text: string) {
  return /\b(?:transfer|transferred)\b/i.test(text)
    || /\b(?:cash|bank|account)\b.*\b(?:mein|main|to)\b.*\b(?:transfer|move|shift)\b/i.test(text);
}

function hasComplexFinancialMeaning(text: string) {
  return [
    /\b(?:withdraw|withdrawal|cash\s+nikal|nikal(?:a|e|i)?)\b.*\b(?:bank|account)\b/i,
    /\b(?:bank|account)\b.*\b(?:cash\s+nikal|nikal(?:a|e|i)?)\b/i,
    /\b(?:borrow(?:ed)?|udhaar|qarz|loan)\b/i,
    /\b(?:wapas\s+(?:mile|milay|mila|mil|kar|kiya)|returned|return\s+mil|refund)\b/i,
    /\b(?:lend|lent|receivable|dena\s+hai|dena\s+hain)\b/i,
    /\b(?:pehle|previously|already)\s+(?:diye|pay|paid)\b/i,
    /\b(?:split|baqi|remaining|aur\s+baqi)\b/i,
    /\b(?:mujhe|usko|unko|ali|amjad|hanif|cousin|friend|wife|biwi|ammi|bhai|sister)\b.*\b(?:wapas|return|deni\s+hai|dena\s+hai|denge|dega|degi|milna\s+hai)\b/i,
    /\b(?:mujhe|usko|unko|ali|amjad|hanif|cousin|friend|wife|biwi|ammi|bhai|sister)\b.*\b(?:baad\s+mein|later)\b.*\b(?:dena|deni|wapas|return)\b/i,
    /\b(?:usne|unhon(?:e|ny)|woh)\b.*\b(?:mere\s+paise|paise)\b.*\b(?:baad\s+mein|later)\b.*\b(?:dena|deni|dene|denge|dega|degi)\b/i,
    /\b(?:mile|mila|milay)\b.*\b(?:wapas\s+kar(?:na|ni)|return\s+kar(?:na|ni)|dena\s+hai|deni\s+hai)\b/i,
  ].some((pattern) => pattern.test(text));
}

function resolveAccount(text: string) {
  const namedAccount = accountAliases
    .filter(({ account }) => account !== "Cash" && account !== "Credit Card")
    .find(({ pattern }) => pattern.test(text));
  if (namedAccount) return namedAccount.account;

  const hasNegatedCash =
    /\bcash\b[^.!?]{0,40}\b(?:nahi|nahin|na)\s+(?:tha|thi|the|hai|hota|hoti|ho|thay)\b/i.test(text) ||
    /\b(?:nahi|nahin|na)\s+(?:tha|thi|the|hai|hota|hoti|ho|thay)\b[^.!?]{0,20}\bcash\b/i.test(text);

  if (!hasNegatedCash && /\bcash\b/i.test(text)) return "Cash";

  return accountAliases.find(({ pattern, account }) => account === "Credit Card" && pattern.test(text))?.account ?? null;
}

function parseDateOffset(text: string): number {
  if (/\b(?:yesterday|kal)\b/i.test(text) && /\b(?:paid|bought|liya|liye|diya|diye|kiya|pay|expense|grocery|dinner|lunch|petrol|chicken|medicine|bill|kharcha|li|liye)\b/i.test(text)) return -1;
  if (/\b(?:tomorrow|kal)\b/i.test(text) && /\b(?:will|karunga|karoon|doonga|dunga)\b/i.test(text)) return 1;
  return 0;
}

function parseTime(text: string): string | null {
  const daypart = text.match(/\b(raat|night|shaam|evening|dopahar|afternoon|subah|morning)\s+(?:ko\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|baje)?\b/i);
  if (daypart) {
    const part = daypart[1].toLowerCase();
    const hour = Number(daypart[2]);
    const minute = daypart[3] ? Number(daypart[3]) : 0;
    const suffix = daypart[4]?.toLowerCase() ?? "";
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || minute > 59) return null;
    let normalizedHour = hour;
    if (suffix === "pm" && hour < 12) normalizedHour += 12;
    if (suffix === "am" && hour === 12) normalizedHour = 0;
    if (!suffix) {
      if ((part === "raat" || part === "night" || part === "shaam" || part === "evening") && hour < 12) normalizedHour += 12;
      if ((part === "subah" || part === "morning") && hour === 12) normalizedHour = 0;
    }
    return String(normalizedHour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
  }

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
  const minute = match[2] && /^\d{2}$/.test(match[2]) ? Number(match[2]) : 0;
  const ampm = match[3]?.toLowerCase() ?? null;
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute > 59) return null;

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
  const after = text.slice(index + token.length, index + token.length + 15);
  if (/^\s*(?:hazar|hazaar|thousand|k)\b/i.test(after)) return Number(token) * 1000;
  if (/^\s*(?:lakh|lac|lacs)\b/i.test(after)) return Number(token) * 100000;
  return Number(token);
}

function cleanDescription(text: string, account: string | null) {
  let description = text
    .replace(/^\s*(?:spent|paid|bought|purchase|expense)\s+/i, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:hazar|hazaar|thousand|k|lakh|lac|lacs)\s*(?:ki|ka|ke)?\b/gi, " ")
    .replace(/\b(?:today|aaj|yesterday|kal)\b/gi, " ")
    .replace(/\b(?:on|at)\s+\d{1,2}(?::\d{2}|\d{2})?\s*(?:am|pm)?\b/gi, " ")
    .replace(/\b(?:raat|night|shaam|evening|dopahar|afternoon|subah|morning)\s*(?:ko)?\s+\d{1,2}(?::\d{2})?\s*(?:am|pm|baje)?\b/gi, " ")
    .replace(/\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/gi, " ")
    .replace(/\b\d{1,2}\s*(?:am|pm|baje)\b/gi, " ")
    .replace(/\b(?:cut|deducted|deduct|minus)\s+(?:from\s+)?salary\b/gi, " ")
    .replace(/\bsalary\s+(?:se|say)\s+(?:cut|deduct(?:ed)?)\b/gi, " ")
    .replace(/\b\d+(?:\.\d+)?\b/g, " ")
    .replace(/\b(?:hazar|hazaar|thousand|k|lakh|lac|lacs)\b/gi, " ");

  for (const alias of accountAliases) description = description.replace(alias.pattern, " ");
  description = description
    .replace(/\bcash\s+(?:nahi|nahin|na)\s+(?:tha|thi|the|hai|hota|hoti|ho)\s*(?:isliye|therefore)?\b/gi, " ")
    .replace(/\b(?:cash|cash\s+mein|cash\s+se)\b/gi, " ")
    .replace(/\b(?:card|cc|credit\s*card)\s+(?:se|say|pe|pay|par|on|from)\b/gi, " ")
    .replace(/\b(?:isliye|therefore)\b/gi, " ")
    .replace(/\s+(?:mein|main|pe|par|se|say|on)\s*$/i, " ")
    .replace(/\b(?:diye|diya|liya|liye|pay|paid|kiya|hua|hue)\b\s*$/i, " ")
    .replace(/\b(?:ki|ka|ke|wali|wale|waala|waali)\b\s*$/i, " ");

  return description
    .replace(/^\s*(?:ki|ka|ke|wali|wale|waala|waali|pe|par|se|mein|main)\b/gi, " ")
    .replace(/\b(?:se|say|pe|par|on|mein|main)\s+(?:pay|paid|kiya|diya|diye|liya|liye|li)\b/gi, " ")
    .replace(/\b(?:pay|paid|kiya|diya|diye|liya|liye|li)\b\s*$/gi, " ")
    .replace(/\b(?:nahi|nahin|na)\s+(?:tha|thi|the|hai|hota|hoti|ho)\b/gi, " ")
    .replace(/\b(?:ki|ka|ke|wali|wale|waala|waali)\b(?=\s+(?:medicine|grocery|groceries|bill|mobile|dinner|lunch|petrol|chicken|chai|snacks))\b/gi, " ")
    .replace(/^\s*[-,:]+\s*|\s*[-,:]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clarification(reason: string): Interpretation {
  return {
    intent: "ambiguous",
    amount: null,
    currency: null,
    description: null,
    account: null,
    transaction_time: null,
    date_offset: null,
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
      date_offset: 0,
      salary_deduction: false,
      confidence: 0.99,
      needs_clarification: false,
      clarification_reason: null,
    };
  }

  const numericAmounts = [...text.matchAll(/\b\d+(?:\.\d+)?\b/g)];
  if (/\bsalary\b/i.test(text) && numericAmounts.length > 1 && /\b(?:cut|deduct(?:ed)?|minus)\b/i.test(text)) {
    return clarification("I found salary income and one or more deductions in the same message. I need to record these separately so your financial story stays correct.");
  }

  if (isSimpleSalaryIncome(text) && !isSalaryDeduction(text)) {
    const amountMatch = numericAmounts[0];
    if (amountMatch) {
      return {
        intent: "income",
        amount: Number(amountMatch[0]),
        currency: "PKR",
        description: "Salary",
        account: null,
        transaction_time: null,
        date_offset: parseDateOffset(text),
        salary_deduction: false,
        confidence: 0.98,
        needs_clarification: false,
        clarification_reason: null,
      };
    }
  }

  if (isAccountTransfer(text)) {
    return clarification("This sounds like money moving between your own accounts, not an expense. I need the source and destination accounts before recording it.");
  }

  if (hasComplexFinancialMeaning(text)) {
    if (/\b(?:wapas\s+(?:mile|milay|mila|mil|kar|kiya)|returned|return\s+mil|refund)\b/i.test(text)) {
      return clarification("This sounds like money being returned from an earlier payment or loan. I need to know what the original transaction was before I record the return.");
    }
    if (/\b(?:withdraw|withdrawal|cash\s+nikal|nikal(?:a|e|i)?)\b.*\b(?:bank|account)\b/i.test(text)) {
      return clarification("This sounds like a bank-to-cash transfer, not an expense. I need the source account and destination account before recording it.");
    }
    if (/\b(?:borrow(?:ed)?|udhaar|qarz|loan)\b/i.test(text) || /\b(?:cousin|hanif|friend|bhai|ammi|wife|biwi|person)\b.*\b(?:mila|mile|milay)\b.*\b(?:wapas|return)\b/i.test(text)) {
      return clarification("This sounds like borrowed money, not ordinary income. I need to know who the money came from before recording it.");
    }
    if (/\b(?:lend|lent|receivable|dena\s+hai|dena\s+hain)\b/i.test(text) || /\b(?:usko|unko|amjad|ali|anees|wife|biwi|friend|bhai)\b.*\b(?:wapas|return|baad\s+mein)\b.*\b(?:dena|deni|dene|denge|dega|degi)\b/i.test(text) || /\busne\b.*\b(?:mere\s+paise|paise)\b.*\b(?:baad\s+mein|later)\b.*\b(?:dena|deni|dene|denge|dega|degi)\b/i.test(text)) {
      return clarification("This sounds like money you lent or expect back. I need to know the person and whether this is a new loan or a repayment.");
    }
    return clarification("I found multiple money events or unclear financial meaning. I need to clarify the transaction before recording it.");
  }

  const ranges = timeRanges(text);
  const amountCandidates = numericAmounts
    .filter((match) => {
      const index = match.index ?? 0;
      return !ranges.some(([start, end]) => index >= start && index < end);
    });

  if (amountCandidates.length > 1) {
    return clarification("I found more than one amount. I need to know whether this is one transaction or multiple transactions.");
  }

  const amountMatch = amountCandidates[0] ?? null;
  const amount = amountMatch ? numberFromToken(text, amountMatch.index ?? 0, amountMatch[0]) : null;

  const account = resolveAccount(text);
  const transaction_time = parseTime(text);
  const date_offset = parseDateOffset(text);
  const salary_deduction = isSalaryDeduction(text);

  if (!amount) return clarification("I need a valid amount.");

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
      date_offset,
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
    date_offset,
    salary_deduction: false,
    confidence: Math.min(0.97, 0.82 + (account ? 0.08 : 0) + (transaction_time ? 0.05 : 0) + (date_offset !== 0 ? 0.02 : 0)),
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
