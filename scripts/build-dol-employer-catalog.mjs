import dotenv from "dotenv";
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

dotenv.config({
  path: ".env.local",
  override: true,
});

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not configured");
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

const DOL_DIR = "data/dol";

const fileName = fs
  .readdirSync(DOL_DIR)
  .find((name) =>
    name.toLowerCase().endsWith(".xlsx")
  );

if (!fileName) {
  throw new Error("No XLSX file found in data/dol");
}

const FILE = path.join(DOL_DIR, fileName);

function clean(value) {
  if (value === null || value === undefined) {
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
        .map((item) => item.text ?? "")
        .join("")
        .trim();
    }
  }

  return String(value).trim();
}

function normalizeEmployer(value) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeStatus(value) {
  return clean(value)
    .toUpperCase()
    .replace(/[_\s]+/g, "-");
}

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dol_employer_catalog (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      employer_name TEXT NOT NULL,
      employer_normalized TEXT NOT NULL,
      fiscal_year INTEGER NOT NULL,
      visa_class TEXT NOT NULL DEFAULT 'H-1B',
      filings INTEGER NOT NULL DEFAULT 0,
      certified INTEGER NOT NULL DEFAULT 0,
      certified_withdrawn INTEGER NOT NULL DEFAULT 0,
      withdrawn INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (
        employer_normalized,
        fiscal_year,
        visa_class
      )
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
      idx_dol_employer_catalog_normalized
    ON dol_employer_catalog (
      employer_normalized
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
      idx_dol_employer_catalog_filings
    ON dol_employer_catalog (
      filings DESC
    );
  `);
}

await ensureTables();

console.log(`Reading: ${FILE}`);

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

const employers = new Map();

let rowsScanned = 0;
let h1bRows = 0;

for await (const worksheet of workbook) {
  let employerColumn = null;
  let visaColumn = null;
  let statusColumn = null;

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

          if (header === "CASE_STATUS") {
            statusColumn = column;
          }
        }
      );

      console.log(
        `Employer column: ${employerColumn}`
      );
      console.log(
        `Visa column: ${visaColumn}`
      );
      console.log(
        `Status column: ${statusColumn}`
      );

      continue;
    }

    if (!employerColumn || !visaColumn) {
      continue;
    }

    const visa = clean(
      row.getCell(visaColumn).value
    ).toUpperCase();

    if (visa !== "H-1B") {
      continue;
    }

    h1bRows++;

    const employerName = clean(
      row.getCell(employerColumn).value
    );

    if (!employerName) {
      continue;
    }

    const normalized =
      normalizeEmployer(employerName);

    if (!normalized) {
      continue;
    }

    const status = statusColumn
      ? normalizeStatus(
          row.getCell(statusColumn).value
        )
      : "";

    const current =
      employers.get(normalized) ?? {
        employerName,
        filings: 0,
        certified: 0,
        certifiedWithdrawn: 0,
        withdrawn: 0,
      };

    current.filings++;

    if (status === "CERTIFIED") {
      current.certified++;
    }

    if (
      status === "CERTIFIED-WITHDRAWN" ||
      status === "CERTIFIED---WITHDRAWN"
    ) {
      current.certifiedWithdrawn++;
    }

    if (status === "WITHDRAWN") {
      current.withdrawn++;
    }

    employers.set(normalized, current);
  }

  break;
}

console.log();
console.log(
  `Rows scanned: ${rowsScanned.toLocaleString()}`
);
console.log(
  `H-1B rows: ${h1bRows.toLocaleString()}`
);
console.log(
  `Unique H-1B employers: ${employers.size.toLocaleString()}`
);

const entries =
  [...employers.entries()];

const BATCH_SIZE = 500;

let saved = 0;

for (
  let start = 0;
  start < entries.length;
  start += BATCH_SIZE
) {
  const batch =
    entries.slice(
      start,
      start + BATCH_SIZE
    );

  const values = [];
  const placeholders = [];

  batch.forEach(
    ([normalized, item], index) => {
      const base = index * 8;

      placeholders.push(
        `(
          $${base + 1},
          $${base + 2},
          $${base + 3},
          $${base + 4},
          $${base + 5},
          $${base + 6},
          $${base + 7},
          $${base + 8}
        )`
      );

      values.push(
        item.employerName,
        normalized,
        2026,
        "H-1B",
        item.filings,
        item.certified,
        item.certifiedWithdrawn,
        item.withdrawn
      );
    }
  );

  await pool.query(
    `
    INSERT INTO dol_employer_catalog (
      employer_name,
      employer_normalized,
      fiscal_year,
      visa_class,
      filings,
      certified,
      certified_withdrawn,
      withdrawn
    )
    VALUES
      ${placeholders.join(",")}
    ON CONFLICT (
      employer_normalized,
      fiscal_year,
      visa_class
    )
    DO UPDATE SET
      employer_name =
        EXCLUDED.employer_name,
      filings =
        EXCLUDED.filings,
      certified =
        EXCLUDED.certified,
      certified_withdrawn =
        EXCLUDED.certified_withdrawn,
      withdrawn =
        EXCLUDED.withdrawn,
      updated_at = NOW()
    `,
    values
  );

  saved += batch.length;

  console.log(
    `Saved ${saved.toLocaleString()} / ${entries.length.toLocaleString()} employers`
  );
}

await pool.end();

console.log();
console.log(
  "===== DOL EMPLOYER CATALOG COMPLETE ====="
);
console.log(
  `Employers saved: ${saved.toLocaleString()}`
);
