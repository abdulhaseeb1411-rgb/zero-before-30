import { useEffect, useState } from "react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
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

type Session = { access_token: string; user: { id: string; email?: string } };

async function authRequest(path: string, body: Record<string, string>) {
  const response = await fetch(SUPABASE_URL + "/auth/v1/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.msg || data.error_description || data.error || "Authentication failed.");
  return data as Session;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(() => {
    const saved = localStorage.getItem("z30_session");
    return saved ? JSON.parse(saved) : null;
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [input, setInput] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (session) localStorage.setItem("z30_session", JSON.stringify(session));
    else localStorage.removeItem("z30_session");
  }, [session]);

  async function signIn() {
    try {
      const next = await authRequest("token?grant_type=password", { email: email.trim(), password });
      setSession(next);
      setAuthMessage("Signed in.");
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : "Unable to sign in.");
    }
  }

  async function signUp() {
    try {
      await authRequest("signup", { email: email.trim(), password });
      setAuthMessage("Account created. Check your email if confirmation is required.");
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : "Unable to create account.");
    }
  }

  function signOut() {
    setSession(null);
  }

  function submit() {
    if (!session) {
      setMessage("Sign in first to record this.");
      return;
    }

    const result = interpretTransaction(input);
    const validation = validateInterpretation(result);

    if (!validation.valid) {
      setMessage(validation.reason ?? "I need more information.");
      return;
    }

    setSending(true);
    setMessage("");
    try {
      const response = await fetch("/api/transactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + session.access_token,
          "X-Client-Request-Id": crypto.randomUUID(),
        },
        body: JSON.stringify({ input: input.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(body.clarification_reason || body.error || "Unable to record this.");
        return;
      }
      setMessage(
        "Recorded: " + body.interpretation.description + " — Rs " + body.interpretation.amount + ".",
      );
      setInput("");
    } catch {
      setMessage("Z30 API is not connected yet.");
    } finally {
      setSending(false);
    }
  }

  if (!session) {
    return (
      <main className="app-shell">
        <section className="phone-frame">
          <header className="topbar">
            <div>
              <p className="eyebrow">ZERO BEFORE 30</p>
              <h1>Your money, understood.</h1>
            </div>
          </header>
          <section className="capture-section auth-card">
            <p className="section-label">YOUR ACCOUNT</p>
            <h2>Start with your money.</h2>
            <p className="muted">Create your private Z30 account or sign in.</p>
            <input className="auth-input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className="auth-input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <div className="auth-actions">
              <button className="primary-button" onClick={signIn}>Sign in</button>
              <button className="secondary-button" onClick={signUp}>Create account</button>
            </div>
            {authMessage && <p className="interpreter-message">{authMessage}</p>}
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="phone-frame" aria-label="Zero Before 30 home">
        <header className="topbar">
          <div>
            <p className="eyebrow">ZERO BEFORE 30</p>
            <h1>Your money, understood.</h1>
          </div>
          <button className="avatar-button" aria-label="Sign out" onClick={signOut}>AH</button>
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
              disabled={!input.trim() || sending}
            >
              {sending ? "…" : "↑"}
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
