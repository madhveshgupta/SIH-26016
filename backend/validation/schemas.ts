/** Shared validation. */
import { z } from "zod";

/** Area is always hectares to 4 decimal places. */
export const areaHectares = z
  .number({ message: "Area is required" })
  .positive("Area must be greater than zero")
  .max(1_000_000, "Area looks implausible (over 1 million hectares)")
  .refine((n) => Number(n.toFixed(4)) === n, "Area is limited to 4 decimal places (hectares)");

export const rupees = z
  .number()
  .nonnegative("Amount cannot be negative")
  .max(1e15, "Amount looks implausible");

/**
 * Khasra / survey number formats vary by state, which is exactly why a single loose regex would
 * let bad data in.
 */
export const khasraNo = z
  .string()
  .trim()
  .min(1, "Khasra/survey number is required")
  .max(40)
  .regex(/^[0-9]+([/\-][0-9A-Za-z]+)*$/, "Expected a format like 347 or 347/8");

export const lgdCode = z.string().trim().regex(/^\d{1,8}$/, "LGD codes are numeric");

export const projectTypes = [
  "HIGHWAY", "RAILWAY", "IRRIGATION", "INDUSTRIAL_CORRIDOR",
  "URBAN_DEVELOPMENT", "RENEWABLE_ENERGY", "MINING", "DEFENCE", "OTHER",
] as const;

export const acquisitionActs = [
  "LARR_2013", "NH_ACT_1956", "RAILWAYS_ACT_1989", "STATE_ACT",
] as const;

export const projectSchema = z
  .object({
    name: z.string().trim().min(5, "Give the project a recognisable name").max(300),
    description: z.string().trim().max(2000).optional(),
    type: z.enum(projectTypes),
    governingAct: z.enum(acquisitionActs),
    agencyId: z.string().min(1, "Select the implementing agency"),
    ministryId: z.string().optional(),
    estimatedAreaHectares: areaHectares.optional(),
    estimatedCostCrore: rupees.optional(),
    isPPP: z.boolean().default(false),
    isPrivateCompany: z.boolean().default(false),
    stateIds: z.array(z.string()).min(1, "Select at least one State or UT"),
    districtIds: z.array(z.string()).default([]),
  })
  /** Highways are acquired under the National Highways Act 1956, not LARR 2013. */
  .refine((v) => v.type !== "HIGHWAY" || v.governingAct === "NH_ACT_1956", {
    message: "Highway projects are acquired under the National Highways Act 1956, not LARR 2013",
    path: ["governingAct"],
  })
  .refine((v) => v.governingAct !== "NH_ACT_1956" || v.type === "HIGHWAY", {
    message: "The National Highways Act 1956 applies to highway projects only",
    path: ["governingAct"],
  })
  /** LARR s.2(2): 70% consent for PPP, 80% for private companies. */
  .refine((v) => !(v.isPPP && v.isPrivateCompany), {
    message: "A project cannot be both a PPP and a private-company acquisition",
    path: ["isPrivateCompany"],
  });

export type ProjectInput = z.infer<typeof projectSchema>;

export const proposalSchema = z
  .object({
    projectId: z.string().min(1, "Select the project"),
    purpose: z.string().trim().min(10, "State the purpose of the acquisition").max(2000),
    /** Land may only be taken for a genuine public purpose. */
    publicInterestNote: z
      .string()
      .trim()
      .min(30, "Explain the public purpose — this is the legal basis for the acquisition")
      .max(4000),
    proposedAreaHectares: areaHectares,
    requiresSIA: z.boolean().default(true),
    isUrgency: z.boolean().default(false),
  })
  /**
   * The urgency clause (LARR s.40 / NH Act) skips stages including the social impact assessment.
   */
  .refine((v) => !(v.isUrgency && v.requiresSIA), {
    message:
      "An urgency acquisition bypasses the Social Impact Assessment — untick SIA, or drop urgency",
    path: ["isUrgency"],
  });

export type ProposalInput = z.infer<typeof proposalSchema>;

/** One parcel row from a bulk CSV import. */
export const parcelRowSchema = z.object({
  khasraNo,
  villageLgdCode: lgdCode,
  declaredAreaHectares: areaHectares,
  landUse: z
    .enum(["IRRIGATED", "DRY", "BARREN", "HOMESTEAD", "COMMERCIAL", "INDUSTRIAL", "FOREST", "WATER_BODY"])
    .default("DRY"),
  ownerName: z.string().trim().min(2).max(200).optional(),
});

export type ParcelRow = z.infer<typeof parcelRowSchema>;

/** Flatten a ZodError into `field → message` for form display. */
export function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
