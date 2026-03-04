const { generateSummaryReport } = require("k6-html-reporter");
const path = require("path");
const fs = require("fs");

const resultsDir = path.join(__dirname, "..", "results");

if (!fs.existsSync(resultsDir)) {
  console.log("No results directory found. Run a k6 test first.");
  process.exit(1);
}

const summaryFiles = fs
  .readdirSync(resultsDir)
  .filter((f) => f.endsWith("-summary.json"));

if (summaryFiles.length === 0) {
  console.log("No summary JSON files found in results/. Run a k6 test first.");
  process.exit(1);
}

for (const file of summaryFiles) {
  const inputFile = path.join(resultsDir, file);
  const outputFile = path.join(
    resultsDir,
    file.replace("-summary.json", "-report.html")
  );

  try {
    generateSummaryReport({
      jsonFile: inputFile,
      output: outputFile,
    });
    console.log(`Generated: ${outputFile}`);
  } catch (err) {
    console.error(`Failed to generate report for ${file}:`, err.message);
  }
}
