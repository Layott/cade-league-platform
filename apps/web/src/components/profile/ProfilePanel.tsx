import Image from "next/image";
import type { ProfileView } from "@/server/profile/read";
import { StatusPill, roleTone } from "@/components/admin/StatusPill";
import {
  FormField,
  inputClass,
  textareaClass,
} from "@/components/admin/FormField";
import { PrimaryButton } from "@/components/admin/buttons";
import {
  updateOwnProfileAction,
  updateOtherProfileAction,
} from "@/app/(auth)/profile/actions";

/**
 * Plan 40 (P40-B) — <ProfilePanel />.
 *
 * Server component. Renders the identity card, role chips, and (when
 * `editable=true`) an inline form bound to the Plan 40 edit actions.
 * Displays only the Plan 40 sections; player-specific stat/sanction/appeal
 * panels belong to Plan 41 and plug in where marked below.
 *
 * The `targetUserId` prop distinguishes self-edit (omitted OR equal to the
 * rendered profile) from admin-cross-edit, which swaps the bound action.
 */

type Props = {
  profile: ProfileView;
  editable: boolean;
  /**
   * When present AND different from `profile.userId`, the form submits via
   * the admin cross-edit action. When absent/equal, the form submits via
   * the self-edit action.
   */
  actorUserId?: string | null;
};

function initialsFromName(name: string): string {
  const parts = name
    .split(/\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function ProfilePanel({ profile, editable, actorUserId }: Props) {
  const isCrossEdit =
    editable && actorUserId != null && actorUserId !== profile.userId;

  const formAction = isCrossEdit
    ? updateOtherProfileAction.bind(null, profile.userId)
    : updateOwnProfileAction;

  const initials = initialsFromName(profile.displayName || profile.email);

  return (
    <div className="space-y-6" data-testid="profile-panel">
      {/* Identity card — avatar + name + email + role chips */}
      <section
        aria-labelledby="identity-heading"
        className="flex flex-col gap-5 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-6 md:flex-row md:items-center"
      >
        <div className="flex shrink-0 items-center justify-center">
          {profile.photoUrl ? (
            <Image
              src={profile.photoUrl}
              alt={profile.displayName}
              width={96}
              height={96}
              className="h-24 w-24 rounded-sm border border-[var(--ink-4)] object-cover"
              data-testid="profile-avatar"
            />
          ) : (
            <div
              className="flex h-24 w-24 items-center justify-center rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] font-display text-3xl font-bold tracking-tight text-[var(--chalk-1)]"
              aria-hidden
              data-testid="profile-initials"
            >
              {initials}
            </div>
          )}
        </div>

        <div className="flex-1 space-y-3">
          <div>
            <h2
              id="identity-heading"
              className="font-display text-2xl font-bold leading-tight text-[var(--chalk-0)]"
              data-testid="profile-display-name"
            >
              {profile.displayName || "—"}
            </h2>
            <p
              className="font-mono text-xs text-[var(--chalk-2)]"
              data-testid="profile-email"
            >
              {profile.email || "—"}
            </p>
          </div>

          {profile.hasPlayerRow ? (
            <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-[10px] uppercase tracking-[0.2em] text-[var(--chalk-3)]">
                  Gamer tag
                </dt>
                <dd className="font-mono text-[var(--chalk-1)]">
                  {profile.gamerTag ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-[0.2em] text-[var(--chalk-3)]">
                  Jersey
                </dt>
                <dd className="font-mono tabular-nums text-[var(--chalk-1)]">
                  {profile.jerseyNumber ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-[0.2em] text-[var(--chalk-3)]">
                  Organization
                </dt>
                <dd className="font-mono text-[var(--chalk-1)]">
                  {profile.organizationId ? "Assigned" : "—"}
                </dd>
              </div>
            </dl>
          ) : null}

          <div>
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
              Roles
            </h3>
            {profile.roles.length === 0 ? (
              <p className="text-xs text-[var(--chalk-3)]">No roles</p>
            ) : (
              <ul
                className="flex flex-wrap gap-1.5"
                data-testid="profile-roles"
              >
                {profile.roles.map((role) => (
                  <li key={role}>
                    <StatusPill tone={roleTone(role)}>
                      {role.replace(/_/g, " ")}
                    </StatusPill>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* Edit form — bio, display_name, photo_url. */}
      {editable ? (
        <section
          aria-labelledby="edit-heading"
          className="space-y-4 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5"
        >
          <h2
            id="edit-heading"
            className="font-display text-lg font-bold text-[var(--chalk-0)]"
          >
            Edit profile
          </h2>
          <form
            action={formAction}
            className="grid grid-cols-1 gap-4 md:grid-cols-2"
            data-testid="edit-profile-form"
          >
            <FormField label="Display name" htmlFor="profile-display-name">
              <input
                id="profile-display-name"
                name="display_name"
                type="text"
                defaultValue={profile.displayName}
                maxLength={80}
                className={inputClass}
                data-testid="edit-display-name"
              />
            </FormField>
            <FormField
              label="Photo URL"
              htmlFor="profile-photo-url"
              hint={
                profile.hasPlayerRow
                  ? "http(s) URL or site-relative path"
                  : "Available once a player row exists (Plan 41)."
              }
            >
              <input
                id="profile-photo-url"
                name="photo_url"
                type="text"
                defaultValue={profile.photoUrl ?? ""}
                maxLength={2048}
                className={inputClass}
                disabled={!profile.hasPlayerRow}
                data-testid="edit-photo-url"
              />
            </FormField>
            <div className="md:col-span-2">
              <FormField
                label="Bio"
                htmlFor="profile-bio"
                hint={
                  profile.hasPlayerRow
                    ? "Up to 500 characters."
                    : "Available once a player row exists (Plan 41)."
                }
              >
                <textarea
                  id="profile-bio"
                  name="bio"
                  defaultValue={profile.bio ?? ""}
                  rows={4}
                  maxLength={500}
                  className={textareaClass}
                  disabled={!profile.hasPlayerRow}
                  data-testid="edit-bio"
                />
              </FormField>
            </div>
            <div className="md:col-span-2">
              <PrimaryButton type="submit" data-testid="edit-profile-submit">
                Save profile
              </PrimaryButton>
            </div>
          </form>
        </section>
      ) : null}

      {/*
        Plan 41 plug-in point.
        Player-specific panels (stat summary, sanctions list, appeal button,
        squad status widget, squad due banner) mount here in the next plan.
        Keeping this marker explicit so the reviewer can diff P40 vs P41.
      */}
    </div>
  );
}
