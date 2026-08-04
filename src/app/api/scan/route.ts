import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { fetchGreenhouseJobs } from "@/lib/collectors/greenhouse";
import { fetchLeverJobs } from "@/lib/collectors/lever";
import { fetchVacoJobs } from "@/lib/collectors/vaco";
import { fetchWorkdayJobs } from "@/lib/collectors/workday";

export async function POST(request: Request) {
  const results: Array<{
    company: string;
    sourceType: string;
    status: string;
    jobs?: number;
    error?: string;
  }> = [];

  try {const { searchParams } =
  new URL(request.url);

const companyFilter =
  searchParams
    .get("company")
    ?.trim()
    .toLowerCase() ?? null;

const sourceTypeFilter =
  searchParams
    .get("sourceType")
    ?.trim()
    .toLowerCase() ?? null;

    const allSources = await sql`
      SELECT
  cs.id,
  cs.company_id,
  cs.source_type,
  cs.source_key,
  cs.source_config,
  c.name AS company_name
      FROM company_sources cs
      JOIN companies c
        ON c.id = cs.company_id
      WHERE cs.active = TRUE
      ORDER BY c.name
    `;
    const sources =
  allSources.filter((source) => {
    const companyName =
      String(
        source.company_name
      ).toLowerCase();

    const sourceType =
      String(
        source.source_type
      ).toLowerCase();

    return (
      (!companyFilter ||
        companyName === companyFilter) &&
      (!sourceTypeFilter ||
        sourceType === sourceTypeFilter)
    );
  });

    let scanned = 0;
    let successful = 0;
    let failed = 0;
    let totalJobsProcessed = 0;

    for (const source of sources) {
      scanned++;

      const companySourceId = String(source.id);
      const companyId = String(source.company_id);
      const companyName = String(source.company_name);
      const sourceType = String(source.source_type).toLowerCase();
      const sourceKey = String(source.source_key);

      try {
        await sql`
          UPDATE company_sources
          SET
            last_scanned_at = NOW(),
            scan_error = NULL,
            updated_at = NOW()
          WHERE id = ${companySourceId}
        `;

        // =====================================
        // GREENHOUSE
        // =====================================
        if (sourceType === "greenhouse") {
          const jobs = await fetchGreenhouseJobs(sourceKey);

          let jobSource = await sql`
            SELECT id
            FROM job_sources
            WHERE LOWER(name) = 'greenhouse'
            LIMIT 1
          `;

          if (jobSource.length === 0) {
            jobSource = await sql`
              INSERT INTO job_sources (
                name,
                source_type,
                base_url,
                active
              )
              VALUES (
                'Greenhouse',
                'ATS',
                'https://boards-api.greenhouse.io',
                TRUE
              )
              RETURNING id
            `;
          }

          const jobSourceId = String(jobSource[0].id);

          for (const job of jobs) {
            const rawData = JSON.stringify(job);

            await sql`
              INSERT INTO jobs (
                company_id,
                source_id,
                external_job_id,
                title,
                description,
                location,
                job_url,
                discovered_at,
                raw_data
              )
              VALUES (
                ${companyId},
                ${jobSourceId},
                ${String(job.id)},
                ${job.title},
                ${job.content ?? null},
                ${job.location?.name ?? null},
                ${job.absolute_url},
                NOW(),
                CAST(${rawData} AS jsonb)
              )
              ON CONFLICT (job_url)
DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  location = EXCLUDED.location,
  raw_data = EXCLUDED.raw_data,
  active = TRUE,
  updated_at = NOW()
WHERE
  jobs.title IS DISTINCT FROM EXCLUDED.title
  OR jobs.description IS DISTINCT FROM EXCLUDED.description
  OR jobs.location IS DISTINCT FROM EXCLUDED.location
  OR jobs.raw_data IS DISTINCT FROM EXCLUDED.raw_data
  OR jobs.active IS DISTINCT FROM TRUE
            `;
          }

          totalJobsProcessed += jobs.length;
          successful++;

          await sql`
            UPDATE company_sources
            SET
              last_success_at = NOW(),
              scan_error = NULL,
              updated_at = NOW()
            WHERE id = ${companySourceId}
          `;

          results.push({
            company: companyName,
            sourceType,
            status: "success",
            jobs: jobs.length,
          });

          continue;
        }

        // =====================================
        // LEVER
        // =====================================
        if (sourceType === "lever") {
          const jobs = await fetchLeverJobs(sourceKey);

          let jobSource = await sql`
            SELECT id
            FROM job_sources
            WHERE LOWER(name) = 'lever'
            LIMIT 1
          `;

          if (jobSource.length === 0) {
            jobSource = await sql`
              INSERT INTO job_sources (
                name,
                source_type,
                base_url,
                active
              )
              VALUES (
                'Lever',
                'ATS',
                'https://api.lever.co',
                TRUE
              )
              RETURNING id
            `;
          }

          const jobSourceId = String(jobSource[0].id);

          for (const job of jobs) {
            const rawData = JSON.stringify(job);

            const listText =
              job.lists
                ?.map((item) => `${item.text ?? ""}\n${item.content ?? ""}`)
                .join("\n\n") ?? "";

            const description = [
              job.descriptionPlain ?? job.description ?? "",
              listText,
              job.additionalPlain ?? job.additional ?? "",
            ]
              .filter(Boolean)
              .join("\n\n");

            const jobUrl =
              job.hostedUrl ??
              job.applyUrl ??
              `https://jobs.lever.co/${sourceKey}/${job.id}`;

            const postedAt = job.createdAt
              ? new Date(job.createdAt).toISOString()
              : null;

            await sql`
              INSERT INTO jobs (
                company_id,
                source_id,
                external_job_id,
                title,
                description,
                location,
                remote_type,
                employment_type,
                job_url,
                salary_min,
                salary_max,
                salary_currency,
                salary_period,
                posted_at,
                discovered_at,
                raw_data
              )
              VALUES (
                ${companyId},
                ${jobSourceId},
                ${job.id},
                ${job.text},
                ${description || null},
                ${job.categories?.location ?? null},
                ${job.workplaceType ?? null},
                ${job.categories?.commitment ?? null},
                ${jobUrl},
                ${job.salaryRange?.min ?? null},
                ${job.salaryRange?.max ?? null},
                ${job.salaryRange?.currency ?? null},
                ${job.salaryRange?.interval ?? null},
                ${postedAt},
                NOW(),
                CAST(${rawData} AS jsonb)
              )
              ON CONFLICT (job_url)
DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  location = EXCLUDED.location,
  remote_type = EXCLUDED.remote_type,
  employment_type = EXCLUDED.employment_type,
  salary_min = EXCLUDED.salary_min,
  salary_max = EXCLUDED.salary_max,
  salary_currency = EXCLUDED.salary_currency,
  salary_period = EXCLUDED.salary_period,
  raw_data = EXCLUDED.raw_data,
  active = TRUE,
  updated_at = NOW()
WHERE
  jobs.title IS DISTINCT FROM EXCLUDED.title
  OR jobs.description IS DISTINCT FROM EXCLUDED.description
  OR jobs.location IS DISTINCT FROM EXCLUDED.location
  OR jobs.remote_type IS DISTINCT FROM EXCLUDED.remote_type
  OR jobs.employment_type IS DISTINCT FROM EXCLUDED.employment_type
  OR jobs.salary_min IS DISTINCT FROM EXCLUDED.salary_min
  OR jobs.salary_max IS DISTINCT FROM EXCLUDED.salary_max
  OR jobs.salary_currency IS DISTINCT FROM EXCLUDED.salary_currency
  OR jobs.salary_period IS DISTINCT FROM EXCLUDED.salary_period
  OR jobs.raw_data IS DISTINCT FROM EXCLUDED.raw_data
  OR jobs.active IS DISTINCT FROM TRUE
            `;
          }

          totalJobsProcessed += jobs.length;
          successful++;

          await sql`
            UPDATE company_sources
            SET
              last_success_at = NOW(),
              scan_error = NULL,
              updated_at = NOW()
            WHERE id = ${companySourceId}
          `;

          results.push({
            company: companyName,
            sourceType,
            status: "success",
            jobs: jobs.length,
          });

          continue;
        }
        // =====================================
        // VACO
        // Controlled test batch: 2 pages
        // =====================================
        if (sourceType === "vaco") {
          const jobs = await fetchVacoJobs({
            maxPages: 2,
            countryCode: "US",
            detailConcurrency: 3,
            delayMs: 250,
          });

          let jobSource = await sql`
            SELECT id
            FROM job_sources
            WHERE LOWER(name) = 'vaco'
            LIMIT 1
          `;

          if (jobSource.length === 0) {
            jobSource = await sql`
              INSERT INTO job_sources (
                name,
                source_type,
                base_url,
                active
              )
              VALUES (
                'Vaco',
                'Staffing',
                'https://jobs.vaco.com',
                TRUE
              )
              RETURNING id
            `;
          }

          const jobSourceId =
            String(jobSource[0].id);

          for (const job of jobs) {
            const rawData =
              JSON.stringify(job);

            await sql`
              INSERT INTO jobs (
                company_id,
                source_id,
                external_job_id,
                title,
                description,
                location,
                remote_type,
                employment_type,
                job_url,
                salary_min,
                salary_max,
                salary_currency,
                salary_period,
                posted_at,
                discovered_at,
                raw_data
              )
              VALUES (
                ${companyId},
                ${jobSourceId},
                ${job.id},
                ${job.title},
                ${job.description},
                ${job.location},
                ${job.remote_type},
                ${job.employment_type},
                ${job.absolute_url},
                ${job.salary_min},
                ${job.salary_max},
                ${job.salary_currency},
                ${job.salary_period},
                ${job.posted_at},
                NOW(),
                CAST(${rawData} AS jsonb)
              )
              ON CONFLICT (job_url)
DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  location = EXCLUDED.location,
  remote_type = EXCLUDED.remote_type,
  employment_type = EXCLUDED.employment_type,
  salary_min = EXCLUDED.salary_min,
  salary_max = EXCLUDED.salary_max,
  salary_currency = EXCLUDED.salary_currency,
  salary_period = EXCLUDED.salary_period,
  raw_data = EXCLUDED.raw_data,
  active = TRUE,
  updated_at = NOW()
WHERE
  jobs.title IS DISTINCT FROM EXCLUDED.title
  OR jobs.description IS DISTINCT FROM EXCLUDED.description
  OR jobs.location IS DISTINCT FROM EXCLUDED.location
  OR jobs.remote_type IS DISTINCT FROM EXCLUDED.remote_type
  OR jobs.employment_type IS DISTINCT FROM EXCLUDED.employment_type
  OR jobs.salary_min IS DISTINCT FROM EXCLUDED.salary_min
  OR jobs.salary_max IS DISTINCT FROM EXCLUDED.salary_max
  OR jobs.salary_currency IS DISTINCT FROM EXCLUDED.salary_currency
  OR jobs.salary_period IS DISTINCT FROM EXCLUDED.salary_period
  OR jobs.raw_data IS DISTINCT FROM EXCLUDED.raw_data
  OR jobs.active IS DISTINCT FROM TRUE
            `;
          }

          totalJobsProcessed += jobs.length;
          successful++;

          await sql`
            UPDATE company_sources
            SET
              last_success_at = NOW(),
              scan_error = NULL,
              updated_at = NOW()
            WHERE id = ${companySourceId}
          `;

          results.push({
            company: companyName,
            sourceType,
            status: "success",
            jobs: jobs.length,
          });

          continue;
        }
        // =====================================
// WORKDAY
// Reusable Workday collector
// Initial controlled batch: 20 jobs
// =====================================
if (sourceType === "workday") {
  const rawConfig = source.source_config;

  const sourceConfig: Record<string, unknown> =
    typeof rawConfig === "string"
      ? JSON.parse(rawConfig)
      : rawConfig &&
          typeof rawConfig === "object"
        ? (rawConfig as Record<string, unknown>)
        : {};

  const host =
    typeof sourceConfig.host === "string"
      ? sourceConfig.host
      : "";

  const tenant =
    typeof sourceConfig.tenant === "string"
      ? sourceConfig.tenant
      : sourceKey;

  const site =
    typeof sourceConfig.site === "string"
      ? sourceConfig.site
      : "";

  const country =
    typeof sourceConfig.country === "string"
      ? sourceConfig.country
      : undefined;

  if (!host || !tenant || !site) {
    throw new Error(
      `Invalid Workday configuration for ${companyName}`
    );
  }
  const maxJobs =
  typeof sourceConfig.maxJobs === "number"
    ? Math.max(
        1,
        Math.floor(sourceConfig.maxJobs)
      )
    : 20;

const pageSize =
  typeof sourceConfig.pageSize === "number"
    ? Math.min(
        20,
        Math.max(
          1,
          Math.floor(sourceConfig.pageSize)
        )
      )
    : 20;

  const jobs = await fetchWorkdayJobs({
  host,
  tenant,
  site,
  country,
  maxJobs,
  pageSize,
});

  let jobSource = await sql`
    SELECT id
    FROM job_sources
    WHERE LOWER(name) = 'workday'
    LIMIT 1
  `;

  if (jobSource.length === 0) {
    jobSource = await sql`
      INSERT INTO job_sources (
        name,
        source_type,
        base_url,
        active
      )
      VALUES (
        'Workday',
        'ATS',
        ${`https://${host}`},
        TRUE
      )
      RETURNING id
    `;
  }

  const jobSourceId =
    String(jobSource[0].id);

  for (const job of jobs) {
    const rawData =
      JSON.stringify(job.raw_data);

    const postedAt =
      job.posted_at
        ? new Date(
            job.posted_at
          ).toISOString()
        : null;

    await sql`
      INSERT INTO jobs (
        company_id,
        source_id,
        external_job_id,
        title,
        description,
        location,
        remote_type,
        employment_type,
        job_url,
        posted_at,
        discovered_at,
        raw_data
      )
      VALUES (
        ${companyId},
        ${jobSourceId},
        ${job.id},
        ${job.title},
        ${job.description},
        ${job.location},
        ${job.remote_type},
        ${job.employment_type},
        ${job.job_url},
        ${postedAt},
        NOW(),
        CAST(${rawData} AS jsonb)
      )

      ON CONFLICT (job_url)

      DO UPDATE SET
        title =
          EXCLUDED.title,

        description =
          EXCLUDED.description,

        location =
          EXCLUDED.location,

        remote_type =
          EXCLUDED.remote_type,

        employment_type =
          EXCLUDED.employment_type,

        posted_at =
          EXCLUDED.posted_at,

        raw_data =
          EXCLUDED.raw_data,

        active =
          TRUE,

        updated_at =
          NOW()

      WHERE
        jobs.title
          IS DISTINCT FROM
          EXCLUDED.title

        OR jobs.description
          IS DISTINCT FROM
          EXCLUDED.description

        OR jobs.location
          IS DISTINCT FROM
          EXCLUDED.location

        OR jobs.remote_type
          IS DISTINCT FROM
          EXCLUDED.remote_type

        OR jobs.employment_type
          IS DISTINCT FROM
          EXCLUDED.employment_type

        OR jobs.posted_at
          IS DISTINCT FROM
          EXCLUDED.posted_at

        OR jobs.raw_data
          IS DISTINCT FROM
          EXCLUDED.raw_data

        OR jobs.active
          IS DISTINCT FROM
          TRUE
    `;
  }

  totalJobsProcessed +=
    jobs.length;

  successful++;

  await sql`
    UPDATE company_sources
    SET
      last_success_at = NOW(),
      scan_error = NULL,
      updated_at = NOW()
    WHERE id = ${companySourceId}
  `;

  results.push({
    company: companyName,
    sourceType,
    status: "success",
    jobs: jobs.length,
  });

  continue;
}
        results.push({
          company: companyName,
          sourceType,
          status: "unsupported-yet",
        });
      } catch (error) {
        failed++;

        const message =
          error instanceof Error
            ? error.message
            : "Unknown scan error";

        await sql`
          UPDATE company_sources
          SET
            scan_error = ${message},
            updated_at = NOW()
          WHERE id = ${companySourceId}
        `;

        results.push({
          company: companyName,
          sourceType,
          status: "failed",
          error: message,
        });
      }
    }

    return NextResponse.json({
      success: true,
      sourcesFound: sources.length,
      scanned,
      successful,
      failed,
      totalJobsProcessed,
      results,
    });
  } catch (error) {
    console.error("Bulk scan error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Bulk scan failed",
      },
      { status: 500 }
    );
  }
}
