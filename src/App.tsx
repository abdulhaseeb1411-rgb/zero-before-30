import { useState } from "react";
import { interpretTransaction, validateInterpretation } from "./lib/transaction";

const transactions = [
  { label: "Petrol", amount: "Rs 450" },
  { label: "Lunch", amount: "Rs 800" },
  { label: "Eggs + naan", amount: "Rs 200" },
];

const navItems = [
  { label: "Home", icon: "⌂", active: true },
  { label: "Activity", icon: "◷", active: false },
  { label: "Reports", icon: "◒", active: false },
  { label: "Settings", icon: "⚙", active: false },
];

export default function App() {
  const [input, setInput] = useState("");
  const [message, setMessage] = useState("");

  function submit() {
    const result = interpretTransaction(input);
    const validation = validateInterpretation(result);

    if (!validation.valid) {
      setMessage(validation.reason ?? "I need more information.");
      return;
    }

    setMessage(
      `Understood: ${result.description} — Rs ${result.amount} — ${result.account}.`,
    );
    setInput("");
  }

  return (
    <main className="app-shell">
      <section className="phone-frame" aria-label="Zero Before 30 home">
        <header className="topbar">
          <div>
            <p className="eyebrow">ZERO BEFORE 30</p>
            <h1>Your money, understood.</h1>
          </div>
          <button className="avatar-button" aria-label="Open profile">AH</button>
        </header>

        <section className="balance-card">
          <div>
            <p className="section-label">SEPTEMBER</p>
            <p className="balance">Rs 76,500</p>
            <p className="muted">remaining</p>
          </div>
          <span className="balance-mark" aria-hidden="true">↗</span>
        </section>

        <section className="capture-section">
          <p className="section-label">TELL Z30 ABOUT YOUR MONEY</p>
          <div className="capture-box">
            <input
              aria-label="Tell Z30 about your money"
              placeholder="Tell me about your money..."
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                setMessage("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") submit();
              }}
            />
            <button
              className="send-button"
              aria-label="Send transaction"
              onClick={submit}
              disabled={!input.trim()}
            >
              ↑
            </button>
          </div>
          <p className="hint">Try “petrol 450 cash”</p>
          {message && <p className="interpreter-message">{message}</p>}
        </section>

        <section className="today-section">
          <div className="section-heading">
            <h2>Today</h2>
            <span>3 entries</span>
          </div>

          <div className="transaction-list">
            {transactions.map((transaction) => (
              <article className="transaction" key={transaction.label}>
                <div className="transaction-icon" aria-hidden="true">
                  {transaction.label === "Petrol" ? "P" : transaction.label === "Lunch" ? "L" : "E"}
                </div>
                <div className="transaction-copy">
                  <strong>{transaction.label}</strong>
                  <span>Expense</span>
                </div>
                <strong className="transaction-amount">− {transaction.amount}</strong>
              </article>
            ))}
          </div>
        </section>

        <nav className="bottom-nav" aria-label="Main navigation">
          {navItems.map((item) => (
            <button className={item.active ? "nav-item active" : "nav-item"} key={item.label}>
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </section>
    </main>
  );
}
