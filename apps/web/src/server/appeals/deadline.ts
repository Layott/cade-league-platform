import { addBusinessDays } from "@/lib/businessDays";

/**
 * Appeals must be ruled within 5 business days of submission per league policy.
 * Thin wrapper so the constant lives in one place.
 */
export const APPEAL_DEADLINE_BUSINESS_DAYS = 5 as const;

export function computeAppealDeadline(submittedAt: Date | string = new Date()): Date {
  return addBusinessDays(submittedAt, APPEAL_DEADLINE_BUSINESS_DAYS);
}
