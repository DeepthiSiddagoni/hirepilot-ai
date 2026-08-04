import { NextRequest, NextResponse } from "next/server";
import { fetchGreenhouseJobs } from "@/lib/collectors/greenhouse";
import { sql } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      boardToken?: string;
      companyName?: string;
    };

    const boardToken = body.boardToken?.trim();
    const companyName = body.companyName?.trim();

    if (!boardToken || !companyName) {
      return NextResponse.json(
        {
          success: false,
          error: "boardToken and companyName are required",
        },
        { status: 400 }
      );
    }

    // Find or create company
    const existingCompany = await sql`
      SELECT id
      FROM companies
      WHERE LOWER(name) = LOWER(${companyName})
      LIMIT 1
    `;

    let companyId: string;

    if (existingCompany.length > 0) {
      companyId = String(existingCompany[0].id);
    } else {
      const createdCompany = await sql`
        INSERT INTO companies (name)
        VALUES (${companyName})
        RETURNING id
      `;

      companyId = String(createdCompany[0].id);
    }

    // Find or create Greenhouse source
    const existingSource = await sql`
      SELECT id
      FROM job_sources
      WHERE LOWER(name) = 'greenhouse'
      LIMIT 1
    `;

    let sourceId: string;

    if (existingSource.length > 0) {
      sourceId = String(existingSource[0].id);
    } else {
      const createdSource = await sql`
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
          true
        )
        RETURNING id
      `;

      sourceId = String(createdSource[0].id);
    }

    // Fetch live jobs
    const jobs = await fetchGreenhouseJobs(boardToken);

    let processed = 0;

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
          ${sourceId},
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
          active = true,
          updated_at = NOW()
      `;

      processed++;
    }

    return NextResponse.json({
      success: true,
      source: "Greenhouse",
      company: companyName,
      jobsFound: jobs.length,
      jobsProcessed: processed,
    });
  } catch (error) {
    console.error("Greenhouse ingestion error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Greenhouse ingestion failed",
      },
      { status: 500 }
    );
  }
}