import { interpretTransaction } from "../src/lib/transaction.ts";

type Expectation = {
  input: string;
  check: (r: ReturnType<typeof interpretTransaction>) => boolean;
  label: string;
};

const cases: Expectation[] = [
  { input: "aaj office se wapas aate hue petrol ke 3200 diye cash", label: "cash petrol", check: r => r.intent === "expense" && r.amount === 3200 && r.account === "Cash" },
  { input: "kal raat biwi ke mobile ka bill 1850 alfalah card se pay kiya", label: "yesterday wife mobile card", check: r => r.intent === "expense" && r.amount === 1850 && r.account === "Bank Alfalah Credit Card" && r.date_offset === -1 },
  { input: "ammi ki 2750 wali medicine cash mein li", label: "cash medicine", check: r => r.intent === "expense" && r.amount === 2750 && r.account === "Cash" },
  { input: "2 hazar ki chai aur snacks office mein cash", label: "roman urdu thousand", check: r => r.intent === "expense" && r.amount === 2000 && r.account === "Cash" },
  { input: "aaj 3 baje 4500 ki grocery alfalah cc pe", label: "time is not amount", check: r => r.intent === "expense" && r.amount === 4500 && r.transaction_time === "03:00" && r.account === "Bank Alfalah Credit Card" },
  { input: "raat ko 10:30 pe family dinner 3800 card pe", label: "colon time", check: r => r.intent === "expense" && r.amount === 3800 && r.transaction_time === "10:30" && r.account === "CARD_GENERIC" },
  { input: "bijli ke 12750 salary se cut hue", label: "salary deduction", check: r => r.intent === "salary_deduction" && r.amount === 12750 },
  { input: "salary 90000", label: "salary income", check: r => r.intent === "income" && r.amount === 90000 },
  { input: "Ali ko pichle hafte diye hue 5000 wapas mil gaye", label: "repayment return is not expense", check: r => r.needs_clarification },
  { input: "5000 diye thay Ali ko, ab usne 3000 wapas kar diye", label: "partial repayment is not expense", check: r => r.needs_clarification },
  { input: "petrol 2500, cash nahi tha isliye alfalah cc pe", label: "explicit card wins", check: r => r.intent === "expense" && r.amount === 2500 && r.account === "Bank Alfalah Credit Card" },
  { input: "grocery 4500 mein se 2000 cash aur baqi card", label: "split payment asks", check: r => r.needs_clarification },
  { input: "wife ka mobile 1500 aur mera 1800, dono alfalah card pe", label: "multiple expenses asks", check: r => r.needs_clarification },
  { input: "kal 18:45 pe chicken 2300 liya tha lekin 1400 cash diye", label: "conflicting amounts asks", check: r => r.needs_clarification },
  { input: "3000 ka bill tha, 1000 pehle diye thay aur aaj 2000 diye", label: "staged payment asks", check: r => r.needs_clarification },
  { input: "salary mein 95000 aaye, 20000 bijli aur 5000 tax cut hua", label: "salary plus deductions asks", check: r => r.needs_clarification },
  { input: "Amjad ki medicine 4800 maine pay ki, usko December mein wapas deni hai", label: "money owed to user", check: r => r.needs_clarification },
  { input: "cousin Hanif se 25000 mile, November mein wapas karne hain", label: "borrowed money asks", check: r => r.needs_clarification },
  { input: "800 lunch Anees ke saath, usne mere paise baad mein dene hain", label: "reimbursement asks", check: r => r.needs_clarification },
  { input: "5000 cash nikale bank se, kharcha nahi hua", label: "withdrawal is not expense", check: r => r.needs_clarification }
];

let passed = 0;
for (const test of cases) {
  const result = interpretTransaction(test.input);
  if (test.check(result)) {
    passed++;
    console.log("PASS", test.label);
  } else {
    console.error("FAIL", test.label, JSON.stringify(result));
  }
}

console.log(`Benchmark: ${passed}/${cases.length}`);
if (passed !== cases.length) process.exit(1);
