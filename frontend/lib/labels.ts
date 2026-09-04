export const ACT_LABEL: Record<string, string> = {
  LARR_2013: "LARR Act 2013",
  NH_ACT_1956: "National Highways Act 1956",
  RAILWAYS_ACT_1989: "Railways Act 1989",
  STATE_ACT: "State Act",
};

export const typeLabel = (t: string) =>
  t.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
