import dotenv from "dotenv";
import OpenAI from "openai";
import fs from "fs/promises";

dotenv.config({
  path: ".env.local",
  override: true,
  quiet: true,
});

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY missing");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const searches = [
  `"C2C" "Data Analyst" jobs USA`,
  `"corp to corp" "Data Engineer" jobs USA`,
  `"C2C" SQL BI Power BI Tableau contract`,
  `"C2C" ETL data warehouse reporting analyst`,
  `"C2C" database analyst SQL developer contract`,
  `"corp-to-corp" data quality data migration data validation`,
];

function parseJson(text) {
  const cleaned = String(text)
    .replace(/^```json/i, "")
    .replace(/^```/, "")
    .replace(/```$/, "")
    .trim();

  const first = cleaned.indexOf("[");
  const last = cleaned.lastIndexOf("]");

  if (first === -1 || last === -1) {
    return [];
  }

  return JSON.parse(
    cleaned.slice(first, last + 1)
  );
}

const all = [];

for (const search of searches) {
  console.log(`\n🔎 ${search}`);

  const response =
    await openai.responses.create({
      model: "gpt-5.6",

      reasoning: {
        effort: "low",
      },

      tools: [
        {
          type: "web_search",
          search_context_size: "medium",
        },
      ],

      tool_choice: "required",

      input: `
Search the live web for CURRENT U.S. job openings matching:

${search}

Target candidate:
- Data-related roles
- Approximately 4+ years professional experience
- Contract / C2C / Corp-to-Corp strongly preferred
- H-1B, OPT, STEM OPT or other international-worker compatibility is useful
- Remote, hybrid and onsite are all acceptable

Target role families:
Data Analyst
Senior Data Analyst
Business Data Analyst
BI Analyst
BI Developer
Power BI Developer
Tableau Developer
Reporting Analyst
SQL Analyst
SQL Developer
Database Analyst
Database Developer
DBA
Data Engineer
Analytics Engineer
ETL Developer
Data Warehouse
Data Quality
Data Migration
Data Validation
Data Governance
Data Integration
Business Systems Analyst

Critical rules:
1. Return only actual job-opening URLs when possible.
2. Do not return generic search pages.
3. Do not claim C2C unless the posting/source provides evidence.
4. "Contract" alone does NOT mean C2C.
5. If job says W2 only / no C2C, mark c2c_status="REJECT".
6. If C2C is explicitly allowed, mark c2c_status="CONFIRMED".
7. If unclear, mark c2c_status="VERIFY".
8. Do not claim H-1B/OPT support unless there is evidence.
9. Prefer jobs posted or updated recently.
10. Avoid internships and entry-level roles.
11. Avoid sales, project management, product management and unrelated roles.
12. If a posting appears stale or closed, exclude it.

Return ONLY a JSON array.

Each object:
{
  "title": "",
  "company": "",
  "location": "",
  "job_url": "",
  "posted_date": "",
  "employment_type": "",
  "years_experience_min": null,
  "c2c_status": "CONFIRMED|VERIFY|REJECT",
  "c2c_evidence": "",
  "visa_status": "POSITIVE|UNKNOWN|NEGATIVE",
  "visa_evidence": "",
  "source": "",
  "reason": ""
}

Return up to 10 strong results.
`,
    });

  try {
    const jobs =
      parseJson(response.output_text);

    console.log(
      `Found: ${jobs.length}`
    );

    all.push(...jobs);
  } catch (error) {
    console.log(
      "Could not parse this search:",
      error.message
    );
  }
}

/*
 * Deduplicate by job URL.
 */
const unique = [
  ...new Map(
    all
      .filter(job => job.job_url)
      .map(job => [
        job.job_url
          .split("?")[0]
          .replace(/\/$/, ""),
        job,
      ])
  ).values(),
];

/*
 * Remove explicit C2C rejects.
 */
const usable = unique.filter(
  job => job.c2c_status !== "REJECT"
);

function rank(job) {
  let score = 0;

  if (job.c2c_status === "CONFIRMED") {
    score += 50;
  } else if (job.c2c_status === "VERIFY") {
    score += 20;
  }

  if (job.visa_status === "POSITIVE") {
    score += 20;
  } else if (job.visa_status === "UNKNOWN") {
    score += 5;
  }

  const exp =
    Number(job.years_experience_min);

  if (
    Number.isFinite(exp) &&
    exp >= 3 &&
    exp <= 6
  ) {
    score += 15;
  } else if (
    Number.isFinite(exp) &&
    exp <= 8
  ) {
    score += 8;
  } else if (
    job.years_experience_min == null
  ) {
    score += 5;
  }

  if (
    /remote/i.test(job.location || "")
  ) {
    score += 5;
  }

  return score;
}

for (const job of usable) {
  job.hirepilot_score =
    rank(job);

  job.action =
    job.c2c_status === "CONFIRMED"
      ? "FAST_APPLY"
      : "RECRUITER_FIRST";
}

usable.sort(
  (a, b) =>
    b.hirepilot_score -
    a.hirepilot_score
);

await fs.mkdir("data", {
  recursive: true,
});

await fs.writeFile(
  "data/c2c-web-hunter.json",
  JSON.stringify(usable, null, 2)
);

console.log(
  "\n===== C2C WEB HUNTER COMPLETE ====="
);

console.log(
  `Unique jobs found: ${unique.length}`
);

console.log(
  `Usable after rejects: ${usable.length}`
);

console.log(
  `Confirmed C2C: ${
    usable.filter(
      x =>
        x.c2c_status ===
        "CONFIRMED"
    ).length
  }`
);

console.log(
  `Needs recruiter verification: ${
    usable.filter(
      x =>
        x.c2c_status ===
        "VERIFY"
    ).length
  }`
);

console.log(
  "\n===== APPLY QUEUE ====="
);

console.table(
  usable.slice(0, 30).map(
    (job, i) => ({
      rank: i + 1,
      score:
        job.hirepilot_score,
      action:
        job.action,
      title:
        job.title,
      company:
        job.company,
      location:
        job.location,
      c2c:
        job.c2c_status,
      visa:
        job.visa_status,
      years:
        job.years_experience_min,
      url:
        job.job_url,
    })
  )
);

console.log(
  "\nSaved: data/c2c-web-hunter.json"
);
