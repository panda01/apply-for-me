/**
 * Section-by-section visual diff using ImageMagick `magick compare`.
 *
 * Strategy (per user direction):
 *   1) Crop the reference and implementation screenshots into named sections
 *      (header, sidebar, content, etc.) so we don't compare whole pages at once.
 *   2) For each (ref-section, impl-section) pair, run `magick compare -metric AE`
 *      at progressively larger Gaussian blur sigmas (0, 2, 4, 6, 8, 10 px).
 *      Smaller-than-10px sigmas catch fine-grained pixel mismatches; larger
 *      sigmas only fail when the broad structure of the section is wrong.
 *   3) Report each section's AE at each blur level + the diff PNG file. A section
 *      "matches" if AE drops to a small fraction of section pixel count by blur 8.
 *
 * Output:
 *   claude_tmp/diff/<surface>/<section>__<blur>.png  (diff visualization)
 *   claude_tmp/design_diff_report.md                  (aggregate markdown report)
 *
 * Run with: npx tsx tests/playwright/__design_refs__/diff-sections.mts
 */
import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..", "..", "..");
const REF_DIR = __dirname;
const IMPL_DIR = resolve(PROJECT_ROOT, "claude_tmp/impl_screenshots");
const DIFF_DIR = resolve(PROJECT_ROOT, "claude_tmp/diff");
const REPORT_PATH = resolve(PROJECT_ROOT, "claude_tmp/design_diff_report.md");

interface CropDef {
  /** Section name used in output filenames and the report. */
  name: string;
  /** ImageMagick geometry string in the form WxH+X+Y. */
  geometry: string;
}

interface SurfaceDef {
  /** Surface name — matches the PNG stem in both REF_DIR and IMPL_DIR. */
  name: string;
  /** Section crops applied to BOTH ref and impl for this surface. */
  crops: CropDef[];
}

/** Blur sigmas (in pixels) tried sequentially. */
const BLUR_SIGMAS = [0, 2, 4, 6, 8, 10] as const;

/**
 * Section crops per surface. The screenshots are captured at 1440x900 so the
 * geometries below assume that resolution. The shell has 232px sidebar +
 * 52px topbar; everything below is the content area.
 */
const SURFACES: SurfaceDef[] = [
  {
    name: "shell",
    crops: [
      { name: "sidebar", geometry: "232x900+0+0" },
      { name: "topbar", geometry: "1208x52+232+0" },
      { name: "content", geometry: "1208x848+232+52" },
    ],
  },
  {
    name: "sidebar-collapsed",
    crops: [
      { name: "sidebar", geometry: "56x900+0+0" },
      { name: "topbar", geometry: "1384x52+56+0" },
      { name: "content", geometry: "1384x848+56+52" },
    ],
  },
  {
    name: "jobs",
    crops: [
      { name: "sidebar", geometry: "232x900+0+0" },
      { name: "topbar", geometry: "1208x52+232+0" },
      { name: "page-head", geometry: "1208x96+232+52" },
      { name: "tabs", geometry: "1208x48+232+148" },
      { name: "table", geometry: "1208x704+232+196" },
    ],
  },
  {
    name: "job-detail",
    crops: [
      { name: "sidebar", geometry: "232x900+0+0" },
      { name: "topbar", geometry: "1208x52+232+0" },
      { name: "header", geometry: "1208x120+232+52" },
      { name: "main-col", geometry: "908x728+232+172" },
      { name: "side-col", geometry: "300x728+1140+172" },
    ],
  },
];

interface SectionResult {
  surface: string;
  section: string;
  geometry: string;
  /** AE at each blur sigma (parallel to BLUR_SIGMAS). NaN means compare failed. */
  ae: number[];
  /** Total pixel count for the cropped section (W*H from geometry). */
  pixels: number;
}

/**
 * Parse a "WxH+X+Y" geometry string into pixel count W*H.
 *
 * @param {string} geo - Geometry string in the WxH+X+Y form.
 * @returns {number} Pixel count W*H, or 0 if the string is malformed.
 */
function pixelsFromGeometry(geo: string): number {
  const m = /^(\d+)x(\d+)/.exec(geo);
  if (!m) return 0;
  return parseInt(m[1]!, 10) * parseInt(m[2]!, 10);
}

/**
 * Crop a source PNG to the given geometry and write it to outPath.
 *
 * @param {string} src - Source PNG path.
 * @param {string} geometry - ImageMagick geometry string (WxH+X+Y).
 * @param {string} outPath - Destination PNG path.
 */
function crop(src: string, geometry: string, outPath: string): void {
  execSync(`magick "${src}" -crop "${geometry}" +repage "${outPath}"`, { stdio: "pipe" });
}

/**
 * Compute the AE (absolute error pixel count) between two PNGs at a given Gaussian blur sigma.
 * Writes the diff visualization to diffOut.
 *
 * @param {string} refPath - Reference PNG (cropped).
 * @param {string} implPath - Implementation PNG (cropped).
 * @param {number} sigma - Gaussian blur sigma in pixels. 0 = no blur.
 * @param {string} diffOut - Destination PNG for the diff visualization.
 * @returns {number} AE (number of differing pixels). NaN on compare failure.
 */
/**
 * Pre-blur a PNG to the given sigma and write it to `outPath`. Sigma 0 is a passthrough copy.
 * `magick compare` doesn't accept `-blur` inside its argument list, so we materialize the
 * blurred image first and feed those temp files into compare.
 *
 * @param {string} src - Source PNG.
 * @param {number} sigma - Gaussian blur sigma in pixels (0 = no blur).
 * @param {string} outPath - Destination PNG path.
 */
function preBlur(src: string, sigma: number, outPath: string): void {
  if (sigma === 0) {
    execSync(`magick "${src}" "${outPath}"`, { stdio: "pipe" });
  } else {
    execSync(`magick "${src}" -blur 0x${String(sigma)} "${outPath}"`, { stdio: "pipe" });
  }
}

function compareAE(refPath: string, implPath: string, sigma: number, diffOut: string): number {
  // Materialize blurred copies, then compare them. `magick compare` writes the AE count
  // (followed by a parenthesized fraction) to stderr and returns non-zero when images differ.
  const refBlur = diffOut.replace(/\.png$/, "__refblur.png");
  const implBlur = diffOut.replace(/\.png$/, "__implblur.png");
  preBlur(refPath, sigma, refBlur);
  preBlur(implPath, sigma, implBlur);
  const cmd = `magick compare -metric AE -fuzz 3% "${refBlur}" "${implBlur}" "${diffOut}" 2>&1`;
  const out = spawnSync("bash", ["-c", cmd], { encoding: "utf8" });
  const combined = (out.stdout || "") + (out.stderr || "");
  const m = /^\s*([0-9]+(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?)/m.exec(combined);
  if (!m) return Number.NaN;
  return parseFloat(m[1]!);
}

function main(): void {
  if (!existsSync(IMPL_DIR)) {
    console.error(`Implementation screenshots not found at ${IMPL_DIR}. Run capture-impl.mts first.`);
    process.exit(1);
  }
  mkdirSync(DIFF_DIR, { recursive: true });

  const results: SectionResult[] = [];

  for (const surface of SURFACES) {
    const refPath = resolve(REF_DIR, `${surface.name}.png`);
    const implPath = resolve(IMPL_DIR, `${surface.name}.png`);
    if (!existsSync(refPath) || !existsSync(implPath)) {
      console.warn(`skipping ${surface.name} (missing ref or impl)`);
      continue;
    }
    const surfaceDir = resolve(DIFF_DIR, surface.name);
    mkdirSync(surfaceDir, { recursive: true });

    for (const sec of surface.crops) {
      const refCrop = resolve(surfaceDir, `${sec.name}__ref.png`);
      const implCrop = resolve(surfaceDir, `${sec.name}__impl.png`);
      crop(refPath, sec.geometry, refCrop);
      crop(implPath, sec.geometry, implCrop);

      const aePerBlur: number[] = [];
      for (const sigma of BLUR_SIGMAS) {
        const diffPath = resolve(surfaceDir, `${sec.name}__blur${sigma}.png`);
        const ae = compareAE(refCrop, implCrop, sigma, diffPath);
        aePerBlur.push(ae);
      }
      results.push({
        surface: surface.name,
        section: sec.name,
        geometry: sec.geometry,
        ae: aePerBlur,
        pixels: pixelsFromGeometry(sec.geometry),
      });
      console.log(`  ${surface.name}/${sec.name}  AE@blur:`, aePerBlur.map((v) => v.toFixed(0)).join("  "));
    }
  }

  // Markdown report
  const lines: string[] = [];
  lines.push("# Design vs implementation pixel diff");
  lines.push("");
  lines.push("Section-by-section comparison using `magick compare -metric AE -fuzz 3%` after");
  lines.push("pre-blurring each cropped section with Gaussian sigmas of " + BLUR_SIGMAS.join(", ") + " px.");
  lines.push("");
  lines.push("**How to read this:**");
  lines.push("");
  lines.push("- *AE@σ0* is the strict pixel compare — expect tens-of-thousands of pixels of");
  lines.push("  difference even for visually-identical sections because font antialiasing,");
  lines.push("  subpixel rendering, and any text-content delta accounts for the bulk of it.");
  lines.push("- *AE@σ10* is the broad-structure compare — only large-scale shape, position,");
  lines.push("  and color differences survive heavy blurring.");
  lines.push("- A section's **structure matches** if AE generally falls as the blur increases");
  lines.push("  (verdict ✅): the underlying layout is right, only fine-grain detail or text");
  lines.push("  content differs. **Structure mismatch** if AE stays flat or rises (⚠️): the");
  lines.push("  shapes are positioned differently and no amount of blurring can hide it.");
  lines.push("");
  lines.push("The reference shots were captured against the design's seed data (Sofia Reyes,");
  lines.push("Senior Product Designer, etc.). The implementation shots are taken against the");
  lines.push("real backend, so content-area sections (`content`, `table`, `main-col`) reflect");
  lines.push("different *content*. Treat ⚠️ verdicts on those sections as expected.");
  lines.push("");
  lines.push("| Surface | Section | Pixels | " + BLUR_SIGMAS.map((s) => `AE@σ${s}`).join(" | ") + " | Verdict |");
  lines.push("|---|---|---:|" + BLUR_SIGMAS.map(() => "---:").join("|") + "|---|");
  for (const r of results) {
    if (r.ae.some((v) => Number.isNaN(v))) {
      const aeCols = r.ae.map((v) => Number.isNaN(v) ? "—" : v.toFixed(0)).join(" | ");
      lines.push(`| ${r.surface} | ${r.section} | ${r.pixels} | ${aeCols} | ERROR |`);
      continue;
    }
    const ae0 = r.ae[0]!;
    const aeMax = r.ae[r.ae.length - 1]!;
    const monotonicallyDown = r.ae.every((v, i) => i === 0 || v <= r.ae[i - 1]! * 1.05);
    const settled = aeMax < r.pixels * 0.05;
    const ratio = aeMax / Math.max(ae0, 1);
    let verdict: string;
    if (settled) {
      verdict = "✅ match";
    } else if (monotonicallyDown && ratio < 0.5) {
      verdict = "✅ structure ok (text differs)";
    } else if (ratio < 1.2) {
      verdict = "△ partial";
    } else {
      verdict = "⚠️ structure differs";
    }
    const aeCols = r.ae.map((v) => v.toFixed(0)).join(" | ");
    lines.push(`| ${r.surface} | ${r.section} | ${r.pixels} | ${aeCols} | ${verdict} |`);
  }
  lines.push("");
  lines.push("Per-section ref/impl/diff crops live in `claude_tmp/diff/<surface>/`.");
  writeFileSync(REPORT_PATH, lines.join("\n"));
  console.log(`\nReport written to ${REPORT_PATH}`);
}

main();
