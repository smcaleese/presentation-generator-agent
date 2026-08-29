import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// `soffice` is on PATH in the Docker image; on macOS dev machines it usually
// isn't, so fall back to the app bundle. Override with SOFFICE_BIN if needed.
function sofficeBin(): string {
  if (process.env.SOFFICE_BIN) return process.env.SOFFICE_BIN;
  const mac = "/Applications/LibreOffice.app/Contents/MacOS/soffice";
  return existsSync(mac) ? mac : "soffice";
}

export interface RenderResult {
  pdfBytes: Buffer;
  slidePngs: Buffer[]; // one per slide, in order
}

/**
 * Convert a .pptx (produced in the sandbox) to a PDF and one PNG per slide.
 * Runs on the API host — the image ships LibreOffice + poppler-utils.
 */
export async function pptxToSlides(pptx: Buffer): Promise<RenderResult> {
  const dir = await mkdtemp(join(tmpdir(), "deck-"));
  try {
    const pptxPath = join(dir, "deck.pptx");
    await writeFile(pptxPath, pptx);

    // Each conversion gets its own LibreOffice profile so concurrent calls
    // don't deadlock on the single-instance lock.
    const profile = `-env:UserInstallation=file://${join(dir, "lo-profile")}`;
    await run(
      sofficeBin(),
      ["--headless", profile, "--convert-to", "pdf", "--outdir", dir, pptxPath],
      { timeout: 120_000, maxBuffer: 1024 * 1024 * 16 },
    );

    const pdfPath = join(dir, "deck.pdf");
    const pdfBytes = await readFile(pdfPath);

    await run("pdftoppm", ["-png", "-r", "150", pdfPath, join(dir, "slide")], {
      timeout: 120_000,
      maxBuffer: 1024 * 1024 * 16,
    });

    // pdftoppm emits slide-1.png … or slide-01.png … depending on page count.
    const pngs = (await readdir(dir))
      .filter((f) => /^slide-\d+\.png$/.test(f))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    if (pngs.length === 0) throw new Error("pdftoppm produced no slides");

    const slidePngs = await Promise.all(pngs.map((f) => readFile(join(dir, f))));
    return { pdfBytes, slidePngs };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
