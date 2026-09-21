/**
 * Find English text that reaches the screen without going through the dictionary — the check
 * behind "every screen is translated".
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import ts from "typescript";

const args = process.argv.slice(2);
const list = args.includes("--list");
const prefix = args.find((a) => !a.startsWith("--")) ?? "";

const files = execSync("git ls-files frontend/app frontend/components", { encoding: "utf8" })
  .split("\n")
  .filter((f) => f.endsWith(".tsx") && f.startsWith(prefix || "frontend"));

/** Attributes whose string value is never shown as text. */
const NOT_TEXT_ATTR = new Set([
  "className", "href", "src", "id", "key", "type", "name", "role", "variant", "size", "tone", "method", "action", "target",
  "rel", "htmlFor", "autoComplete", "inputMode", "lang", "dir", "fill", "stroke", "d", "viewBox", "points", "xmlns",
  "pattern", "accept", "form", "encType", "as", "align", "loading", "sizes", "crossOrigin", "referrerPolicy",
  "strokeLinecap", "strokeLinejoin", "clipRule", "fillRule", "transform", "gradientUnits", "offset", "stopColor",
  "clipPath", "filter", "mask", "mode", "layout", "icon", "defaultValue", "value", "min", "max", "step", "width", "height",
  "x", "y", "cx", "cy", "r", "rx", "ry", "x1", "x2", "y1", "y2", "dx", "dy", "floodColor", "stdDeviation", "preserveAspectRatio",
  "colSpan", "rowSpan", "scope", "sandbox", "allow", "download", "capture", "spellCheck", "wrap", "list", "shape", "coords",
  "aria-hidden", "aria-current", "aria-live", "aria-controls", "aria-describedby", "aria-labelledby", "aria-haspopup",
  "aria-expanded", "aria-pressed", "aria-selected", "aria-modal", "aria-orientation", "aria-sort", "aria-valuenow",
  "aria-busy", "aria-atomic", "aria-relevant", "aria-owns", "aria-activedescendant", "initial", "initialStatus",
  "initialMetric", "source", "section", "current", "stickyTop", "anchor", "mapHeight", "dataKey", "stackId", "position",
  "accessibilityLayer", "direction", "k", "widget", "format", "nameKey", "iconType", "orientation", "textAnchor", "dominantBaseline", "fontFamily", "fontWeight", "letterSpacing",
]);
/** Object properties whose string value is shown as text. */
const TEXT_PROP = new Set([
  "label", "title", "description", "hint", "text", "message", "placeholder", "question", "help", "legal", "summary",
  "heading", "note", "caption", "empty", "emptyText", "error", "tooltip", "subtitle", "intro", "body", "detail", "details",
  "reason", "cta", "prompt", "confirm", "confirmLabel", "cancelLabel", "switchLabel", "todayLabel", "name",
  "short", "long", "blurb", "why", "what", "tip", "suffix", "prefix", "unit", "verdict", "headline",
]);
/** Words that stay as they are in every language. */
const KEEP = /\b(?:Bhoomi|Bhoomi|Nayan|Bhoomi Nayan|Mitra|Saarthi|LARR|RFCTLARR|NH|CALA|LAO|NHAI|PFMS|ULPIN|GIS|SIH|OTP|PDF|CSV|XLSX|KML|GeoJSON|Shapefile|SMS|UTR|IFSC|DBT|MoRTH|MoRD|DoLR|CAG|PIB|OSM|Esri|Bhuvan|ISRO|NIC|MeghRaj|Cesium|WebGL|PWA|API|URL|UP|km|ha|sq|AUC|MAPE|XGBoost|SHAP|Excel|ML|AI|ID|No|s\.\d+\w*(?:\(\w+\))*|ss\.\s?\d+(?:–\d+)?|Sec\.?\s?\d+)\b/g;

const isKey = (s: string) => /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/.test(s);
const isUrlOrPath = (s: string) => /^(\/|https?:|mailto:|tel:|#|\.\/|\.\.\/|@|data:)/.test(s.trim());
const isClassLike = (s: string) => {
  if (/[A-Z]/.test(s.replace(/\[[^\]]*\]/g, ""))) return false;
  const tokens = s.trim().split(/\s+/);
  return tokens.length > 0 && tokens.filter((t) => /[-:\[\]\/]/.test(t) || /^(flex|grid|block|hidden|relative|absolute|fixed|sticky|border|rounded|shadow|truncate|uppercase|italic|underline|transition|grow|shrink|inline|contents|invisible|visible|static|antialiased|group|peer|container|ring|outline|resize|select-none|capitalize|lowercase|tabular-nums|prose|dark|sr-only|isolate)$/.test(t)).length >= Math.ceil(tokens.length / 2);
};
/** Has words a reader would read — after the words that never change are removed. */
const hasWords = (s: string, minWords: number) => {
  // Imagery and map credits ("© OpenStreetMap contributors") are the licensor's
  // required wording and stay as published.
  if (s.includes("©") || s.includes("&copy;")) return false;
  // Sample addresses in a placeholder are not words.
  if (/^[\w.+-]+@[\w.-]+(,\s*[\w.+-]+@[\w.-]+)*$/.test(s.trim())) return false;
  // Markup and entities are not words; neither are the codes that never change.
  const cleaned = s.replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/g, " ").replace(KEEP, " ");
  const words = cleaned.match(/[A-Za-z][a-z]{1,}/g) ?? [];
  return words.length >= minWords && /[a-z]{2,}/.test(cleaned);
};

type Hit = { file: string; line: number; kind: string; text: string };
const hits: Hit[] = [];

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const report = (node: ts.Node, kind: string, text: string) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart()).line;
    if (/i18n-ignore/.test(lines[line] ?? "") || /i18n-ignore/.test(lines[line - 1] ?? "")) return;
    hits.push({ file, line: line + 1, kind, text: text.replace(/\s+/g, " ").trim().slice(0, 90) });
  };
  const inside = (node: ts.Node, test: (n: ts.Node) => boolean) => {
    for (let p = node.parent; p; p = p.parent) if (test(p)) return true;
    return false;
  };
  const skipContext = (node: ts.Node) =>
    inside(node, (p) =>
      (ts.isJsxAttribute(p) && NOT_TEXT_ATTR.has(p.name.getText(sf))) ||
      ts.isImportDeclaration(p) || ts.isExportDeclaration(p) ||
      (ts.isCallExpression(p) && /^(cn|clsx|console\.\w+|fetch|require|t|tk|useT|translate|new URL|URLSearchParams|encodeURIComponent|dynamic|import|searchParams\.get|headers\.get|getItem|setItem|removeItem|matchMedia|querySelector|addEventListener|removeEventListener|getElementById|createElement|setAttribute|Intl\.\w+|toLocaleString|toLocaleDateString)$/.test(p.expression.getText(sf))) ||
      ts.isTypeNode(p) || ts.isLiteralTypeNode(p) ||
      (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken].includes(p.operatorToken.kind)) ||
      ts.isCaseClause(p) || ts.isElementAccessExpression(p) ||
      // SQL and other tagged templates (prisma.$queryRaw`…`) are code.
      ts.isTaggedTemplateExpression(p),
    );

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      const text = node.getText(sf);
      if (hasWords(text, 1)) report(node, "jsx", text);
    } else if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const name = node.name.getText(sf);
      const value = node.initializer.text;
      if (!NOT_TEXT_ATTR.has(name) && !name.startsWith("data-") && !isKey(value) && !isUrlOrPath(value) && !isClassLike(value) && hasWords(value, 1)) {
        report(node, `attr ${name}`, value);
      }
    } else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) && !ts.isJsxAttribute(node.parent)) {
      // A template's own text is its literal parts; what is inside ${…} is code.
      const value = ts.isTemplateExpression(node) ? [node.head.text, ...node.templateSpans.map((sp) => sp.literal.text)].join("") : node.text;
      const directive = ts.isExpressionStatement(node.parent) && /^use (client|server)$/.test(value);
      const cookieLike = /=[^\s]*;\s*(path|max-age|samesite|expires)=/i.test(value);
      const sortOrder = value === "asc" || value === "desc";
      const cssBlock = /[.#][\w-]+[^{]*\{[^}]*:[^}]*;/.test(value);
      const cssValue = /^\s*(repeating-)?(linear|radial|conic)-gradient\(|^\s*(max|min|clamp|calc|var|rgba?|hsla?|url|translate\w*|rotate|scale)\(|^\d+(\.\d+)?(px|rem|em|%)\s+(solid|dashed|dotted)\b/.test(value);
      if (!directive && !cookieLike && !sortOrder && !cssValue && !cssBlock && !isKey(value) && !isUrlOrPath(value) && !isClassLike(value) && !skipContext(node)) {
        const parent = node.parent;
        const prop = ts.isPropertyAssignment(parent) && parent.initializer === node ? parent.name.getText(sf).replace(/["']/g, "") : null;
        if (prop && TEXT_PROP.has(prop) ? hasWords(value, 1) : hasWords(value, 2) && /\s/.test(value)) {
          if (!(ts.isPropertyAssignment(parent) && parent.name === node)) report(node, prop ? `prop ${prop}` : "string", value);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

const byFile = new Map<string, number>();
for (const h of hits) byFile.set(h.file, (byFile.get(h.file) ?? 0) + 1);
if (list) for (const h of hits) console.log(`${h.file}:${h.line}  [${h.kind}]  ${h.text}`);
else {
  for (const [f, n] of [...byFile].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(4)}  ${f}`);
}
console.log(`\n${hits.length} untranslated string(s) in ${byFile.size} file(s)`);
process.exit(hits.length ? 1 : 0);
