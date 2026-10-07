// Smoke-test cases written by the CEO. Not a substitute for real user entries (gate G2).
export type EvalCase = { id: number; input: string; kind: "record" | "clarify"; intent?: string; amount?: number; account?: string; person?: string; clarify_ok?: boolean };
export const MUST_CLARIFY = new Set([2, 5, 7, 15, 22, 23, 29, 30, 32, 33]);
export const evalCases: EvalCase[] = [
 {
  "id": 1,
  "input": "petrol 450 cash",
  "kind": "record",
  "intent": "expense",
  "amount": 450,
  "account": "Cash"
 },
 {
  "id": 2,
  "input": "petrol 450",
  "kind": "clarify"
 },
 {
  "id": 3,
  "input": "13500 grocery cash",
  "kind": "record",
  "intent": "expense",
  "amount": 13500,
  "account": "Cash"
 },
 {
  "id": 4,
  "input": "salary 90000",
  "kind": "record",
  "intent": "income",
  "amount": 90000
 },
 {
  "id": 5,
  "input": "200 ande and naan",
  "kind": "clarify"
 },
 {
  "id": 6,
  "input": "Dinner 5315 alfalah cc",
  "kind": "record",
  "intent": "expense",
  "amount": 5315,
  "account": "Bank Alfalah Credit Card"
 },
 {
  "id": 7,
  "input": "Amjad 4800",
  "kind": "clarify"
 },
 {
  "id": 8,
  "input": "Amjad medicine 4800, I paid it for him",
  "kind": "record",
  "intent": "lent",
  "amount": 4800,
  "person": "Amjad"
 },
 {
  "id": 9,
  "input": "Hanif gave me 25000, I'll return in December",
  "kind": "record",
  "intent": "borrowed",
  "amount": 25000,
  "person": "Hanif"
 },
 {
  "id": 10,
  "input": "petrol was 500 not 450",
  "kind": "record",
  "intent": "correction",
  "amount": 500
 },
 {
  "id": 11,
  "input": "kal 2 hazar ki chai cash se li",
  "kind": "record",
  "intent": "expense",
  "amount": 2000,
  "account": "Cash"
 },
 {
  "id": 12,
  "input": "bijli ka bill 8k HBL cc se pay kiya",
  "kind": "record",
  "intent": "expense",
  "amount": 8000,
  "account": "HBL Credit Card"
 },
 {
  "id": 13,
  "input": "ٹیکسی کا کرایہ 350 نقد",
  "kind": "record",
  "intent": "expense",
  "amount": 350,
  "account": "Cash"
 },
 {
  "id": 14,
  "input": "آج 1200 کی دوائی لی، کیش",
  "kind": "record",
  "intent": "expense",
  "amount": 1200,
  "account": "Cash"
 },
 {
  "id": 15,
  "input": "salary 95000 mili, 10000 loan ke liye cut hue",
  "kind": "clarify"
 },
 {
  "id": 16,
  "input": "Ali ne mere 3000 wapas kiye",
  "kind": "record",
  "intent": "settlement",
  "amount": 3000,
  "person": "Ali",
  "clarify_ok": true
 },
 {
  "id": 17,
  "input": "bank se 20000 cash nikalwaya",
  "kind": "record",
  "intent": "transfer",
  "amount": 20000,
  "clarify_ok": true
 },
 {
  "id": 18,
  "input": "Hanif ko 25000 wapas kar diye",
  "kind": "record",
  "intent": "settlement",
  "amount": 25000,
  "person": "Hanif",
  "clarify_ok": true
 },
 {
  "id": 19,
  "input": "kitna kharcha hua aaj",
  "kind": "record",
  "intent": "query"
 },
 {
  "id": 20,
  "input": "mujhe kitne paise lene hain",
  "kind": "record",
  "intent": "query"
 },
 {
  "id": 21,
  "input": "last petrol entry delete kar do",
  "kind": "record",
  "intent": "void"
 },
 {
  "id": 22,
  "input": "lunch 650",
  "kind": "clarify"
 },
 {
  "id": 23,
  "input": "5000",
  "kind": "clarify"
 },
 {
  "id": 24,
  "input": "gave Ahmed 2000 for lunch, he will pay back Friday",
  "kind": "record",
  "intent": "lent",
  "amount": 2000,
  "person": "Ahmed"
 },
 {
  "id": 25,
  "input": "birthday party 18k alfalah card",
  "kind": "record",
  "intent": "expense",
  "amount": 18000,
  "account": "Bank Alfalah Credit Card"
 },
 {
  "id": 26,
  "input": "paid 2k rent via meezan",
  "kind": "record",
  "intent": "expense",
  "amount": 2000,
  "account": "Meezan"
 },
 {
  "id": 27,
  "input": "salary cut 3500 tax",
  "kind": "record",
  "intent": "salary_deduction",
  "amount": 3500
 },
 {
  "id": 28,
  "input": "i spent 5 lakh on car down payment cash",
  "kind": "record",
  "intent": "expense",
  "amount": 500000,
  "account": "Cash"
 },
 {
  "id": 29,
  "input": "ammi ko 15000 diye",
  "kind": "clarify"
 },
 {
  "id": 30,
  "input": "hello",
  "kind": "clarify"
 },
 {
  "id": 31,
  "input": "transfer 5000 from HBL to cash",
  "kind": "record",
  "intent": "transfer",
  "amount": 5000
 },
 {
  "id": 32,
  "input": "petrol 450 cash, grocery 1200 hbl",
  "kind": "clarify"
 },
 {
  "id": 33,
  "input": "refund 1500 aaya amazon se",
  "kind": "clarify"
 },
 {
  "id": 34,
  "input": "Rs 3,200 electricity cash",
  "kind": "record",
  "intent": "expense",
  "amount": 3200,
  "account": "Cash"
 },
 {
  "id": 35,
  "input": "2.5k chai samosa cash",
  "kind": "record",
  "intent": "expense",
  "amount": 2500,
  "account": "Cash"
 },
 {
  "id": 36,
  "input": "ahmed ko 5k diye wapas",
  "kind": "record",
  "intent": "settlement",
  "amount": 5000,
  "person": "Ahmed",
  "clarify_ok": true
 },
 {
  "id": 37,
  "input": "cash nahi tha isliye alfalah cc pe 3000 petrol",
  "kind": "record",
  "intent": "expense",
  "amount": 3000,
  "account": "Bank Alfalah Credit Card"
 },
 {
  "id": 38,
  "input": "salary aayi 90k",
  "kind": "record",
  "intent": "income",
  "amount": 90000
 },
 {
  "id": 39,
  "input": "کل رات 10 بجے 800 کا کھانا alfalah cc",
  "kind": "record",
  "intent": "expense",
  "amount": 800,
  "account": "Bank Alfalah Credit Card"
 },
 {
  "id": 40,
  "input": "dost ne 3000 diye, ye udhaar nahi, gift hai",
  "kind": "record",
  "intent": "income",
  "amount": 3000
 }
];

// Founder's own entries (no answer key; CEO reviews outputs by hand).
export const founderInputs: string[] = [
 "petrol 450 cash",
 "5596 sweets apf bakers",
 "13966 grocery pac commissary 02/09/26",
 "dinner 5315 alfalah cc",
 "salary 90000",
 "grocery 4500 cash",
 "electricity bill 7200",
 "mobile bill 1500 jazzcash",
 "petrol 3000 hbl cc",
 "lunch 850 cash",
 "medicine 2400 alfalah cc",
 "eggs and naan 200 cash",
 "internet 3200 bank alfalah",
 "500 chai cash",
 "shoes 4500 hbl credit card",
 "grocery 7800",
 "rent 25000 cash",
 "wife mobile 1500",
 "school fee 8500",
 "restaurant 2850 alfalah cc",
 "aaj 3 baje 4500 ki grocery alfalah cc",
 "kal 8 pm petrol 2500 cash",
 "05/09/26 grocery 13500",
 "02/09/26 sweets 5596 apf bakers",
 "yesterday lunch 900 cash",
 "aaj subah chai 250 cash",
 "raat 9 baje dinner 3200 alfalah cc",
 "10 september petrol 3000 hbl cc",
 "5 sept ko grocery 4200",
 "aaj 2 baje medicine 1800 cash",
 "aaj bazar se sabzi 1200 ki cash",
 "biwi ke mobile ka bill 1500",
 "office jane ke liye petrol 2000",
 "kal grocery pe 6500 lag gaye",
 "ammi ki medicine 2800 maine pay ki",
 "dost ko 5000 udhar diye",
 "Ali se 3000 udhar liye",
 "Hanif ne mujhe 25000 diye",
 "maine Ahmed ko 4000 wapis kiye",
 "petrol tha 2500 nahi 3000",
 "آج پٹرول 2500 کیش",
 "گروسری 8500 الفلاح کریڈٹ کارڈ",
 "بجلی کا بل 7200",
 "امی کی دوا 1800 کیش",
 "تنخواہ 90000",
 "آج رات کھانا 2500",
 "علی کو 5000 ادھار دیے",
 "احمد سے 3000 ادھار لیے",
 "پٹرول 2000 تھا، 2500 نہیں",
 "کل گروسری 4500 میں کی"
];
