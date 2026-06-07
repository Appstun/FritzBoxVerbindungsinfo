import { join, extname, relative } from "path";
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "fs";
import { minify as htmlMinify } from "html-minifier-terser";

const webSrcRootPath = join(process.cwd(), "webSrc");
const webOutRootPath = join(process.cwd(), "web");

const CODE_EXTENSIONS = new Set([".ts", ".js", ".css"]);
const MINIFIABLE_EXTENSIONS = new Set([".ts", ".js", ".css", ".html", ".json", ".svg"]);

function getAllFilesRecursive(dir: string): string[] {
  let results: string[] = [];
  if (!existsSync(dir)) return results;

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) results = results.concat(getAllFilesRecursive(fullPath));
    else results.push(fullPath);
  }

  return results;
}

function ensureOutDir(outFile: string): void {
  const outDir = join(outFile, "..");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
}

function toOutPath(srcFile: string): string {
  const rel = relative(webSrcRootPath, srcFile);
  return join(webOutRootPath, rel);
}

function minifyJson(content: string): string {
  return JSON.stringify(JSON.parse(content));
}

function minifySvg(content: string): string {
  return content
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/>\s+</g, "><")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function minifyHtmlContent(content: string): Promise<string> {
  return await htmlMinify(content, {
    collapseWhitespace: true,
    removeComments: true,
    removeOptionalTags: true,
    removeRedundantAttributes: true,
    removeScriptTypeAttributes: true,
    removeTagWhitespace: true,
    useShortDoctype: true,
    minifyCSS: true,
    minifyJS: true,
  });
}

async function minifyTextFile(srcFile: string, outFile: string): Promise<boolean> {
  const ext = extname(srcFile).toLowerCase();
  const relativePath = relative(webSrcRootPath, srcFile).replace(/\\/g, "/");

  try {
    ensureOutDir(outFile);
    const content = readFileSync(srcFile, "utf8");
    let minified: string;

    switch (ext) {
      case ".html":
        minified = await minifyHtmlContent(content);
        break;
      case ".json":
        minified = minifyJson(content);
        break;
      case ".svg":
        minified = minifySvg(content);
        break;
      default:
        return false;
    }

    writeFileSync(outFile, minified, "utf8");
    if (process.env.BUILD_VERBOSE === "1") console.log(`   ✓ ${relativePath}`);
    return true;
  } catch (err) {
    console.error(`   ❌ Failed: ${relativePath}:`, (err as Error).message);
    return false;
  }
}

async function buildCodeAssets(entrypoints: string[], verbose = false): Promise<boolean> {
  if (entrypoints.length === 0) return true;

  if (verbose) {
    for (const file of entrypoints) {
      console.log(`   → ${relative(webSrcRootPath, file).replace(/\\/g, "/")}`);
    }
  }

  const result = await Bun.build({
    entrypoints,
    outdir: webOutRootPath,
    target: "browser",
    format: "esm",
    minify: {
      whitespace: true,
      syntax: true,
      identifiers: true,
    },
    sourcemap: "none",
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    return false;
  }

  return true;
}

function copyBinaryFile(srcFile: string, outFile: string): boolean {
  const relativePath = relative(webSrcRootPath, srcFile).replace(/\\/g, "/");

  try {
    ensureOutDir(outFile);
    copyFileSync(srcFile, outFile);
    if (process.env.BUILD_VERBOSE === "1") console.log(`   ✓ ${relativePath} (copied)`);
    return true;
  } catch (err) {
    console.error(`   ❌ Failed: ${relativePath}:`, (err as Error).message);
    return false;
  }
}

async function buildAndMinifyAll(verbose = false): Promise<boolean> {
  console.log("🗜️  Building and minifying all files...");

  const allFiles = getAllFilesRecursive(webSrcRootPath);
  if (allFiles.length === 0) {
    console.log("⏭️  No files found in webSrc");
    return true;
  }

  const codeFiles: string[] = [];
  const textFiles: string[] = [];
  const binaryFiles: string[] = [];

  for (const file of allFiles) {
    const ext = extname(file).toLowerCase();
    if (CODE_EXTENSIONS.has(ext)) codeFiles.push(file);
    else if (MINIFIABLE_EXTENSIONS.has(ext)) textFiles.push(file);
    else binaryFiles.push(file);
  }

  console.log(
    `📋 Found ${allFiles.length} file(s): ${codeFiles.length} code, ${textFiles.length} text, ${binaryFiles.length} binary`,
  );

  if (verbose) console.log("🔄 Minifying TS/JS/CSS with Bun...");
  const codeOk = await buildCodeAssets(codeFiles, verbose);
  if (!codeOk) {
    console.error("❌ Build error: Bun.build failed");
    return false;
  }

  let textOk = 0;
  if (textFiles.length > 0) {
    if (verbose) console.log("🔄 Minifying HTML/JSON/SVG...");
    const results = await Promise.all(
      textFiles.map((srcFile) => minifyTextFile(srcFile, toOutPath(srcFile))),
    );
    textOk = results.filter(Boolean).length;
  }

  let binaryOk = 0;
  if (binaryFiles.length > 0) {
    if (verbose) console.log("📦 Copying binary assets...");
    binaryOk = binaryFiles.filter((srcFile) => copyBinaryFile(srcFile, toOutPath(srcFile))).length;
  }

  const processed = codeFiles.length + textOk + binaryOk;
  console.log(`✅ Minified/processed ${processed}/${allFiles.length} file(s)`);
  return processed === allFiles.length;
}

async function main() {
  const startTime = performance.now();
  const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");
  if (verbose) process.env.BUILD_VERBOSE = "1";

  console.log("🔨 Starting web build...");
  console.log("📂 webSrc → web");

  const success = await buildAndMinifyAll(verbose);
  if (!success) process.exit(1);

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log(`\n🎉 Build completed in ${elapsed}s!`);
}

main().catch((err) => {
  console.error("❌ Build failed:", err);
  process.exit(1);
});
