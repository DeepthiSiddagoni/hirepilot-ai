import "dotenv/config";
import dotenv from "dotenv";
import ExcelJS from "exceljs";
import pg from "pg";
import fs from "node:fs";

dotenv.config({ path: ".env.local" });

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not configured");
}

const FILE =
  "data/dol/LCA_Dislclosure_Data_FY2026_Q2.xlsx";

if (!fs.existsSync(FILE)) {
  throw new Error(`DOL file not found: ${FILE}`);
}

function clean(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (
    typeof value === "object"
  ) {
    if ("text" in value) {
      return String(value.text ?? "").trim();
    }

    if ("result" in value) {
      return String(value.result ?? "").trim();
    }

    if (Array.isArray(value.richText)) {
      return value.richText
        .map((part) => part.text ?? "")
        .join("")
        .trim();
    }
  }

  return String(value).trim();
}

function words(value) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

const legalSuffixes = new Set([
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "company",
  "co",
  "llc",
  "llp",
  "lp",
  "ltd",
  "limited",
  "plc",
  "pbc",
]);

function compact(value) {
  return words(value).join("");
}

function baseCompact(value) {
  const parts = words(value);

  while (
    parts.length > 1 &&
    legalSuffixes.has(
      parts[parts.length - 1]
    )
  ) {
    parts.pop();
  }

  return parts.join("");
}

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL,
  max: 1,
});

const aliasResult =
  await pool.query(`
    SELECT
      a.company_id,
      a.alias_name,
      a.alias_normalized,
      c.name AS company_name
    FROM sponsor_company_aliases a
    JOIN companies c
      ON c.id = a.company_id
  `);

const aliasMap = new Map();

for (const row of aliasResult.rows) {
  const keys = new Set([
    compact(row.alias_name),
    baseCompact(row.alias_name),
    compact(row.alias_normalized),
  ]);

  for (const key of keys) {
    if (!key) continue;

    aliasMap.set(key, {
      companyId: row.company_id,
      companyName: row.company_name,
      aliasName: row.alias_name,
    });
  }
}

console.log(
  `Loaded ${aliasResult.rows.length} sponsorship aliases.`
);

const workbook =
  new ExcelJS.stream.xlsx.WorkbookReader(
    FILE,
    {
      entries: "emit",
      sharedStrings: "cache",
      hyperlinks: "ignore",
      styles: "cache",
      worksheets: "emit",
    }
  );

let scanned = 0;
let h1bRows = 0;
let matchedRows = 0;

const matchesByCompany =
  new Map();

const matchedEmployerNames =
  new Map();

const nearMisses =
  new Map();

let headerMap = null;

function findCompany(
  employerName
) {
  const exact =
    compact(employerName);

  const base =
    baseCompact(employerName);

  return (
    aliasMap.get(exact) ??
    aliasMap.get(base) ??
    null
  );
}

for await (
  const worksheet of workbook
) {
  for await (
    const row of worksheet
  ) {
    scanned++;

    if (row.number === 1) {
      headerMap = new Map();

      row.eachCell(
        { includeEmpty: true },
        (cell, columnNumber) => {
          const header =
            clean(cell.value)
              .toUpperCase();

          if (header) {
            headerMap.set(
              header,
              columnNumber
            );
          }
        }
      );

      const required = [
        "CASE_NUMBER",
        "CASE_STATUS",
        "VISA_CLASS",
        "JOB_TITLE",
        "SOC_CODE",
        "SOC_TITLE",
        "EMPLOYER_NAME",
      ];

      const missing =
        required.filter(
          (name) =>
            !headerMap.has(name)
        );

      if (missing.length) {
        throw new Error(
          `Missing required DOL columns: ${missing.join(", ")}`
        );
      }

      console.log(
        `Detected ${headerMap.size} DOL columns.`
      );

      continue;
    }

    const get = (name) => {
      const column =
        headerMap.get(name);

      if (!column) return "";

      return clean(
        row.getCell(column).value
      );
    };

    const visaClass =
      get("VISA_CLASS")
        .toUpperCase();

    if (visaClass !== "H-1B") {
      continue;
    }

    h1bRows++;

    const employerName =
      get("EMPLOYER_NAME");

    if (!employerName) {
      continue;
    }

    const match =
      findCompany(employerName);

    if (match) {
      matchedRows++;

      matchesByCompany.set(
        match.companyName,
        (
          matchesByCompany.get(
            match.companyName
          ) ?? 0
        ) + 1
      );

      const employerKey =
        `${match.companyName} ← ${employerName}`;

      matchedEmployerNames.set(
        employerKey,
        (
          matchedEmployerNames.get(
            employerKey
          ) ?? 0
        ) + 1
      );

      continue;
    }

    // Find possible legal-name aliases
    // without automatically trusting them.
    const employerNormalized =
      compact(employerName);

    for (
      const alias of aliasResult.rows
    ) {
      const aliasNormalized =
        compact(alias.alias_name);

      if (
        aliasNormalized.length >= 5 &&
        employerNormalized.includes(
          aliasNormalized
        )
      ) {
        const key =
          `${alias.company_name} ? ${employerName}`;

        nearMisses.set(
          key,
          (nearMisses.get(key) ?? 0) + 1
        );

        break;
      }
    }
  }

  // Main disclosure workbook has one
  // worksheet, so stop after it.
  break;
}

await pool.end();

function sorted(map) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1]);
}

console.log();
console.log("===== DOL LCA DRY RUN =====");
console.log(
  `Rows scanned: ${scanned.toLocaleString()}`
);
console.log(
  `H-1B rows: ${h1bRows.toLocaleString()}`
);
console.log(
  `Matched HirePilot rows: ${matchedRows.toLocaleString()}`
);

console.log();
console.log(
  "===== MATCHES BY COMPANY ====="
);

for (
  const [company, count] of
  sorted(matchesByCompany)
) {
  console.log(
    `${company}: ${count.toLocaleString()}`
  );
}

console.log();
console.log(
  "===== MATCHED LEGAL EMPLOYER NAMES ====="
);

for (
  const [name, count] of
  sorted(matchedEmployerNames)
    .slice(0, 50)
) {
  console.log(
    `${count.toLocaleString()} | ${name}`
  );
}

console.log();
console.log(
  "===== POSSIBLE ALIAS NEAR-MISSES ====="
);

for (
  const [name, count] of
  sorted(nearMisses)
    .slice(0, 50)
) {
  console.log(
    `${count.toLocaleString()} | ${name}`
  );
}

console.log();
console.log(
  "DRY RUN ONLY — database was not modified."
);
