export type Intent =
  | "expense"
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
  confidence: number;
  needs_clarification: boolean;
  clarification_reason: string | null;
};

const expensePattern = /^(?:spent|paid|bought|purchase|expense)?\s*(.+?)\s+(\d+(?:\.\d+)?)\s*(cash)?$/i;

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
      confidence: 0.99,
      needs_clarification: false,
      clarification_reason: null,
    };
  }

  const match = text.match(expensePattern);
  if (match) {
    const [, description, amount, cash] = match;
    return {
      intent: "expense",
      amount: Number(amount),
      currency: "PKR",
      description: description.trim(),
      account: cash ? "Cash" : null,
      confidence: cash ? 0.99 : 0.92,
      needs_clarification: !cash,
      clarification_reason: cash ? null : "How did you pay?",
    };
  }

  return {
    intent: "ambiguous",
    amount: null,
    currency: null,
    description: null,
    account: null,
    confidence: 0,
    needs_clarification: true,
    clarification_reason: "I need a little more detail to record this.",
  };
}

export function validateInterpretation(result: Interpretation) {
  if (result.intent === "expense" && !result.account) {
    return { valid: false, reason: "How did you pay?" };
  }

  if (!result.amount || result.amount <= 0) {
    return { valid: false, reason: "I need a valid amount." };
  }

  return { valid: true, reason: null };
}
