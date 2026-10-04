import { useEffect, useState } from "react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
const AUTH_REDIRECT_URL = "https://z30-webhook.abdulhaseeb1411.workers.dev";

const navItems = [
  { label: "Home", icon: "⌂", active: true },
  { label: "Activity", icon: "◷", active: false },
  { label: "Reports", icon: "◒", active: false },
  { label: "Settings", icon: "⚙", active: false },
];

type Session = { access_token: string; user: { id: string; email?: string } };
type Transaction = {
  id: string;
  type: string;
  amount: number;
  currency: string;
  description: string | null;
  transaction_date: string;
  created_at: string;
};

async function authRequest(path: string, body: Record<string, string>) {
  const response = await fetch(SUPABASE_URL + "/auth/v1/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
    body: JSON.stringify({ ...body, ...(path === "signup" ? { options: { email_redirect_to: AUTH_REDIRECT_URL } } : {}) }),
  });
  const raw = await response.text();
  let data: Record<string, unknown> = {};
  if (raw.trim()) {
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      if (!response.ok) throw new Error("Authentication service returned an invalid response.");
    }
  }
  if (!response.ok) {
    throw new Error(
      String(data.msg || data.error_description || data.error || "Authentication failed.")
    );
  }
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
  const [pendingInput, setPendingInput] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(false);

  useEffect(() => {
    if (session) localStorage.setItem("z30_session", JSON.stringify(session));
    else {
      localStorage.removeItem("z30_session");
      setTransactions([]);
    }
  }, [session]);

  async function loadTransactions(currentSession: Session) {
    setLoadingTransactions(true);
    try {
      const response = await fetch("/api/transactions", {
        headers: { Authorization: "Bearer " + currentSession.access_token },
      });
      const raw = await response.text();
      let body: { error?: string; transactions?: Transaction[] } = {};
      if (raw.trim()) {
        try { body = JSON.parse(raw) as typeof body; }
        catch { throw new Error("Transaction service returned an invalid response."); }
      }
      if (!response.ok) throw new Error(body.error || "Unable to load transactions.");
      setTransactions(body.transactions ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load transactions.");
    } finally {
      setLoadingTransactions(false);
    }
  }

  useEffect(() => {
    if (session) void loadTransactions(session);
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

  async function resendConfirmation() {
    try {
      const response = await fetch(SUPABASE_URL + "/auth/v1/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
        body: JSON.stringify({
          type: "signup",
          email: email.trim(),
          options: { email_redirect_to: AUTH_REDIRECT_URL },
        }),
      });
      const raw = await response.text();
      let data: Record<string, unknown> = {};
      if (raw.trim()) {
        try { data = JSON.parse(raw) as Record<string, unknown>; } catch {}
      }
      if (!response.ok) {
        throw new Error(String(data.msg || data.error_description || data.error || "Unable to resend confirmation email."));
      }
      setAuthMessage("A fresh confirmation email has been sent. Use the newest email.");
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : "Unable to resend confirmation email.");
    }
  }

  function signOut() {
    setSession(null);
    setMessage("");
  }

  async function submit() {
    if (!session || !input.trim() || sending) return;
    setSending(true);
    setMessage("");
    try {
      const transactionInput = pendingInput ? pendingInput + " " + input.trim() : input.trim();
      const response = await fetch("/api/transactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + session.access_token,
          "X-Client-Request-Id": crypto.randomUUID(),
        },
        body: JSON.stringify({ input: transactionInput }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (body.clarification_reason === "How did you pay?") {
          setPendingInput(transactionInput);
          setMessage("How did you pay? Enter cash, card, or another account.");
        } else {
          setMessage(body.clarification_reason || body.error || "Unable to record this.");
        }
        setInput("");
        return;
      }
      setMessage("Recorded: " + body.interpretation.description + " - Rs " + body.interpretation.amount + ".");
      setInput("");
      setPendingInput(null);
      await loadTransactions(session);
    } catch {
      setMessage("Z30 could not reach the transaction service. Please try again.");
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
            <button className="secondary-button" onClick={() => void resendConfirmation()} disabled={!email.trim()}>
              Resend confirmation email
            </button>
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
            <p className="section-label">YOUR MONEY</p>
            <p className="balance">Rs 0</p>
            <p className="muted">balance summary coming next</p>
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
                if (event.key === "Enter") void submit();
              }}
            />
            <button className="send-button" aria-label="Send transaction" onClick={() => void submit()} disabled={!input.trim() || sending}>
              {sending ? "…" : "↑"}
            </button>
          </div>
          <p className="hint">{pendingInput ? "Payment method for: " + pendingInput : "Try “petrol 450 cash”"}</p>
          {message && <p className="interpreter-message">{message}</p>}
        </section>

        <section className="today-section">
          <div className="section-heading">
            <h2>Recent transactions</h2>
            <span>{transactions.length} entries</span>
          </div>
          <div className="transaction-list">
            {loadingTransactions && <p className="muted">Loading transactions…</p>}
            {!loadingTransactions && transactions.length === 0 && <p className="muted">Your recorded transactions will appear here.</p>}
            {transactions.map((transaction) => (
              <article className="transaction" key={transaction.id}>
                <div className="transaction-icon" aria-hidden="true">
                  {(transaction.description || "T").slice(0, 1).toUpperCase()}
                </div>
                <div className="transaction-copy">
                  <strong>{transaction.description || "Transaction"}</strong>
                  <span>{transaction.type} · {transaction.transaction_date}</span>
                </div>
                <strong className="transaction-amount">
                  {transaction.type === "income" ? "+" : "−"} {transaction.currency} {Number(transaction.amount).toLocaleString("en-PK")}
                </strong>
              </article>
            ))}
          </div>
        </section>

        <nav className="bottom-nav" aria-label="Main navigation">
          {navItems.map((item) => (
            <button className={item.active ? "nav-item active" : "nav-item"} key={item.label} type="button">
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </section>
    </main>
  );
}
