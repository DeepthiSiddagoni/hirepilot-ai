import fs from "fs/promises";

const INPUT = "data/c2c-web-hunter.json";
const OUTPUT = "data/c2c-verified-apply-queue.json";

const jobs = JSON.parse(
  await fs.readFile(INPUT, "utf8")
);

const NEGATIVE = [
  "no c2c",
  "no corp to corp",
  "no corp-to-corp",
  "w2 only",
  "w-2 only",
  "no third party",
  "no third parties",
  "no subcontractors",
  "no sponsorship",
  "will not sponsor",
];

const POSITIVE = [
  "c2c",
  "corp to corp",
  "corp-to-corp",
  "corp 2 corp",
  "1099",
];

const VISA_POSITIVE = [
  "h1b",
  "h-1b",
  "opt",
  "stem opt",
  "cpt",
  "visa sponsorship",
];

function textOnly(html = "") {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

function matches(text, phrases) {
  return phrases.filter(x =>
    text.includes(x)
  );
}

function host(url) {
  try {
    return new URL(url).hostname
      .replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function inspect(job) {
  const result = {
    ...job,

    verification_status: "VERIFY",
    page_http: null,

    verified_c2c_positive: [],
    verified_c2c_negative: [],
    verified_visa_positive: [],

    final_url: job.job_url,

    verification_reason: "",
  };

  if (!job.job_url) {
    result.verification_status = "REJECT";
    result.verification_reason = "Missing job URL";
    return result;
  }

  try {
    const response = await fetch(job.job_url, {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 HirePilotAI/1.0",
      },
      signal: AbortSignal.timeout(15000),
    });

    result.page_http = response.status;
    result.final_url = response.url;

    if (!response.ok) {
      result.verification_status = "VERIFY";
      result.verification_reason =
        `Job page returned HTTP ${response.status}`;
      return result;
    }

    const html = await response.text();
    const text = textOnly(html);

    const negative =
      matches(text, NEGATIVE);

    const positive =
      negative.length
        ? []
        : matches(text, POSITIVE);

    const visa =
      matches(text, VISA_POSITIVE);

    result.verified_c2c_negative =
      negative;

    result.verified_c2c_positive =
      positive;

    result.verified_visa_positive =
      visa;

    if (negative.length) {
      result.verification_status =
        "REJECT";

      result.verification_reason =
        `Negative C2C/work-authorization language: ${negative.join(", ")}`;

      return result;
    }

    if (positive.length) {
      result.verification_status =
        "FAST_APPLY";

      result.verification_reason =
        `C2C evidence found on live page: ${positive.join(", ")}`;

      return result;
    }

    /*
     * Some boards such as Dice/LinkedIn may not expose
     * the posting text to a simple HTTP request.
     *
     * Do not throw these away. Send them to recruiter
     * verification instead.
     */
    result.verification_status =
      "RECRUITER_FIRST";

    result.verification_reason =
      "No explicit negative wording found, but C2C could not be independently confirmed on fetched page.";

    return result;

  } catch (error) {
    result.verification_status =
      "RECRUITER_FIRST";

    result.verification_reason =
      `Page could not be independently fetched: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`;

    return result;
  }
}

const verified = [];

for (let i = 0; i < jobs.length; i += 5) {
  const batch =
    jobs.slice(i, i + 5);

  console.log(
    `Checking ${i + 1}-${Math.min(
      i + batch.length,
      jobs.length
    )} / ${jobs.length}`
  );

  const results =
    await Promise.all(
      batch.map(inspect)
    );

  verified.push(...results);
}

const good = verified.filter(
  x =>
    x.verification_status ===
      "FAST_APPLY" ||
    x.verification_status ===
      "RECRUITER_FIRST"
);

good.sort((a, b) => {
  const order = {
    FAST_APPLY: 1,
    RECRUITER_FIRST: 2,
  };

  return (
    order[a.verification_status] -
      order[b.verification_status] ||
    (b.hirepilot_score || 0) -
      (a.hirepilot_score || 0)
  );
});

await fs.writeFile(
  OUTPUT,
  JSON.stringify(good, null, 2)
);

console.log(
  "\n===== VERIFIED C2C APPLY PIPELINE ====="
);

console.log(
  `Original candidates: ${jobs.length}`
);

console.log(
  `FAST APPLY: ${
    verified.filter(
      x =>
        x.verification_status ===
        "FAST_APPLY"
    ).length
  }`
);

console.log(
  `RECRUITER FIRST: ${
    verified.filter(
      x =>
        x.verification_status ===
        "RECRUITER_FIRST"
    ).length
  }`
);

console.log(
  `REJECTED: ${
    verified.filter(
      x =>
        x.verification_status ===
        "REJECT"
    ).length
  }`
);

console.log(
  "\n===== TOP APPLY JOBS ====="
);

console.table(
  good.slice(0, 30).map(
    (job, index) => ({
      rank: index + 1,

      action:
        job.verification_status,

      title:
        job.title,

      company:
        job.company,

      location:
        job.location,

      c2c:
        job.verified_c2c_positive
          ?.join(", ") ||
        "ask recruiter",

      visa:
        job.verified_visa_positive
          ?.join(", ") ||
        "ask recruiter",

      years:
        job.years_experience_min,

      source:
        host(job.final_url),

      url:
        job.final_url,
    })
  )
);

console.log(
  `\nSaved: ${OUTPUT}`
);
