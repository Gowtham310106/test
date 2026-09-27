"use client";

import { useActionState } from "react";
import { Alert, Button, Input, Label, Spinner } from "@/components/ui";
import { loginAction, type LoginState } from "./actions";

export function LoginForm({ next, domains, linkError }: { next: string; domains: string[]; linkError: boolean }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, { step: "email", email: "" });
  const domainHint = domains.length ? domains.map((d) => `@${d}`).join(" or ") : null;

  if (state.step === "code") {
    return (
      <form action={action} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <p className="text-sm text-muted">
          We sent a sign-in code to <strong className="text-foreground">{state.email}</strong>. It can take a minute to
          arrive — check spam too. You can also tap the link in the email.
        </p>
        <div>
          <Label htmlFor="code">Code from the email</Label>
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            maxLength={12}
            required
            autoFocus
            className="text-center font-mono text-lg tracking-[0.3em]"
          />
        </div>
        {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
        {state.info ? <Alert tone="success">{state.info}</Alert> : null}
        <Button type="submit" name="intent" value="verify" size="lg" className="w-full" disabled={pending}>
          {pending ? <Spinner /> : null} Sign in
        </Button>
        <div className="flex justify-between text-sm">
          <button type="submit" name="intent" value="restart" className="text-muted hover:text-foreground" formNoValidate>
            Use another email
          </button>
          <button type="submit" name="intent" value="resend" className="text-accent hover:underline" formNoValidate>
            Send a new code
          </button>
        </div>
      </form>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <Label htmlFor="email" hint={domainHint ? `(${domainHint})` : undefined}>
          College email
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          defaultValue={state.email}
          placeholder={domains[0] ? `rollno@${domains[0]}` : "you@college.edu"}
          required
          autoFocus
        />
      </div>
      {linkError && !state.error ? (
        <Alert tone="warning">That sign-in link has expired or was already used. Get a new code below.</Alert>
      ) : null}
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      <Button type="submit" name="intent" value="send" size="lg" className="w-full" disabled={pending}>
        {pending ? <Spinner /> : null} Email me a sign-in code
      </Button>
    </form>
  );
}
