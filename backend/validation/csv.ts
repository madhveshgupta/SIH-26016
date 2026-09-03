/** Bulk parcel import. */
import { parcelRowSchema, fieldErrors, type ParcelRow } from "./schemas";

export interface RowError {
  line: number;
  errors: Record<string, string>;
  raw: string;
}

export interface ImportResult {
  rows: ParcelRow[];
  errors: RowError[];
  /** Duplicate khasra numbers within the file itself. */
  duplicates: { line: number; khasraNo: string }[];
}

const REQUIRED = ["khasrano", "villagelgdcode", "declaredareahectares"];

/** Minimal CSV splitter that honours double-quoted fields containing commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseParcelCsv(text: string): ImportResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { rows: [], errors: [{ line: 0, errors: { _: "File is empty" }, raw: "" }], duplicates: [] };
  }

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  const missing = REQUIRED.filter((r) => !header.includes(r));
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [
        {
          line: 1,
          errors: { _: `Missing required column(s): ${missing.join(", ")}` },
          raw: lines[0],
        },
      ],
      duplicates: [],
    };
  }

  const rows: ParcelRow[] = [];
  const errors: RowError[] = [];
  const duplicates: { line: number; khasraNo: string }[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const rec: Record<string, unknown> = {};
    header.forEach((h, idx) => {
      const v = cells[idx] ?? "";
      if (h === "declaredareahectares") rec.declaredAreaHectares = v === "" ? undefined : Number(v);
      else if (h === "khasrano") rec.khasraNo = v;
      else if (h === "villagelgdcode") rec.villageLgdCode = v;
      else if (h === "landuse") rec.landUse = v ? v.toUpperCase() : undefined;
      else if (h === "ownername") rec.ownerName = v || undefined;
    });

    const parsed = parcelRowSchema.safeParse(rec);
    if (!parsed.success) {
      errors.push({ line: i + 1, errors: fieldErrors(parsed.error), raw: lines[i] });
      continue;
    }

    // Two rows claiming the same plot in the same village is either a mistake or a deliberate
    // double-claim.
    const key = `${parsed.data.villageLgdCode}:${parsed.data.khasraNo}`;
    if (seen.has(key)) {
      duplicates.push({ line: i + 1, khasraNo: parsed.data.khasraNo });
      continue;
    }
    seen.add(key);
    rows.push(parsed.data);
  }

  return { rows, errors, duplicates };
}
