import "dotenv/config";
import dotenv from "dotenv";
import ExcelJS from "exceljs";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";

dotenv.config({ path: ".env.local" });

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not configured");
}

const DOL_DIR = "data/dol";

const fileName = fs
  .readdirSync(DOL_DIR)
  .find((name) =>
    name.toLowerCase().endsWith(".xlsx")
  );

if (!fileName) {
  throw new Error(
    "No DOL XLSX file found in data/dol"
  );
}

const FILE = path.join(
  DOL_DIR,
  fileName
);

const SOURCE_NAME =
  "DOL OFLC LCA Disclosure";

const SOURCE_URL =
  "https://www.dol.gov/agencies/eta/foreign-labor/performance";

const FISCAL_YEAR = 2026;

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
      return String(
        value.text ?? ""
      ).trim();
    }

    if ("result" in value) {
      return String(
        value.result ?? ""
      ).trim();
    }

    if (
      Array.isArray(
        value.richText
      )
    ) {
      return value.richText
        .map(
          (part) =>
            part.text ?? ""
        )
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
    .replace(
      /[^a-z0-9]+/g,
      " "
    )
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

const legalSuffixes =
  new Set([
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
      parts[
        parts.length - 1
      ]
    )
  ) {
    parts.pop();
  }

  return parts.join("");
}

function numberOrNull(
  value
) {
  const text =
    clean(value)
      .replace(/[$,]/g, "");

  if (!text) {
    return null;
  }

  const number =
    Number(text);

  return Number.isFinite(
    number
  )
    ? number
    : null;
}

function dateOrNull(
  value
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  if (
    value instanceof Date
  ) {
    return value
      .toISOString()
      .slice(0, 10);
  }

  if (
    typeof value ===
      "number" &&
    value > 20000 &&
    value < 100000
  ) {
    const millis =
      Date.UTC(
        1899,
        11,
        30
      ) +
      value *
        86400000;

    return new Date(
      millis
    )
      .toISOString()
      .slice(0, 10);
  }

  const text =
    clean(value);

  if (!text) {
    return null;
  }

  const parsed =
    new Date(text);

  if (
    Number.isNaN(
      parsed.getTime()
    )
  ) {
    return null;
  }

  return parsed
    .toISOString()
    .slice(0, 10);
}

const pool =
  new Pool({
    connectionString:
      process.env
        .DATABASE_URL,
    max: 2,
  });

console.log(
  `Reading: ${FILE}`
);

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

const aliasMap =
  new Map();

for (
  const row of
  aliasResult.rows
) {
  const keys =
    new Set([
      compact(
        row.alias_name
      ),
      baseCompact(
        row.alias_name
      ),
      compact(
        row.alias_normalized
      ),
    ]);

  for (
    const key of keys
  ) {
    if (!key) {
      continue;
    }

    aliasMap.set(
      key,
      {
        companyId:
          row.company_id,

        companyName:
          row.company_name,
      }
    );
  }
}

function findCompany(
  employerName
) {
  return (
    aliasMap.get(
      compact(
        employerName
      )
    ) ??
    aliasMap.get(
      baseCompact(
        employerName
      )
    ) ??
    null
  );
}

console.log(
  `Loaded ${aliasResult.rows.length} verified aliases.`
);

const workbook =
  new ExcelJS.stream.xlsx
    .WorkbookReader(
      FILE,
      {
        entries: "emit",
        sharedStrings:
          "cache",
        hyperlinks:
          "ignore",
        styles: "cache",
        worksheets:
          "emit",
      }
    );

let headerMap = null;

let rowsScanned = 0;
let h1bRows = 0;
let matchedRows = 0;
let insertedRows = 0;

const companyCounts =
  new Map();

const statusCounts =
  new Map();

const BATCH_SIZE = 100;

let batch = [];

function getHeaderValue(
  row,
  name
) {
  const column =
    headerMap.get(name);

  if (!column) {
    return "";
  }

  return row
    .getCell(column)
    .value;
}

function getAny(
  row,
  names
) {
  for (
    const name of names
  ) {
    if (
      !headerMap.has(name)
    ) {
      continue;
    }

    const value =
      getHeaderValue(
        row,
        name
      );

    if (clean(value)) {
      return value;
    }
  }

  return null;
}

function makeRawData(
  row
) {
  const raw = {};

  for (
    const [
      header,
      column
    ] of headerMap.entries()
  ) {
    const value =
      row.getCell(
        column
      ).value;

    const normalized =
      clean(value);

    if (normalized) {
      raw[header] =
        normalized;
    }
  }

  return raw;
}

async function flushBatch() {
  if (!batch.length) {
    return;
  }

  const columns = 19;

  const params = [];

  const placeholders =
    batch.map(
      (record, rowIndex) => {
        const base =
          rowIndex *
          columns;

        params.push(
          record.companyId,
          record.employerName,
          record.fiscalYear,
          record.caseNumber,
          record.caseStatus,
          record.visaClass,
          record.jobTitle,
          record.socCode,
          record.socTitle,
          record.worksiteCity,
          record.worksiteState,
          record.wageFrom,
          record.wageTo,
          record.wageUnit,
          record.startDate,
          record.endDate,
          SOURCE_NAME,
          SOURCE_URL,
          JSON.stringify(
            record.rawData
          )
        );

        return `(
          $${base + 1},
          $${base + 2},
          $${base + 3},
          $${base + 4},
          $${base + 5},
          $${base + 6},
          $${base + 7},
          $${base + 8},
          $${base + 9},
          $${base + 10},
          $${base + 11},
          $${base + 12},
          $${base + 13},
          $${base + 14},
          $${base + 15},
          $${base + 16},
          $${base + 17},
          $${base + 18},
          $${base + 19}::jsonb
        )`;
      }
    );

  const result =
    await pool.query(
      `
      INSERT INTO sponsor_lca_history (
        company_id,
        employer_name,
        fiscal_year,
        case_number,
        case_status,
        visa_class,
        job_title,
        soc_code,
        soc_title,
        worksite_city,
        worksite_state,
        wage_from,
        wage_to,
        wage_unit,
        employment_start_date,
        employment_end_date,
        source_name,
        source_url,
        raw_data
      )
      VALUES
        ${placeholders.join(",")}
      ON CONFLICT DO NOTHING
      RETURNING id
      `,
      params
    );

  insertedRows +=
    result.rowCount ?? 0;

  batch = [];
}
try {
  for await (
    const worksheet
    of workbook
  ) {
    for await (
      const row
      of worksheet
    ) {
      rowsScanned++;

      if (
        row.number === 1
      ) {
        headerMap =
          new Map();

        row.eachCell(
          {
            includeEmpty:
              true,
          },
          (
            cell,
            column
          ) => {
            const header =
              clean(
                cell.value
              )
                .toUpperCase();

            if (header) {
              headerMap.set(
                header,
                column
              );
            }
          }
        );

        console.log(
          `Detected ${headerMap.size} DOL columns.`
        );

        continue;
      }

      const visaClass =
        clean(
          getAny(
            row,
            [
              "VISA_CLASS",
            ]
          )
        )
          .toUpperCase();

      if (
        visaClass !== "H-1B"
      ) {
        continue;
      }

      h1bRows++;

      const employerName =
        clean(
          getAny(
            row,
            [
              "EMPLOYER_NAME",
            ]
          )
        );

      if (!employerName) {
        continue;
      }

      const company =
        findCompany(
          employerName
        );

      if (!company) {
        continue;
      }

      const caseNumber =
        clean(
          getAny(
            row,
            [
              "CASE_NUMBER",
            ]
          )
        );

      if (!caseNumber) {
        continue;
      }

      const caseStatus =
        clean(
          getAny(
            row,
            [
              "CASE_STATUS",
            ]
          )
        );

      const jobTitle =
        clean(
          getAny(
            row,
            [
              "JOB_TITLE",
            ]
          )
        );

      const socCode =
        clean(
          getAny(
            row,
            [
              "SOC_CODE",
            ]
          )
        );

      const socTitle =
        clean(
          getAny(
            row,
            [
              "SOC_TITLE",
            ]
          )
        );

      const worksiteCity =
        clean(
          getAny(
            row,
            [
              "WORKSITE_CITY",
            ]
          )
        );

      const worksiteState =
        clean(
          getAny(
            row,
            [
              "WORKSITE_STATE",
            ]
          )
        );

      const wageFrom =
        numberOrNull(
          getAny(
            row,
            [
              "WAGE_RATE_OF_PAY_FROM",
            ]
          )
        );

      const wageTo =
        numberOrNull(
          getAny(
            row,
            [
              "WAGE_RATE_OF_PAY_TO",
            ]
          )
        );

      const wageUnit =
        clean(
          getAny(
            row,
            [
              "WAGE_UNIT_OF_PAY",
            ]
          )
        );

      const startDate =
        dateOrNull(
          getAny(
            row,
            [
              "BEGIN_DATE",
              "EMPLOYMENT_START_DATE",
            ]
          )
        );

      const endDate =
        dateOrNull(
          getAny(
            row,
            [
              "END_DATE",
              "EMPLOYMENT_END_DATE",
            ]
          )
        );

      batch.push({
        companyId:
          company.companyId,

        employerName,

        fiscalYear:
          FISCAL_YEAR,

        caseNumber,
        caseStatus,
        visaClass,
        jobTitle,
        socCode,
        socTitle,
        worksiteCity,
        worksiteState,
        wageFrom,
        wageTo,
        wageUnit,
        startDate,
        endDate,

        rawData:
          makeRawData(
            row
          ),
      });

      matchedRows++;

      companyCounts.set(
        company.companyName,
        (
          companyCounts.get(
            company.companyName
          ) ?? 0
        ) + 1
      );

      const statusKey =
        caseStatus ||
        "UNKNOWN";

      statusCounts.set(
        statusKey,
        (
          statusCounts.get(
            statusKey
          ) ?? 0
        ) + 1
      );

      if (
        batch.length >=
        BATCH_SIZE
      ) {
        await flushBatch();
      }

      if (
        matchedRows %
          1000 ===
        0
      ) {
        console.log(
          `Matched ${matchedRows.toLocaleString()} rows...`
        );
      }
    }

    break;
  }

  await flushBatch();

  // Rebuild only the DOL FY2026
  // summary records.
  await pool.query(
    `
    DELETE FROM sponsor_history
    WHERE
      source_name = $1
      AND fiscal_year = $2
    `,
    [
      SOURCE_NAME,
      FISCAL_YEAR,
    ]
  );

  await pool.query(
    `
    INSERT INTO sponsor_history (
      company_id,
      fiscal_year,
      visa_type,
      filings,
      approvals,
      denials,
      source_name,
      source_url
    )
    SELECT
      company_id,
      fiscal_year,
      visa_class,

      COUNT(*)::int
        AS filings,

      COUNT(*) FILTER (
        WHERE
          UPPER(case_status)
          IN (
            'CERTIFIED',
            'CERTIFIED-WITHDRAWN'
          )
      )::int
        AS approvals,

      COUNT(*) FILTER (
        WHERE
          UPPER(case_status)
          = 'DENIED'
      )::int
        AS denials,

      $1,
      $2

    FROM sponsor_lca_history

    WHERE
      fiscal_year = $3
      AND visa_class = 'H-1B'
      AND source_name = $1

    GROUP BY
      company_id,
      fiscal_year,
      visa_class
    `,
    [
      SOURCE_NAME,
      SOURCE_URL,
      FISCAL_YEAR,
    ]
  );
} catch (error) {
  throw error;
} finally {
  await pool.end();
}

function sorted(map) {
  return [
    ...map.entries(),
  ].sort(
    (a, b) =>
      b[1] - a[1]
  );
}

console.log();
console.log(
  "===== DOL IMPORT COMPLETE ====="
);

console.log(
  `Rows scanned: ${rowsScanned.toLocaleString()}`
);

console.log(
  `H-1B rows scanned: ${h1bRows.toLocaleString()}`
);

console.log(
  `Matched HirePilot rows: ${matchedRows.toLocaleString()}`
);

console.log(
  `New database rows inserted: ${insertedRows.toLocaleString()}`
);

console.log();
console.log(
  "===== IMPORTED BY COMPANY ====="
);

for (
  const [
    company,
    count,
  ] of sorted(
    companyCounts
  )
) {
  console.log(
    `${company}: ${count.toLocaleString()}`
  );
}

console.log();
console.log(
  "===== CASE STATUS ====="
);

for (
  const [
    status,
    count,
  ] of sorted(
    statusCounts
  )
) {
  console.log(
    `${status}: ${count.toLocaleString()}`
  );
}
