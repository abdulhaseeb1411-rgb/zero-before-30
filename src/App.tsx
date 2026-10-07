import { useEffect, useState } from "react";

const SUPABASE_URL = "https://jipucjufzyznnavmbvzx.supabase.co";
const SUPABASE_KEY = "sb_publishable_OURbMvlxbJsmX8WTwb5Z3A_k3On9OLg";
const AUTH_REDIRECT_URL = window.location.origin;

type Tab = "home" | "activity" | "people" | "settings";
const navItems: { label: string; icon: string; tab: Tab }[] = [
  { label: "Home", icon: "⌂", tab: "home" },
  { label: "Activity", icon: "◷", tab: "activity" },
  { label: "People", icon: "☺", tab: "people" },
  { label: "Settings", icon: "⚙", tab: "settings" },
];

type ActivityRow = { id: string; type: string; status: string; amount: number; currency: string; description: string | null; transaction_date: string };
type PersonRow = { id: string; name: string };
type BalanceRow = { person_id: string; currency: string; they_owe_me: number | string; i_owe_them: number | string };
type AccountRow = { id: string; name: string; type: string; is_default: boolean };

async function restGet<T>(session: { access_token: string }, path: string): Promise<T> {
  const response = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + session.access_token },
  });
  if (!response.ok) throw new Error("Could not load this right now.");
  return (await response.json()) as T;
}

type Session = { access_token: string; user: { id: string; email?: string } };
type Summary = {
  income: number;
  salary_deductions: number;
  expenses: number;
  net_recorded: number;
  currency: string;
  transaction_count: number;
};

type Transaction = {
  id: string;
  type: string;
  amount: number;
  currency: string;
  description: string | null;
  transaction_date: string;
  created_at: string;
};

function signFor(type: string) {
  if (type === "income" || type === "borrowed") return "+";
  if (type === "settlement" || type === "transfer") return "↔";
  return "−";
}

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
      String(data.msg || data.error_description || data.error || data.message || `Authentication failed (HTTP ${response.status}).`)
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
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loadingTransactions, setLoadingTransactions] = useState(false);
  const [tab, setTab] = useState<Tab>("home");
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [tabMessage, setTabMessage] = useState("");

  useEffect(() => {
    if (session) localStorage.setItem("z30_session", JSON.stringify(session));
    else {
      localStorage.removeItem("z30_session");
      setTransactions([]);
      setSummary(null);
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
    if (session) {
      void loadTransactions(session);
      void loadSummary(session);
    }
  }, [session]);

  async function loadSummary(currentSession: Session) {
    try {
      const response = await fetch("/api/summary", {
        headers: { Authorization: "Bearer " + currentSession.access_token },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to load summary.");
      setSummary(body.summary ?? null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load summary.");
    }
  }



  async function loadTab(currentSession: Session, which: Tab) {
    setTabMessage("");
    try {
      if (which === "activity") {
        setActivity(await restGet<ActivityRow[]>(currentSession, "transactions?select=id,type,status,amount,currency,description,transaction_date&order=created_at.desc&limit=100"));
      } else if (which === "people") {
        const [p, b] = await Promise.all([
          restGet<PersonRow[]>(currentSession, "people?select=id,name&order=name.asc"),
          restGet<BalanceRow[]>(currentSession, "person_balances?select=person_id,currency,they_owe_me,i_owe_them"),
        ]);
        setPeople(p);
        setBalances(b);
      } else if (which === "settings") {
        setAccounts(await restGet<AccountRow[]>(currentSession, "accounts?select=id,name,type,is_default&order=name.asc"));
      }
    } catch (error) {
      setTabMessage(error instanceof Error ? error.message : "Could not load this right now.");
    }
  }

  useEffect(() => {
    if (session && tab !== "home") void loadTab(session, tab);
  }, [session, tab]);

  async function setDefaultAccount(accountId: string | null) {
    if (!session) return;
    setTabMessage("");
    const headers = { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: "Bearer " + session.access_token };
    try {
      const clear = await fetch(SUPABASE_URL + "/rest/v1/accounts?is_default=eq.true", { method: "PATCH", headers, body: JSON.stringify({ is_default: false }) });
      if (!clear.ok) throw new Error("Could not update your default account.");
      if (accountId) {
        const set = await fetch(SUPABASE_URL + "/rest/v1/accounts?id=eq." + accountId, { method: "PATCH", headers, body: JSON.stringify({ is_default: true }) });
        if (!set.ok) throw new Error("Could not update your default account.");
      }
      await loadTab(session, "settings");
      setTabMessage(accountId ? "Default account updated." : "Default account cleared.");
    } catch (error) {
      setTabMessage(error instanceof Error ? error.message : "Could not update your default account.");
    }
  }

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
        body: JSON.stringify({
          input: transactionInput,
        }),
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
      setMessage(body.message || "Recorded: " + body.interpretation.description + " - Rs " + body.interpretation.amount + ".");
      setInput("");
      setPendingInput(null);
      await loadTransactions(session);
      await loadSummary(session);
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

        {tab === "home" && (<>
        <section className="balance-card">
          <div>
            <p className="section-label">NET RECORDED</p>
            <p className="balance">{summary ? summary.currency + " " + Math.round(summary.net_recorded).toLocaleString("en-PK") : "Rs 0"}</p>
            <p className="muted">{summary ? "income minus recorded deductions and expenses" : "loading your money story..."}</p>
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
                  {signFor(transaction.type)} {transaction.currency} {Number(transaction.amount).toLocaleString("en-PK")}
                </strong>
              </article>
            ))}
          </div>
        </section>
        </>)}

        {tab === "activity" && (
          <section className="today-section">
            <div className="section-heading"><h2>Activity</h2><span>{activity.length} entries</span></div>
            {tabMessage && <p className="interpreter-message">{tabMessage}</p>}
            <div className="transaction-list">
              {activity.length === 0 && !tabMessage && <p className="muted">Nothing recorded yet.</p>}
              {activity.map((row) => (
                <article className="transaction" key={row.id} style={row.status === "voided" ? { opacity: 0.45 } : undefined}>
                  <div className="transaction-icon" aria-hidden="true">{(row.description || row.type).slice(0, 1).toUpperCase()}</div>
                  <div className="transaction-copy">
                    <strong style={row.status === "voided" ? { textDecoration: "line-through" } : undefined}>{row.description || row.type}</strong>
                    <span>{row.type}{row.status === "voided" ? " · deleted" : ""} · {row.transaction_date}</span>
                  </div>
                  <strong className="transaction-amount">{signFor(row.type)} {row.currency} {Number(row.amount).toLocaleString("en-PK")}</strong>
                </article>
              ))}
            </div>
          </section>
        )}

        {tab === "people" && (
          <section className="today-section">
            <div className="section-heading"><h2>People</h2><span>who owes whom</span></div>
            {tabMessage && <p className="interpreter-message">{tabMessage}</p>}
            <div className="transaction-list">
              {balances.length === 0 && !tabMessage && <p className="muted">When you lend or borrow money, balances with each person appear here.</p>}
              {balances.map((b) => {
                const name = people.find((p) => p.id === b.person_id)?.name ?? "Unknown";
                const owedToMe = Number(b.they_owe_me);
                const iOwe = Number(b.i_owe_them);
                const settled = owedToMe === 0 && iOwe === 0;
                return (
                  <article className="transaction" key={b.person_id + b.currency}>
                    <div className="transaction-icon" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</div>
                    <div className="transaction-copy">
                      <strong>{name}</strong>
                      <span>{settled ? "settled" : owedToMe > 0 ? "owes you" : "you owe"}</span>
                    </div>
                    <strong className="transaction-amount">{settled ? "—" : b.currency + " " + (owedToMe > 0 ? owedToMe : iOwe).toLocaleString("en-PK")}</strong>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {tab === "settings" && (
          <section className="today-section">
            <div className="section-heading"><h2>Settings</h2><span>{session.user.email}</span></div>
            <p className="section-label">DEFAULT ACCOUNT</p>
            <p className="muted">When you don't say how you paid, Z30 records the entry here. If you mention cash or a card, that always wins.</p>
            {tabMessage && <p className="interpreter-message">{tabMessage}</p>}
            <div className="transaction-list">
              {accounts.length === 0 && !tabMessage && <p className="muted">Accounts appear here once you mention them, for example "petrol 450 cash".</p>}
              {accounts.map((a) => (
                <article className="transaction" key={a.id}>
                  <div className="transaction-copy"><strong>{a.name}</strong><span>{a.type}{a.is_default ? " · default" : ""}</span></div>
                  {a.is_default
                    ? <button className="secondary-button" onClick={() => void setDefaultAccount(null)}>Clear default</button>
                    : <button className="secondary-button" onClick={() => void setDefaultAccount(a.id)}>Make default</button>}
                </article>
              ))}
            </div>
            <p style={{ marginTop: 24 }}><button className="secondary-button" onClick={signOut}>Sign out</button></p>
          </section>
        )}

        <nav className="bottom-nav" aria-label="Main navigation">
          {navItems.map((item) => (
            <button className={tab === item.tab ? "nav-item active" : "nav-item"} key={item.label} type="button" onClick={() => setTab(item.tab)}>
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </section>
    </main>
  );
}
