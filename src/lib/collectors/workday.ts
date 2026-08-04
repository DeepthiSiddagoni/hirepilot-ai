import * as cheerio from "cheerio";

export type WorkdayConfig = {
  host: string;
  tenant: string;
  site: string;

  country?: string;

  maxJobs?: number;
  pageSize?: number;

  searchText?: string;
};

type WorkdaySearchJob = {
  title?: string;
  externalPath?: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
};

type WorkdayFacetValue = {
  descriptor?: string;
  id?: string;
  count?: number;
};

type WorkdayFacet = {
  descriptor?: string;
  facetParameter?: string;
  values?: WorkdayFacetValue[];
};

type WorkdaySearchResponse = {
  total?: number;
  jobPostings?: WorkdaySearchJob[];
  facets?: WorkdayFacet[];
};

type WorkdayPostingInfo = {
  id?: string;
  title?: string;
  jobDescription?: string;

  location?: string;
  country?: string;

  postedOn?: string;
  startDate?: string;

  timeType?: string;
  jobReqId?: string;

  remoteType?: string;

  externalUrl?: string;

  canApply?: boolean;
};

type WorkdayDetailResponse = {
  jobPostingInfo?: WorkdayPostingInfo;
  hiringOrganization?: {
    name?: string;
  };
};

export type WorkdayJob = {
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

function clean(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (
    typeof value === "string" ||
    typeof value === "number"
  ) {
    return String(value)
      .replace(/\s+/g, " ")
      .trim();
  }

  if (typeof value === "object") {
    const record =
      value as Record<string, unknown>;

    for (const key of [
      "descriptor",
      "name",
      "label",
      "value",
    ]) {
      const candidate =
        record[key];

      if (
        typeof candidate === "string"
      ) {
        return candidate
          .replace(/\s+/g, " ")
          .trim();
      }
    }
  }

  return "";
}

function normalizeHost(host: string) {
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

  const $ = cheerio.load(html);

  const text = clean(
    $.root().text()
  );

  return text || null;
}

function normalizeEmploymentType(
  value: string | null | undefined
) {
  const text =
    clean(value).toLowerCase();

  if (!text) {
    return null;
  }

  if (
    text.includes("full time") ||
    text.includes("full-time")
  ) {
    return "Full-time";
  }

  if (
    text.includes("part time") ||
    text.includes("part-time")
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
  value: string | null | undefined
) {
  const text =
    clean(value).toLowerCase();

  if (!text) {
    return null;
  }

  if (text.includes("hybrid")) {
    return "hybrid";
  }

  if (text.includes("remote")) {
    return "remote";
  }

  if (
    text.includes("onsite") ||
    text.includes("on-site") ||
    text.includes("on site")
  ) {
    return "onsite";
  }

  return clean(value).toLowerCase();
}

function getCountryAliases(
  countryCode: string
) {
  const code =
    clean(countryCode).toUpperCase();

  const aliases: Record<string, string[]> = {
    US: [
      "united states of america",
      "united states",
      "usa",
    ],

    IN: [
      "india",
    ],
  };

  return aliases[code] ?? [
    code.toLowerCase(),
  ];
}

function findCountryFacet(
  facets: WorkdayFacet[],
  countryCode?: string
): Record<string, string[]> {
  if (!countryCode) {
    return {};
  }

  const aliases =
    getCountryAliases(countryCode);

  for (const facet of facets) {
    const parameter =
      clean(facet.facetParameter);

    const descriptor =
      clean(facet.descriptor)
        .toLowerCase();

    const looksLikeCountry =
      descriptor.includes("country") ||
      parameter
        .toLowerCase()
        .includes("country");

    if (!looksLikeCountry) {
      continue;
    }

    for (const value of facet.values ?? []) {
      const valueDescriptor =
        clean(value.descriptor)
          .toLowerCase();

      if (
        aliases.some(
          (alias) =>
            valueDescriptor === alias ||
            valueDescriptor.includes(alias)
        ) &&
        value.id
      ) {
        return {
          [parameter]: [
            value.id,
          ],
        };
      }
    }
  }

  return {};
}
async function fetchJson<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const response =
    await fetch(url, {
      ...options,

      cache: "no-store",

      headers: {
        Accept:
          "application/json",

        "Content-Type":
          "application/json",

        "User-Agent":
          "HirePilot/0.1 public-job-indexer",

        ...(options?.headers ?? {}),
      },
    });

  if (!response.ok) {
    throw new Error(
      `Workday request failed: ${response.status} ${response.statusText}`
    );
  }

  return response.json() as Promise<T>;
}

async function fetchWorkdayDetail(
  config: Required<
    Pick<
      WorkdayConfig,
      "host" | "tenant" | "site"
    >
  >,
  searchJob: WorkdaySearchJob
): Promise<WorkdayJob | null> {
  if (!searchJob.externalPath) {
    return null;
  }

  const host =
    normalizeHost(config.host);

  const detailUrl =
    `https://${host}/wday/cxs/` +
    `${encodeURIComponent(config.tenant)}/` +
    `${encodeURIComponent(config.site)}` +
    searchJob.externalPath;

  const detail =
    await fetchJson<WorkdayDetailResponse>(
      detailUrl
    );

  const info =
    detail.jobPostingInfo;

  if (!info) {
    return null;
  }

  const id =
    clean(
      info.jobReqId ??
        searchJob.bulletFields?.[0] ??
        info.id
    );

  if (!id) {
    return null;
  }

  const publicJobUrl =
    info.externalUrl
      ? info.externalUrl
      : `https://${host}/en-US/${config.site}${searchJob.externalPath}`;

  return {
    id,

    title:
      clean(
        info.title ??
          searchJob.title
      ) || "Untitled Job",

    description:
      htmlToText(
        info.jobDescription
      ),

    location:
      clean(
        info.location ??
          searchJob.locationsText
      ) || null,

    country:
      clean(
        info.country
      ) || null,

    employment_type:
      normalizeEmploymentType(
        info.timeType
      ),

    remote_type:
      normalizeRemoteType(
        info.remoteType
      ),

    job_url:
      publicJobUrl,

    posted_at:
      info.startDate
        ? String(info.startDate)
        : null,

    raw_data: {
      source:
        "workday",

      search:
        searchJob,

      detail,

      tenant:
        config.tenant,

      site:
        config.site,

      host,
    },
  };
}

export async function fetchWorkdayJobs(
  config: WorkdayConfig
): Promise<WorkdayJob[]> {
  const host =
    normalizeHost(config.host);

  const tenant =
    config.tenant;

  const site =
    config.site;

  const pageSize =
    Math.min(
      Math.max(
        config.pageSize ?? 20,
        1
      ),
      20
    );

  const maxJobs =
    Math.max(
      config.maxJobs ?? 20,
      1
    );

  const searchText =
    config.searchText ?? "";

  const searchUrl =
    `https://${host}/wday/cxs/` +
    `${encodeURIComponent(tenant)}/` +
    `${encodeURIComponent(site)}/jobs`;

  const searchJobs:
    WorkdaySearchJob[] = [];

  let offset = 0;
  let total = 0;
  const facetProbe =
  await fetchJson<WorkdaySearchResponse>(
    searchUrl,
    {
      method: "POST",

      body:
        JSON.stringify({
          appliedFacets: {},
          limit: 1,
          offset: 0,
          searchText,
        }),
    }
  );

const appliedFacets =
  findCountryFacet(
    facetProbe.facets ?? [],
    config.country
  );

if (
  config.country &&
  Object.keys(appliedFacets).length === 0
) {
  throw new Error(
    `Could not find Workday country facet for ${config.country}`
  );
}

  while (
    searchJobs.length < maxJobs
  ) {
    const data =
      await fetchJson<WorkdaySearchResponse>(
        searchUrl,
        {
          method: "POST",

          body:
            JSON.stringify({
              appliedFacets,
              limit:
                Math.min(
                  pageSize,
                  maxJobs -
                    searchJobs.length
                ),
              offset,
              searchText,
            }),
        }
      );

    total =
      Number(data.total ?? 0);

    const postings =
      data.jobPostings ?? [];

    if (
      postings.length === 0
    ) {
      break;
    }

    searchJobs.push(
  ...postings
);

offset +=
  postings.length;

    if (
      offset >= total ||
      postings.length < pageSize
    ) {
      break;
    }
  }

  const selected =
    searchJobs.slice(
      0,
      maxJobs
    );

  const jobs:
    WorkdayJob[] = [];

  // Intentionally sequential for first version.
  // Safer for public Workday endpoints.
  for (
    const searchJob of selected
  ) {
    try {
      const job =
        await fetchWorkdayDetail(
          {
            host,
            tenant,
            site,
          },
          searchJob
        );

      if (job) {
        jobs.push(job);
      }
    } catch (error) {
      console.error(
        `[Workday] Detail failed for ${searchJob.title ?? "unknown job"}:`,
        error
      );
    }
  }

  console.log(
    `[Workday] ${tenant}/${site}: site reports ${total} jobs; ` +
      `requested ${maxJobs}; returning ${jobs.length}.`
  );

  return jobs;
}
