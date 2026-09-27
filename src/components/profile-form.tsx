"use client";

import { useActionState } from "react";
import { saveProfileAction, type ProfileState } from "@/app/onboarding/actions";
import { Alert, Button, Input, Label, Select, Spinner } from "@/components/ui";
import type { Profile } from "@/lib/types";

export function ProfileForm({
  profile,
  departments,
  onboarding,
}: {
  profile: Profile;
  departments: string[];
  onboarding: boolean;
}) {
  const [state, action, pending] = useActionState<ProfileState, FormData>(saveProfileAction, {});
  const isStudent = profile.role === "student";
  const rollLocked = Boolean(profile.roll_number);
  const deptOptions =
    profile.department && !departments.includes(profile.department) ? [...departments, profile.department] : departments;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="redirect" value={onboarding ? "1" : "0"} />
      <div>
        <Label htmlFor="email">College email</Label>
        <Input id="email" value={profile.email} disabled readOnly />
      </div>
      <div>
        <Label htmlFor="full_name">Full name</Label>
        <Input id="full_name" name="full_name" defaultValue={profile.full_name ?? ""} autoComplete="name" required minLength={2} maxLength={80} />
      </div>

      {isStudent ? (
        <>
          <div>
            <Label htmlFor="roll_number" hint={rollLocked ? "(can't be changed)" : undefined}>
              Roll number
            </Label>
            <Input
              id="roll_number"
              name="roll_number"
              defaultValue={profile.roll_number ?? ""}
              readOnly={rollLocked}
              required
              autoCapitalize="characters"
              pattern="[A-Za-z0-9/\- ]{3,24}"
              title="Letters and numbers only"
              className={rollLocked ? "bg-surface-muted" : undefined}
            />
            {!rollLocked ? (
              <p className="mt-1 text-xs text-muted">Check it carefully — it links every order to you and can&apos;t be changed later.</p>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="department">Department</Label>
              <Select id="department" name="department" defaultValue={profile.department ?? ""} required>
                <option value="" disabled>
                  Choose…
                </option>
                {deptOptions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="section">Section</Label>
              <Input id="section" name="section" defaultValue={profile.section ?? ""} required maxLength={10} placeholder="A" autoCapitalize="characters" />
            </div>
          </div>
        </>
      ) : null}

      <div>
        <Label htmlFor="phone" hint={isStudent ? undefined : "(optional)"}>
          Mobile number
        </Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          defaultValue={profile.phone ?? ""}
          required={isStudent}
          placeholder="98765 43210"
        />
      </div>

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.saved ? <Alert tone="success">Saved.</Alert> : null}

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? <Spinner /> : null} {onboarding ? "Continue" : "Save changes"}
      </Button>
    </form>
  );
}
