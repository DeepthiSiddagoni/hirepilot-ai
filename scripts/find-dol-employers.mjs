import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";

const search =
  String(process.argv[2] ?? "")
    .trim()
    .toLowerCase();

if (!search) {
  throw new Error(
    "Usage: node scripts/find-dol-employers.mjs <search-term>"
  );
}

const DOL_DIR = "data/dol";

const fileName = fs
  .readdirSync(DOL_DIR)
  .find((name) =>
    name.toLowerCase().endsWith(".xlsx")
  );

if (!fileName) {
  throw new Error(
    "No XLSX file found in data/dol"
  );
}

const FILE =
  path.join(DOL_DIR, fileName);

function clean(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  if (typeof value === "object") {
    if ("text" in value) {
      return String(value.text ?? "").trim();
    }

    if ("result" in value) {
      return String(value.result ?? "").trim();
    }

    if (Array.isArray(value.richText)) {
      return value.richText
        .map((x) => x.text ?? "")
        .join("")
        .trim();
    }
  }

  return String(value).trim();
}

console.log(`Reading: ${FILE}`);
console.log(`Searching H-1B employers for: ${search}`);

const workbook =
  new ExcelJS.stream.xlsx.WorkbookReader(
    FILE,
    {
      entries: "emit",
      sharedStrings: "cache",
      hyperlinks: "ignore",
      styles: "ignore",
      worksheets: "emit",
    }
  );

const counts = new Map();

let rowsScanned = 0;
let h1bRows = 0;
let matches = 0;

for await (const worksheet of workbook) {
  let employerColumn = null;
  let visaColumn = null;

  for await (const row of worksheet) {
    rowsScanned++;

    if (row.number === 1) {
      row.eachCell(
        { includeEmpty: true },
        (cell, column) => {
          const header =
            clean(cell.value).toUpperCase();

          if (header === "EMPLOYER_NAME") {
            employerColumn = column;
          }

          if (header === "VISA_CLASS") {
            visaColumn = column;
          }
        }
      );

      console.log({
        employerColumn,
        visaColumn,
      });

      continue;
    }

    if (!employerColumn || !visaColumn) {
      continue;
    }

    const visa =
      clean(
        row.getCell(visaColumn).value
      ).toUpperCase();

    if (visa !== "H-1B") {
      continue;
    }

    h1bRows++;

    const employer =
      clean(
        row.getCell(employerColumn).value
      );

    if (
      !employer
        .toLowerCase()
        .includes(search)
    ) {
      continue;
    }

    matches++;

    counts.set(
      employer,
      (counts.get(employer) ?? 0) + 1
    );
  }

  break;
}

console.log();
console.log("===== MATCHING EMPLOYERS =====");

for (
  const [name, count]
  of [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
) {
  console.log(
    `${count.toLocaleString()} | ${name}`
  );
}

console.log();
console.log(`Rows scanned: ${rowsScanned.toLocaleString()}`);
console.log(`H-1B rows: ${h1bRows.toLocaleString()}`);
console.log(`Matching rows: ${matches.toLocaleString()}`);
console.log(`Unique employer names: ${counts.size}`);
