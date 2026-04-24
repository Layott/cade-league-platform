"use client";

import { useMemo, useState, useTransition } from "react";
import {
  FormField,
  inputClass,
  selectClass,
  textareaClass,
} from "@/components/admin/FormField";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { SignedFileInput } from "@/components/shared/SignedFileInput";
import type {
  MatchDayOption,
  MatchOption,
  SanctionOption,
} from "@/server/disputes/pickers";
import {
  submitDisputeAction,
  requestEvidenceUploadAction,
} from "./actions";

type SubjectType = "match" | "sanction" | "registration" | "other";

export function SubmitDisputeForm({
  matchDays,
  matches,
  sanctions,
}: {
  matchDays: MatchDayOption[];
  matches: MatchOption[];
  sanctions: SanctionOption[];
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [subjectType, setSubjectType] = useState<SubjectType>("match");
  const [matchDayId, setMatchDayId] = useState<string>(
    matchDays[0]?.id ?? "",
  );
  const [matchId, setMatchId] = useState<string>("");
  const [sanctionId, setSanctionId] = useState<string>("");

  const matchesForDay = useMemo(
    () => matches.filter((m) => !matchDayId || m.matchDayId === matchDayId),
    [matches, matchDayId],
  );

  const subjectId =
    subjectType === "match"
      ? matchId
      : subjectType === "sanction"
        ? sanctionId
        : "";

  const subjectPickerMissing =
    (subjectType === "match" && !matchId) ||
    (subjectType === "sanction" && !sanctionId);

  return (
    <form
      className="space-y-5"
      data-testid="dispute-submit-form"
      action={(fd: FormData) =>
        startTransition(async () => {
          setError(null);
          if (subjectPickerMissing) {
            setError(
              subjectType === "match"
                ? "Pick the match this dispute is about."
                : "Pick the sanction this dispute is about.",
            );
            return;
          }
          try {
            await submitDisputeAction(fd);
          } catch (err) {
            // Next's `redirect()` throws NEXT_REDIRECT to short-circuit —
            // let it bubble so the navigation fires. Only show real errors.
            const msg = (err as Error).message ?? "";
            if (msg.toLowerCase().includes("next_redirect")) throw err;
            setError(msg);
          }
        })
      }
    >
      <FormField label="Subject type">
        <select
          name="subjectType"
          value={subjectType}
          onChange={(e) => {
            const next = e.target.value as SubjectType;
            setSubjectType(next);
            // Reset picker state when the user changes type so stale
            // subjectId values don't leak into the submit payload.
            setMatchId("");
            setSanctionId("");
          }}
          required
          className={selectClass}
          data-testid="dispute-subject-type"
        >
          <option value="match">Match</option>
          <option value="sanction">Sanction</option>
          <option value="registration">Registration</option>
          <option value="other">Other</option>
        </select>
      </FormField>

      {subjectType === "match" ? (
        matches.length === 0 ? (
          <p
            className="text-xs text-[var(--chalk-3)]"
            data-testid="dispute-no-matches"
          >
            You have no matches to dispute yet. Pick &quot;Other&quot; or try
            again after your next fixture.
          </p>
        ) : (
          <>
            <FormField label="Match day">
              <select
                name="matchDayId"
                value={matchDayId}
                onChange={(e) => {
                  setMatchDayId(e.target.value);
                  setMatchId("");
                }}
                className={selectClass}
                data-testid="dispute-match-day"
              >
                {matchDays.map((md) => (
                  <option key={md.id} value={md.id}>
                    {md.matchDate}
                    {md.venueName ? ` · ${md.venueName}` : ""}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField
              label="Match"
              hint="Pick the fixture this dispute is about."
            >
              <select
                name="subjectId"
                value={matchId}
                onChange={(e) => setMatchId(e.target.value)}
                className={selectClass}
                data-testid="dispute-match"
                required
              >
                <option value="">— choose match —</option>
                {matchesForDay.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </FormField>
          </>
        )
      ) : null}

      {subjectType === "sanction" ? (
        sanctions.length === 0 ? (
          <p
            className="text-xs text-[var(--chalk-3)]"
            data-testid="dispute-no-sanctions"
          >
            You have no active sanctions on record. Pick &quot;Other&quot; if
            you want to dispute something else.
          </p>
        ) : (
          <FormField
            label="Sanction"
            hint="Pick the sanction issued against you that you want to contest."
          >
            <select
              name="subjectId"
              value={sanctionId}
              onChange={(e) => setSanctionId(e.target.value)}
              className={selectClass}
              data-testid="dispute-sanction"
              required
            >
              <option value="">— choose sanction —</option>
              {sanctions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </FormField>
        )
      ) : null}

      {/*
        `subjectId` must always appear in FormData even on "other"/
        "registration", because the form action reads `fd.get("subjectId")`.
        We render a hidden empty input for the non-picker cases.
      */}
      {subjectType === "registration" || subjectType === "other" ? (
        <input type="hidden" name="subjectId" value="" />
      ) : null}

      {/* Fallback hidden when picker is empty but required — keeps submit
          flow consistent without relying on browser-level required. */}
      {subjectType === "match" && matches.length === 0 ? (
        <input type="hidden" name="subjectId" value="" />
      ) : null}
      {subjectType === "sanction" && sanctions.length === 0 ? (
        <input type="hidden" name="subjectId" value="" />
      ) : null}

      <FormField
        label="Title"
        hint="Short summary of the issue (3–200 characters)."
      >
        <input
          type="text"
          name="title"
          required
          minLength={3}
          maxLength={200}
          className={inputClass}
          data-testid="dispute-title-input"
        />
      </FormField>

      <FormField label="Description (min 20 chars)">
        <textarea
          name="description"
          required
          minLength={20}
          maxLength={4000}
          rows={6}
          className={textareaClass}
          data-testid="dispute-description-input"
        />
      </FormField>

      <SignedFileInput
        fieldName="evidencePaths"
        accept="image/*,application/pdf,video/mp4"
        requestUpload={requestEvidenceUploadAction}
        label="Evidence (up to 3 files, 50 MB each)"
        data-testid="dispute-evidence"
        allowMultiple
      />

      {error ? (
        <p className="text-xs text-[var(--flare)]" data-testid="dispute-error">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <PrimaryButton
          type="submit"
          disabled={isPending || (subjectType !== "other" && subjectType !== "registration" && !subjectId)}
          data-testid="dispute-submit-btn"
        >
          Submit dispute
        </PrimaryButton>
        <SecondaryButton type="reset" disabled={isPending}>
          Reset
        </SecondaryButton>
      </div>
    </form>
  );
}
