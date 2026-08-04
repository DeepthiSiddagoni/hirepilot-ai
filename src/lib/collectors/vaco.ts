import * as cheerio from "cheerio";

const VACO_BASE_URL = "https://jobs.vaco.com";

export type VacoJob = {
  id: string;
  title: string;
  location: string | null;
  category: string | null;
  absolute_url: string;
  description: string | null;
  employment_type: string | null;
  remote_type: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: string | null;
  posted_at: string | null;
  raw_data: Record<string, unknown>;
};

type FetchVacoOptions = {
  maxPages?: number;
  countryCode?: string;
  detailConcurrency?: number;
  delayMs?: number;
};

function clean(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function cleanLocation(value: string | null | undefined) {
  const cleaned = clean(value);

  if (!cleaned) {
    return null;
  }

  return clean(
    cleaned.replace(/^\d{4,}\s+/, "")
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "HirePilot/0.1 public-job-indexer",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Vaco request failed: ${response.status} ${response.statusText}`
    );
  }

  return response.text();
}

function getTotalPages(html: string) {
  const $ = cheerio.load(html);
  const text = clean($("body").text());

  const match =
    text.match(
      /Results\s*:\s*\(\s*1\s*[–-]\s*\d+\s+of\s+([\d,]+)\s*\)/i
    ) ??
    text.match(
      /\(\s*1\s*[–-]\s*\d+\s+of\s+([\d,]+)\s*\)/i
    );

  if (!match) {
    return {
      totalJobs: 25,
      totalPages: 1,
    };
  }

  const totalJobs = Number(
    match[1].replace(/,/g, "")
  );

  return {
    totalJobs,
    totalPages: Math.max(
      1,
      Math.ceil(totalJobs / 25)
    ),
  };
}

function parseListingPage(html: string) {
  const $ = cheerio.load(html);

  const jobs = new Map<
    string,
    {
      id: string;
      title: string;
      location: string | null;
      absolute_url: string;
    }
  >();

  $('a[href*="/job/"]').each((_, element) => {
    const anchor = $(element);
    const href = anchor.attr("href");

    if (!href) {
      return;
    }

    const absoluteUrl =
      href.startsWith("http")
        ? href
        : new URL(href, VACO_BASE_URL).toString();

    const idMatch =
      absoluteUrl.match(/\/job\/(\d+)\//i);

    if (!idMatch) {
      return;
    }

    const title = clean(anchor.text());

    if (!title) {
      return;
    }

    const row = anchor.closest("tr");

    let location: string | null = null;

    if (row.length) {
      const cells = row
        .find("td")
        .map((_, cell) => clean($(cell).text()))
        .get()
        .filter(Boolean);

      if (cells.length > 1) {
        location = cleanLocation(
          cells[cells.length - 1]
        );
      }
    }

    jobs.set(absoluteUrl, {
      id: idMatch[1],
      title,
      location,
      absolute_url: absoluteUrl,
    });
  });

  return Array.from(jobs.values());
}

function parseSalary(text: string) {
  const match = text.match(
    /\$\s*([\d,.]+)\s*-\s*\$?\s*([\d,.]+)\s*(yearly|annually|annual|hourly|weekly|monthly)?/i
  );

  if (!match) {
    return {
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
    };
  }

  let period =
    match[3]?.toLowerCase() ?? null;

  if (
    period === "annual" ||
    period === "annually"
  ) {
    period = "yearly";
  }

  return {
    salaryMin: Number(
      match[1].replace(/,/g, "")
    ),
    salaryMax: Number(
      match[2].replace(/,/g, "")
    ),
    salaryCurrency: "USD",
    salaryPeriod: period,
  };
}

function detectEmploymentType(text: string) {
  const lower = text.toLowerCase();

  if (
    lower.includes("contract-to-hire") ||
    lower.includes("contract to hire")
  ) {
    return "contract-to-hire";
  }

  if (lower.includes("direct hire")) {
    return "direct hire";
  }

  if (
    lower.includes("contractor") ||
    /\bcontract\b/i.test(text)
  ) {
    return "contract";
  }

  if (lower.includes("consulting")) {
    return "consulting";
  }

  if (
    lower.includes("temporary") ||
    lower.includes("temp hire")
  ) {
    return "temporary";
  }

  return null;
}

function normalizeWorkArrangement(
  value: string | null
) {
  const lower = clean(value).toLowerCase();

  if (lower === "hybrid") {
    return "hybrid";
  }

  if (lower === "remote") {
    return "remote";
  }

  if (
    lower === "on-site" ||
    lower === "on site" ||
    lower === "onsite"
  ) {
    return "onsite";
  }

  return null;
}

function extractHeaderMetadata(
  $: cheerio.CheerioAPI,
  fallbackLocation: string | null
) {
  const h1 = clean(
    $("h1").first().text()
  );

  const bodyText = clean(
    $("body").text()
  );

  const start =
    bodyText.indexOf(h1);

  const fromHeading =
    start >= 0
      ? bodyText.slice(start)
      : bodyText;

  const applyIndex =
    fromHeading
      .toLowerCase()
      .indexOf("apply return to results");

  const header =
    applyIndex >= 0
      ? clean(
          fromHeading.slice(
            0,
            applyIndex
          )
        )
      : clean(
          fromHeading.slice(0, 1000)
        );

  const postNumber =
    h1.match(
      /POST NUMBER:\s*(\d+)/i
    )?.[1] ??
    header.match(
      /POST NUMBER:\s*(\d+)/i
    )?.[1] ??
    null;

  const title = clean(
    h1.replace(
      /\s*POST NUMBER:\s*\d+.*$/i,
      ""
    )
  );

  const afterTitle =
    clean(
      header.startsWith(h1)
        ? header.slice(h1.length)
        : header
    );

  const arrangementMatch =
    afterTitle.match(
      /^(.+?)\s+(Hybrid|Remote|On-Site|On Site|Onsite)\b/i
    );

  const location =
    cleanLocation(
      arrangementMatch?.[1] ??
        fallbackLocation
    );

  const remoteType =
    normalizeWorkArrangement(
      arrangementMatch?.[2] ?? null
    );

  let category: string | null = null;

  if (arrangementMatch) {
    const remainder = clean(
      afterTitle.slice(
        arrangementMatch[0].length
      )
    );

    const vacoIndex =
      remainder.indexOf(" Vaco");

    if (vacoIndex > 0) {
      category = clean(
        remainder.slice(0, vacoIndex)
      );
    }
  }

  return {
    header,
    title,
    postNumber,
    location,
    remoteType,
    category,
  };
}

function extractDescription(
  $: cheerio.CheerioAPI
) {
  const root = $("body").clone();

  root
    .find(
      "script, style, nav, header, footer, form"
    )
    .remove();

  let text = clean(root.text());

  const marker =
    "apply return to results";

  const markerIndex =
    text.toLowerCase().indexOf(marker);

  if (markerIndex >= 0) {
    text = clean(
      text.slice(
        markerIndex + marker.length
      )
    );
  }

  const stopMarkers = [
    "eeo notice",
    "representation notice",
    "privacy notice",
    "pay transparency notice",
    "apply now",
  ];

  let stopIndex = text.length;

  for (const markerText of stopMarkers) {
    const index =
      text
        .toLowerCase()
        .indexOf(markerText);

    if (
      index >= 0 &&
      index < stopIndex
    ) {
      stopIndex = index;
    }
  }

  text = clean(
    text.slice(0, stopIndex)
  );

  return text || null;
}

function matchesCountry(
  location: string | null,
  countryCode: string
) {
  if (!countryCode) {
    return true;
  }

  if (!location) {
    return false;
  }

  const normalized =
    clean(location).toUpperCase();

  const country =
    countryCode.toUpperCase();

  return (
    normalized === country ||
    normalized.endsWith(`, ${country}`)
  );
}

async function fetchJobDetail(
  listing: {
    id: string;
    title: string;
    location: string | null;
    absolute_url: string;
  }
): Promise<VacoJob> {
  try {
    const html =
      await fetchHtml(
        listing.absolute_url
      );

    const $ = cheerio.load(html);

    const metadata =
      extractHeaderMetadata(
        $,
        listing.location
      );

    const salary =
      parseSalary(
        metadata.header
      );

    return {
      id:
        metadata.postNumber ??
        listing.id,

      title:
        metadata.title ||
        listing.title,

      location:
        metadata.location,

      category:
        metadata.category,

      absolute_url:
        listing.absolute_url,

      description:
        extractDescription($),

      employment_type:
        detectEmploymentType(
          metadata.header
        ),

      remote_type:
        metadata.remoteType,

      salary_min:
        salary.salaryMin,

      salary_max:
        salary.salaryMax,

      salary_currency:
        salary.salaryCurrency,

      salary_period:
        salary.salaryPeriod,

      posted_at: null,

      raw_data: {
        source: "vaco",
        listing_id: listing.id,
        post_number:
          metadata.postNumber,
        category:
          metadata.category,
      },
    };
  } catch (error) {
    return {
      id: listing.id,
      title: listing.title,
      location:
        listing.location,
      category: null,
      absolute_url:
        listing.absolute_url,
      description: null,
      employment_type: null,
      remote_type: null,
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      salary_period: null,
      posted_at: null,
      raw_data: {
        source: "vaco",
        detail_error:
          error instanceof Error
            ? error.message
            : "Unable to fetch Vaco detail",
      },
    };
  }
}

export async function fetchVacoJobs(
  options: FetchVacoOptions = {}
): Promise<VacoJob[]> {
  const {
    maxPages = 2,
    countryCode = "US",
    detailConcurrency = 3,
    delayMs = 250,
  } = options;

  const firstUrl =
    `${VACO_BASE_URL}/home?lang=en&page=1`;

  const firstHtml =
    await fetchHtml(firstUrl);

  const {
    totalJobs,
    totalPages,
  } = getTotalPages(firstHtml);

  const pagesToFetch =
    Math.min(
      maxPages,
      totalPages
    );

  const listings = new Map<
    string,
    ReturnType<
      typeof parseListingPage
    >[number]
  >();

  for (
    let page = 1;
    page <= pagesToFetch;
    page++
  ) {
    const html =
      page === 1
        ? firstHtml
        : await fetchHtml(
            `${VACO_BASE_URL}/home?lang=en&page=${page}`
          );

    for (
      const job of parseListingPage(html)
    ) {
      listings.set(
        job.absolute_url,
        job
      );
    }

    if (page < pagesToFetch) {
      await sleep(delayMs);
    }
  }

  const details: VacoJob[] = [];

  const listingArray =
    Array.from(
      listings.values()
    );

  for (
    let index = 0;
    index < listingArray.length;
    index += detailConcurrency
  ) {
    const chunk =
      listingArray.slice(
        index,
        index + detailConcurrency
      );

    const jobs =
      await Promise.all(
        chunk.map(fetchJobDetail)
      );

    for (const job of jobs) {
      if (
        matchesCountry(
          job.location,
          countryCode
        )
      ) {
        details.push(job);
      }
    }

    if (
      index +
        detailConcurrency <
      listingArray.length
    ) {
      await sleep(delayMs);
    }
  }

  console.log(
    `[Vaco] Site reports ${totalJobs} jobs / ${totalPages} pages. ` +
      `Fetched ${pagesToFetch} page(s), returning ${details.length} ${countryCode || "all"} jobs.`
  );

  return details;
}
