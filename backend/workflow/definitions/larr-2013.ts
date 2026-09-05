/**
 * The Right to Fair Compensation and Transparency in Land Acquisition, Rehabilitation and
 * Resettlement Act, 2013.
 */
import type { WorkflowDefinition } from "../types";

export const LARR_2013: WorkflowDefinition = {
  act: "LARR_2013",
  name: "LARR Act 2013",
  citation:
    "Right to Fair Compensation and Transparency in Land Acquisition, Rehabilitation and Resettlement Act, 2013",
  stages: [
    {
      status: "DRAFT",
      label: "Draft proposal",
      actors: ["LAND_REQUIRING_BODY", "SUPER_ADMIN"],
      slaDays: 30,
      next: ["SUBMITTED"],
      note: "Prepared by the body that needs the land. Not yet before any authority.",
    },
    {
      status: "SUBMITTED",
      label: "Submitted to district",
      actors: ["LAND_REQUIRING_BODY", "SUPER_ADMIN"],
      slaDays: 3,
      next: ["DISTRICT_SCRUTINY"],
    },
    {
      status: "DISTRICT_SCRUTINY",
      label: "District scrutiny",
      actors: ["DISTRICT_COLLECTOR", "LAND_ACQUIRING_AUTHORITY", "SUPER_ADMIN"],
      slaDays: 21,
      next: ["RETURNED_FOR_CLARIFICATION", "REJECTED", "SIA_ORDERED"],
      note: "Checklist-driven verification of the proposal and its documents.",
    },
    {
      status: "SIA_ORDERED",
      label: "Social Impact Assessment ordered",
      section: "s.4(2)",
      actors: ["DISTRICT_COLLECTOR", "STATE_GOVERNMENT", "SUPER_ADMIN"],
      slaDays: 14,
      next: ["SIA_STUDY"],
      note: "s.4(1) is the duty to carry out the study; s.4(2) is the notification that is published.",
    },
    {
      status: "SIA_STUDY",
      label: "SIA study in progress",
      section: "s.4(2)",
      actors: ["LAND_ACQUIRING_AUTHORITY", "SUPER_ADMIN"],
      slaDays: 180,
      statutoryDays: 180, // six months
      onBreach: "ESCALATE",
      next: ["SIA_APPRAISAL"],
      note: "The Act allows six months for the study. CAG has recorded real delays of 11–46 months at this stage.",
    },
    {
      status: "SIA_APPRAISAL",
      label: "Expert Group appraisal",
      section: "s.7",
      actors: ["STATE_GOVERNMENT", "SUPER_ADMIN"],
      slaDays: 60,
      statutoryDays: 60, // two months
      onBreach: "ESCALATE",
      next: ["REJECTED", "STATE_APPROVAL"],
      note: "An independent Expert Group must report within two months.",
    },
    {
      status: "STATE_APPROVAL",
      label: "State government approval",
      actors: ["STATE_GOVERNMENT", "CENTRAL_MINISTRY", "SUPER_ADMIN"],
      slaDays: 30,
      next: ["RETURNED_FOR_CLARIFICATION", "REJECTED", "SEC_11_PRELIM_NOTIFICATION"],
    },
    {
      status: "SEC_11_PRELIM_NOTIFICATION",
      label: "Preliminary notification issued",
      section: "s.11",
      actors: ["DISTRICT_COLLECTOR", "SUPER_ADMIN"],
      slaDays: 30,
      statutoryDays: 365, // must follow appraisal within 12 months
      onBreach: "RESCIND",
      next: ["OBJECTIONS"],
      note: "Must be issued within 12 months of the SIA appraisal. From this date the land cannot be sold or transferred.",
    },
    {
      status: "OBJECTIONS",
      label: "Objections period",
      section: "s.15",
      actors: ["DISTRICT_COLLECTOR", "LAND_ACQUIRING_AUTHORITY", "SUPER_ADMIN"],
      slaDays: 60,
      statutoryDays: 60,
      onBreach: "ESCALATE",
      next: ["REJECTED", "SEC_19_DECLARATION"],
      note: "Affected persons have 60 days to object and must be heard. Missed hearings are a common ground for a court quashing the acquisition.",
    },
    {
      status: "SEC_19_DECLARATION",
      label: "Declaration of intended acquisition",
      section: "s.19",
      actors: ["STATE_GOVERNMENT", "DISTRICT_COLLECTOR", "SUPER_ADMIN"],
      slaDays: 30,
      statutoryDays: 365, // within 12 months of s.11
      onBreach: "RESCIND",
      next: ["SEC_21_NOTICE"],
      note: "Within 12 months of the s.11 notification, else that notification stands rescinded. Starts the 12-month clock to the award.",
    },
    {
      status: "SEC_21_NOTICE",
      label: "Notice to persons interested",
      section: "s.21",
      actors: ["DISTRICT_COLLECTOR", "SUPER_ADMIN"],
      slaDays: 30,
      next: ["AWARD_ENQUIRY"],
      note: "Every affected owner must be individually notified. Miss one and that acquisition can be struck down.",
    },
    {
      status: "AWARD_ENQUIRY",
      label: "Award enquiry",
      section: "s.23",
      actors: ["DISTRICT_COLLECTOR", "SUPER_ADMIN"],
      slaDays: 90,
      next: ["AWARD_DECLARED"],
    },
    {
      status: "AWARD_DECLARED",
      label: "Award declared",
      section: "s.23–25",
      actors: ["DISTRICT_COLLECTOR", "SUPER_ADMIN"],
      slaDays: 30,
      statutoryDays: 365, // 12 months from s.19 declaration
      onBreach: "LAPSE",
      next: ["COMPENSATION_DISBURSEMENT"],
      note: "⚠️ THE CRITICAL DEADLINE. The award must be made within 12 months of the s.19 declaration, or under s.25 the proceedings LAPSE entirely.",
    },
    {
      status: "COMPENSATION_DISBURSEMENT",
      label: "Compensation disbursement",
      section: "s.38(1)",
      actors: ["DISTRICT_COLLECTOR", "LAND_ACQUIRING_AUTHORITY", "SUPER_ADMIN"],
      slaDays: 90,
      statutoryDays: 90, // three months — s.38(1)
      onBreach: "ESCALATE",
      next: ["RNR_IMPLEMENTATION"],
      note: "s.38(1): compensation must be paid within three months of the award. The amount itself is assessed under ss.26–30.",
    },
    {
      status: "RNR_IMPLEMENTATION",
      label: "Rehabilitation & Resettlement",
      section: "s.38(1)",
      actors: ["REHABILITATION_AUTHORITY", "DISTRICT_COLLECTOR", "SUPER_ADMIN"],
      slaDays: 180,
      statutoryDays: 180, // six months for monetary R&R — s.38(1)
      onBreach: "ESCALATE",
      next: ["POSSESSION"],
      note: "s.38(1): monetary R&R entitlements are due within six months of the award. The entitlements themselves are set by the R&R award under s.31 and the Second Schedule.",
    },
    {
      status: "POSSESSION",
      label: "Possession taken",
      section: "s.38",
      actors: ["DISTRICT_COLLECTOR", "SUPER_ADMIN"],
      slaDays: 30,
      next: ["CLOSED"],
      note: "Possession may only be taken AFTER compensation is paid in full. The system blocks it otherwise.",
    },
    {
      status: "CLOSED",
      label: "Closed",
      actors: ["SUPER_ADMIN"],
      slaDays: 0,
      next: [],
    },
  ],
};
