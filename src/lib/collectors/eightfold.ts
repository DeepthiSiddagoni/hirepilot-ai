import * as cheerio from "cheerio";

export type EightfoldConfig = {
  host: string;
  domain: string;

  country?: string;

  maxJobs?: number;
};

type EightfoldSearchPosition = {
  id?: string | number;
  displayJobId?: string | number;

  name?: string;

  locations?: string[];
  standardizedLocations?: string[];

  postedTs?: number;

  department?: string;

  workLocationOption?: string;

  positionUrl?: string;
};

type EightfoldSearchResponse = {
  status?: number;

  error?: {
    message?: string;
    body?: string;
  };

  data?: {
    positions?: EightfoldSearchPosition[];
    count?: number;
    sortBy?: string;
  };
};

type JobPostingRecord =
  Record<string, unknown>;

export type EightfoldJob = {
  id: string;

  title: string;

  description: string | null;

  location: string | null;
  country: string | null;

  employment_type: string | null;
  remote_type: string | null;

  job_url: string;

  posted_at: string | null;

  raw_data: Record<string, unknown>;
};

function clean(
  value: unknown
): string {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value)
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHost(
  host: string
) {
  return host
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

function htmlToText(
  html: string | null | undefined
) {
  if (!html) {
    return null;
  }

  const $ =
    cheerio.load(html);

  const text =
    clean($.root().text());

  return text || null;
}

function normalizeEmploymentType(
  value: unknown
) {
  const text =
    clean(value)
      .toLowerCase()
      .replace(/_/g, " ");

  if (!text) {
    return null;
  }

  if (
    text.includes("full time")
  ) {
    return "Full-time";
  }

  if (
    text.includes("part time")
  ) {
    return "Part-time";
  }

  if (
    text.includes("contract")
  ) {
    return "Contract";
  }

  if (
    text.includes("temporary")
  ) {
    return "Temporary";
  }

  if (
    text.includes("intern")
  ) {
    return "Internship";
  }

  return clean(value);
}

function normalizeRemoteType(
  value: unknown
) {
  const text =
    clean(value).toLowerCase();

  if (!text) {
    return null;
  }

  if (
    text.includes("hybrid")
  ) {
    return "hybrid";
  }

  if (
    text.includes("remote")
  ) {
    return "remote";
  }

  if (
    text.includes("onsite") ||
    text.includes("on-site") ||
    text.includes("on site") ||
    text.includes("in-office") ||
    text.includes("in office")
  ) {
    return "onsite";
  }

  return text;
}

function matchesCountry(
  position: EightfoldSearchPosition,
  countryCode:
    string | null | undefined
) {
  const code =
    clean(countryCode)
      .toUpperCase();

  if (!code) {
    return true;
  }

  const text =
    [
      ...(position.locations ?? []),
      ...(position.standardizedLocations ?? []),
    ]
      .join(" ")
      .toLowerCase();

  if (code === "US") {
    return (
      /\bunited states\b/i.test(text) ||
      /\busa\b/i.test(text) ||
      /\bus\b/i.test(text)
    );
  }

  if (code === "IN") {
    return (
      /\bindia\b/i.test(text) ||
      /\bin\b/i.test(text)
    );
  }

  return text.includes(
    code.toLowerCase()
  );
}

function asRecord(
  value: unknown
): Record<string, unknown> | null {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return value as
      Record<string, unknown>;
  }

  return null;
}

function isJobPosting(
  value: unknown
) {
  if (
    typeof value === "string"
  ) {
    return (
      value.toLowerCase() ===
      "jobposting"
    );
  }

  if (
    Array.isArray(value)
  ) {
    return value.some(
      (item) =>
        typeof item === "string" &&
        item.toLowerCase() ===
          "jobposting"
    );
  }

  return false;
}

function findJobPosting(
  value: unknown
): JobPostingRecord | null {
  if (
    Array.isArray(value)
  ) {
    for (
      const item of value
    ) {
      const found =
        findJobPosting(item);

      if (found) {
        return found;
      }
    }

    return null;
  }

  const record =
    asRecord(value);

  if (!record) {
    return null;
  }

  if (
    isJobPosting(
      record["@type"]
    )
  ) {
    return record;
  }

  if (
    record["@graph"]
  ) {
    const found =
      findJobPosting(
        record["@graph"]
      );

    if (found) {
      return found;
    }
  }

  return null;
}

function getCountryName(
  value: unknown
) {
  if (
    typeof value === "string"
  ) {
    return clean(value);
  }

  const record =
    asRecord(value);

  if (!record) {
    return "";
  }

  return clean(
    record.name ??
      record.value
  );
}

function extractLocation(
  jobPosting: JobPostingRecord,
  fallback:
    EightfoldSearchPosition
) {
  const rawLocation =
    jobPosting.jobLocation;

  const locations =
    Array.isArray(rawLocation)
      ? rawLocation
      : rawLocation
        ? [rawLocation]
        : [];

  for (
    const item of locations
  ) {
    const place =
      asRecord(item);

    if (!place) {
      continue;
    }

    const address =
      asRecord(
        place.address
      );

    if (!address) {
      continue;
    }

    const city =
      clean(
        address.addressLocality
      );

    const region =
      clean(
        address.addressRegion
      );

    const country =
      getCountryName(
        address.addressCountry
      );

    const location =
      [
        city,
        region,
        country,
      ]
        .filter(Boolean)
        .join(", ");

    if (location) {
      return {
        location,
        country:
          country || null,
      };
    }
  }

  return {
    location:
      fallback.locations?.[0] ??
      fallback
        .standardizedLocations?.[0] ??
      null,

    country: null,
  };
}

async function fetchJson<T>(
  url: string
): Promise<T> {
  const response =
    await fetch(url, {
      cache: "no-store",

      headers: {
        Accept:
          "application/json",

        "User-Agent":
          "HirePilot/0.1 public-job-indexer",
      },
    });

  if (!response.ok) {
    throw new Error(
      `Eightfold request failed: ${response.status} ${response.statusText}`
    );
  }

  return response.json() as
    Promise<T>;
}

async function fetchJobPosting(
  url: string
): Promise<JobPostingRecord | null> {
  const response =
    await fetch(url, {
      cache: "no-store",

      headers: {
        Accept:
          "text/html,application/xhtml+xml",

        "User-Agent":
          "HirePilot/0.1 public-job-indexer",
      },
    });

  if (!response.ok) {
    throw new Error(
      `Eightfold job page failed: ${response.status} ${response.statusText}`
    );
  }

  const html =
    await response.text();

  const $ =
    cheerio.load(html);

  const scripts =
    $(
      'script[type="application/ld+json"]'
    );

  for (
    const element of scripts.toArray()
  ) {
    const raw =
      $(element)
        .text()
        .trim();

    if (!raw) {
      continue;
    }

    try {
      const parsed =
        JSON.parse(raw);

      const posting =
        findJobPosting(parsed);

      if (posting) {
        return posting;
      }
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }

  return null;
}

async function buildEightfoldJob(
  config: {
    host: string;
    domain: string;
  },
  position:
    EightfoldSearchPosition
): Promise<EightfoldJob | null> {
  const internalId =
    clean(position.id);

  const displayJobId =
    clean(
      position.displayJobId
    );

  const id =
    displayJobId ||
    internalId;

  if (
    !id ||
    !position.positionUrl
  ) {
    return null;
  }

  const baseUrl =
    `https://${config.host}`;

  const jobUrl =
    new URL(
      position.positionUrl,
      baseUrl
    ).toString();

  const jobPosting =
    await fetchJobPosting(
      jobUrl
    );

  if (!jobPosting) {
    console.warn(
      `[Eightfold] JobPosting JSON-LD not found for ${jobUrl}`
    );

    return null;
  }

  const {
    location,
    country,
  } =
    extractLocation(
      jobPosting,
      position
    );

  const descriptionValue =
    typeof jobPosting.description ===
    "string"
      ? jobPosting.description
      : null;

  const datePosted =
    clean(
      jobPosting.datePosted
    );

  return {
    id,

    title:
      clean(
        jobPosting.title ??
          position.name
      ) ||
      "Untitled Job",

    description:
      htmlToText(
        descriptionValue
      ),

    location,

    country,

    employment_type:
      normalizeEmploymentType(
        jobPosting.employmentType
      ),

    remote_type:
      normalizeRemoteType(
        position.workLocationOption
      ),

    job_url:
      jobUrl,

    posted_at:
      datePosted
        ? datePosted.slice(
            0,
            10
          )
        : null,

    raw_data: {
      source:
        "eightfold",

      domain:
        config.domain,

      search:
        position,

      jobPosting,
    },
  };
}

export async function fetchEightfoldJobs(
  config: EightfoldConfig
): Promise<EightfoldJob[]> {
  const host =
    normalizeHost(
      config.host
    );

  const domain =
    clean(config.domain);

  if (
    !host ||
    !domain
  ) {
    throw new Error(
      "Eightfold host and domain are required"
    );
  }

  const maxJobs =
    Math.max(
      1,
      Math.min(
        config.maxJobs ?? 20,
        100
      )
    );

  const selected:
    EightfoldSearchPosition[] = [];

  const pageSize = 10;

  let start = 0;
  let total = 0;

  // Search pages are inexpensive.
  // Detail pages are only fetched
  // for selected jobs.
  const maxSearchPages = 20;

  for (
    let page = 0;
    page < maxSearchPages &&
    selected.length < maxJobs;
    page++
  ) {
    const searchUrl =
      `https://${host}` +
      `/api/pcsx/search` +
      `?domain=${encodeURIComponent(domain)}` +
      `&start=${start}`;

    const response =
      await fetchJson<EightfoldSearchResponse>(
        searchUrl
      );

    const data =
      response.data;

    const positions =
      data?.positions ?? [];

    total =
      Number(
        data?.count ?? 0
      );

    if (
      positions.length === 0
    ) {
      break;
    }

    for (
      const position of positions
    ) {
      if (
        matchesCountry(
          position,
          config.country
        )
      ) {
        selected.push(
          position
        );

        if (
          selected.length >=
          maxJobs
        ) {
          break;
        }
      }
    }

    start +=
      positions.length;

    if (
      start >= total ||
      positions.length <
        pageSize
    ) {
      break;
    }
  }

  const jobs:
    EightfoldJob[] = [];

  // Keep detail requests sequential
  // during the initial implementation.
  for (
    const position of selected
  ) {
    try {
      const job =
        await buildEightfoldJob(
          {
            host,
            domain,
          },
          position
        );

      if (job) {
        jobs.push(job);
      }
    } catch (error) {
      console.error(
        `[Eightfold] Detail failed for ${position.name ?? "unknown job"}:`,
        error
      );
    }
  }

  console.log(
    `[Eightfold] ${domain}: ` +
      `site reports ${total} jobs; ` +
      `selected ${selected.length}; ` +
      `returning ${jobs.length}.`
  );

  return jobs;
}
