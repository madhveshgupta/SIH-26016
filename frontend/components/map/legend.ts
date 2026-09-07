/** Map colours — kept in step with backend/gis/parcels.ts STATUS_COLOUR. */
export const STATUS_COLOUR: Record<string, string> = {
  PROPOSED: "#94a3b8",
  NOTIFIED: "#f59e0b",
  OBJECTED: "#a855f7",
  AWARD_DECLARED: "#3b82f6",
  COMPENSATED: "#10b981",
  POSSESSED: "#047857",
  DISPUTED: "#ef4444",
  WITHDRAWN: "#d4d4d8",
};

export const STATUS_LABEL: Record<string, string> = {
  PROPOSED: "Proposed",
  NOTIFIED: "Notified",
  OBJECTED: "Under objection",
  AWARD_DECLARED: "Award declared",
  COMPENSATED: "Compensated",
  POSSESSED: "Possessed",
  DISPUTED: "Disputed",
  WITHDRAWN: "Withdrawn",
};

/** Acquisition order — the order a parcel moves through. */
export const STATUS_ORDER = [
  "PROPOSED", "NOTIFIED", "OBJECTED", "AWARD_DECLARED", "COMPENSATED", "POSSESSED", "DISPUTED",
] as const;

const PROJECT_PALETTE = ["#38bdf8", "#f472b6", "#a3e635", "#fb923c", "#c084fc", "#facc15"];

export function projectColour(index: number): string {
  return PROJECT_PALETTE[((index % PROJECT_PALETTE.length) + PROJECT_PALETTE.length) % PROJECT_PALETTE.length];
}

/** Badge tone per status: amber while pending, green once settled, red only for a dispute. */
export const STATUS_TONE: Record<string, "warning" | "success" | "danger"> = {
  NOTIFIED: "warning",
  OBJECTED: "warning",
  AWARD_DECLARED: "warning",
  COMPENSATED: "success",
  POSSESSED: "success",
  DISPUTED: "danger",
};
