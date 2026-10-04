import { useState, type FormEvent, type ReactNode } from "react";
import { AuthApiError, authApi, authEnabled } from "./api";
import { useAuth } from "./AuthProvider";

type View = "closed" | "login" | "register" | "confirm" | "profile";

function message(err: unknown): string {
  if (err instanceof AuthApiError) return err.message;
  return "Something went wrong. Please try again.";
}

export function AuthBar() {
  const { status, profile } = useAuth();
  // Hooks run unconditionally; the enabled check is below.
  const [view, setView] = useState<View>("closed");
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");

  if (!authEnabled()) return null;
  if (status === "restoring") {
    return <div className="auth-bar" aria-busy="true" />;
  }

  return (
    <div className="auth-bar">
      {status === "signed-in" && profile ? (
        <>
          <span className="signed-in-as">Signed in as {profile.email}</span>
          <button type="button" onClick={() => setView(view === "profile" ? "closed" : "profile")}>
            My profile
          </button>
        </>
      ) : (
        <>
          <button type="button" onClick={() => { setNotice(""); setView("login"); }}>
            Sign in
          </button>
          <button type="button" className="primary" onClick={() => { setNotice(""); setView("register"); }}>
            Create account
          </button>
        </>
      )}
      {view !== "closed" && (
        <section className="auth-panel" aria-label="Account">
          {view === "register" && (
            <RegisterForm
              onDone={(e) => { setEmail(e); setNotice("We sent a 6-digit code to your email."); setView("confirm"); }}
              onSwitch={() => setView("login")}
            />
          )}
          {view === "confirm" && (
            <ConfirmForm
              email={email}
              notice={notice}
              onDone={() => { setNotice("Email confirmed. Please sign in."); setView("login"); }}
            />
          )}
          {view === "login" && (
            <LoginForm
              initialEmail={email}
              notice={notice}
              onDone={() => setView("profile")}
              onNeedsConfirm={(e) => { setEmail(e); setNotice("Your email is not confirmed yet."); setView("confirm"); }}
              onSwitch={() => setView("register")}
            />
          )}
          {view === "profile" && <ProfileView onSignedOut={() => setView("closed")} />}
          <button type="button" className="link" onClick={() => setView("closed")}>
            Close
          </button>
        </section>
      )}
    </div>
  );
}

function Field(props: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (fn: () => Promise<void>) => {
    if (busy) return; // prevent double submit
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

function RegisterForm({ onDone, onSwitch }: { onDone: (email: string) => void; onSwitch: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const { busy, error, setError, run } = useSubmit();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    void run(async () => {
      const r = await authApi.register(email.trim(), password);
      onDone(email.trim());
      if (r.next_step === "LOGIN") onSwitch();
    });
  };

  return (
    <form onSubmit={submit} noValidate>
      <h2>Create account</h2>
      <Field label="Email">
        <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password">
        <input type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <p className="hint">At least 8 characters with upper- and lower-case letters, a number and a symbol.</p>
      <Field label="Confirm password">
        <input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="submit" className="primary" disabled={busy}>
        {busy ? "Creating…" : "Create account"}
      </button>
      <button type="button" className="link" onClick={onSwitch}>
        Already have an account? Sign in
      </button>
    </form>
  );
}

function ConfirmForm({ email, notice, onDone }: { email: string; notice: string; onDone: () => void }) {
  const [addr, setAddr] = useState(email);
  const [code, setCode] = useState("");
  const [info, setInfo] = useState(notice);
  const { busy, error, run } = useSubmit();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await authApi.confirm(addr.trim(), code.trim());
      onDone();
    });
  };
  const resend = () =>
    void run(async () => {
      await authApi.resend(addr.trim());
      setInfo("A new code is on its way.");
    });

  return (
    <form onSubmit={submit} noValidate>
      <h2>Confirm your email</h2>
      {info && <p className="notice" role="status">{info}</p>}
      <p className="hint">
        Check your inbox (and spam folder) for an email from the sign-in service. Codes expire after 24 hours.
      </p>
      <Field label="Email">
        <input type="email" autoComplete="email" required value={addr} onChange={(e) => setAddr(e.target.value)} />
      </Field>
      <Field label="Verification code">
        <input inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} />
      </Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="submit" className="primary" disabled={busy}>
        {busy ? "Confirming…" : "Confirm"}
      </button>
      <button type="button" className="link" onClick={resend} disabled={busy || !addr}>
        Send a new code
      </button>
    </form>
  );
}

function LoginForm(props: {
  initialEmail: string;
  notice: string;
  onDone: () => void;
  onNeedsConfirm: (email: string) => void;
  onSwitch: () => void;
}) {
  const { login } = useAuth();
  const [email, setEmail] = useState(props.initialEmail);
  const [password, setPassword] = useState("");
  const { busy, error, run } = useSubmit();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      try {
        await login(email.trim(), password);
        setPassword("");
        props.onDone();
      } catch (err) {
        if (err instanceof AuthApiError && err.code === "NOT_CONFIRMED") {
          props.onNeedsConfirm(email.trim());
          return;
        }
        throw err;
      }
    });
  };

  return (
    <form onSubmit={submit} noValidate>
      <h2>Sign in</h2>
      {props.notice && <p className="notice" role="status">{props.notice}</p>}
      <Field label="Email">
        <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password">
        <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="submit" className="primary" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <button type="button" className="link" onClick={props.onSwitch}>
        New here? Create an account
      </button>
    </form>
  );
}

function ProfileView({ onSignedOut }: { onSignedOut: () => void }) {
  const { profile, logout } = useAuth();
  const { busy, error, run } = useSubmit();
  if (!profile) return null;
  return (
    <div>
      <h2>My profile</h2>
      <dl className="profile">
        <dt>Email</dt>
        <dd>{profile.email}</dd>
        <dt>Status</dt>
        <dd>{profile.status}</dd>
        <dt>AI designs used</dt>
        <dd>
          {profile.ai_usage_count} of {profile.ai_quota_limit}
        </dd>
      </dl>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            await logout();
            onSignedOut();
          })
        }
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
