'use strict';

// Renders README.md to a standalone README.html for the release zip.
// Usage: node render-readme.js <input.md> <output.html>

const fs = require('fs');
const path = require('path');

const [, , inputPath, outputPath] = process.argv;

if (!inputPath || !outputPath) {
  console.error('Usage: node render-readme.js <input.md> <output.html>');
  process.exit(1);
}

async function main() {
  const { marked } = await import('marked');
  const markdown = fs.readFileSync(inputPath, 'utf8');
  const body = await marked.parse(markdown);
  writeHtml(body);
}

function writeHtml(body) {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>JoinFS to EuroScope Bridge</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 860px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; color: #1a1a1a; }
  h1, h2, h3 { line-height: 1.25; }
  code { background: #f0f0f0; padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.9em; }
  pre { background: #f5f5f5; padding: 1em; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 0.5em 0.75em; text-align: left; }
  th { background: #f5f5f5; }
  img { max-width: 100%; border: 1px solid #ddd; border-radius: 6px; }
  a { color: #0b62c4; }
</style>
</head>
<body>
${body}
</body>
</html>
`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html, 'utf8');
  console.log(`Wrote ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
