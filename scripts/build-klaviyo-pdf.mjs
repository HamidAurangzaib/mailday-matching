#!/usr/bin/env node
// Convert KLAVIYO-CHECKLIST.md to a styled HTML file that can be opened in any browser
// and printed/saved as PDF (Ctrl+P → Save as PDF). Self-contained — no external deps
// beyond markdown-it which already lives in node_modules.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const mdRequire = await import(
  pathToFileURL(path.join(ROOT, "node_modules/markdown-it/index.mjs")).href
).catch(async () => {
  // Fallback to the .pnpm path if hoisted module isn't there
  const pnpm = path.join(ROOT, "node_modules/.pnpm");
  const dir = fs.readdirSync(pnpm).find((d) => d.startsWith("markdown-it@"));
  return import(pathToFileURL(path.join(pnpm, dir, "node_modules/markdown-it/index.mjs")).href);
});

const md = mdRequire.default({ html: true, linkify: true, typographer: true });

const source = fs.readFileSync(path.join(ROOT, "KLAVIYO-CHECKLIST.md"), "utf8");
const body = md.render(source);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Klaviyo Setup — Step-by-Step Guide</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  :root {
    --ink: #1f2937;
    --soft: #6b7280;
    --rule: #e5e7eb;
    --accent: #dd4b39;
    --bg-soft: #f9fafb;
  }
  * { box-sizing: border-box; }
  html, body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      "Helvetica Neue", Arial, sans-serif;
    color: var(--ink);
    line-height: 1.55;
    font-size: 11pt;
  }
  body { max-width: 760px; margin: 0 auto; padding: 8mm 0; }
  h1 {
    font-size: 22pt;
    color: var(--accent);
    border-bottom: 2px solid var(--rule);
    padding-bottom: 6px;
    margin-top: 0;
  }
  h2 {
    font-size: 14pt;
    margin-top: 22pt;
    padding-top: 6pt;
    border-top: 1px solid var(--rule);
    page-break-after: avoid;
  }
  h3 {
    font-size: 12pt;
    margin-top: 14pt;
    color: var(--accent);
    page-break-after: avoid;
  }
  hr {
    border: 0;
    border-top: 1px dashed var(--rule);
    margin: 18pt 0;
  }
  p { margin: 6pt 0; }
  ul, ol { padding-left: 22px; margin: 6pt 0; }
  li { margin: 3pt 0; }
  li > p { margin: 2pt 0; }
  code {
    background: var(--bg-soft);
    padding: 1px 5px;
    border-radius: 3px;
    font-family: "Cascadia Code", Consolas, Menlo, monospace;
    font-size: 9.5pt;
    border: 1px solid var(--rule);
  }
  pre {
    background: var(--bg-soft);
    padding: 8px 10px;
    border-radius: 4px;
    overflow-x: auto;
    border: 1px solid var(--rule);
  }
  pre code { background: none; border: 0; padding: 0; }
  blockquote {
    border-left: 3px solid var(--accent);
    background: #fff5f3;
    padding: 6pt 12pt;
    margin: 10pt 0;
    color: #5b1f15;
  }
  blockquote p { margin: 3pt 0; }
  strong { color: #111827; }
  table { border-collapse: collapse; margin: 8pt 0; width: 100%; }
  th, td { border: 1px solid var(--rule); padding: 4pt 8pt; text-align: left; }
  th { background: var(--bg-soft); }
  /* Checklist tick boxes (☐) rendered larger */
  h3:first-letter, p:first-letter { }
  /* Keep each flow block together when possible */
  h3 + p, h3 + ul, h3 + ol { page-break-before: avoid; }
  /* Print-friendly link color */
  a { color: var(--accent); text-decoration: none; }
  @media print {
    body { padding: 0; }
    h2 { page-break-before: auto; }
    h3 { page-break-after: avoid; }
  }
  .footer {
    margin-top: 30pt;
    padding-top: 8pt;
    border-top: 1px solid var(--rule);
    font-size: 8.5pt;
    color: var(--soft);
    text-align: center;
  }
</style>
</head>
<body>
${body}
<div class="footer">MailDay Matching · Klaviyo Setup Guide · prepared by Hamid</div>
</body>
</html>`;

const outHtml = path.join(ROOT, "KLAVIYO-CHECKLIST.html");
fs.writeFileSync(outHtml, html, "utf8");
console.log("Wrote", outHtml, "(" + html.length + " bytes)");
