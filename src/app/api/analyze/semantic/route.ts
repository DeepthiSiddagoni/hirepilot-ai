import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { analyzeJobSemantically } from "@/lib/intelligence/semantic-job-analyzer";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const jobId =
      typeof body.jobId === "string"
        ? body.jobId.trim()
        : "";

    if (!jobId) {
      return NextResponse.json(
        {
          success: false,
          error: "jobId is required",
        },
        { status: 400 }
      );
    }

    const jobs = await sql`
      SELECT
        j.id,
        j.title,
        j.description,
        j.location,
        j.employment_type,
        c.name AS company_name
      FROM jobs j
      JOIN companies c
        ON c.id = j.company_id
      WHERE j.id = ${jobId}
      LIMIT 1
    `;

    if (jobs.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Job not found",
        },
        { status: 404 }
      );
    }

    const roleFamilyRows = await sql`
      SELECT name
      FROM role_families
      WHERE name <> 'Career Transition & Training Friendly'
      ORDER BY name
    `;

    const job = jobs[0];

    const analysis = await analyzeJobSemantically({
      title: String(job.title),
      company: String(job.company_name),

      description: job.description
        ? String(job.description)
        : "",

      location: job.location
        ? String(job.location)
        : null,

      employmentType: job.employment_type
        ? String(job.employment_type)
        : null,

      knownRoleFamilies: roleFamilyRows.map((row) =>
        String(row.name)
      ),
    });

    return NextResponse.json({
      success: true,

      job: {
        id: String(job.id),
        title: String(job.title),
        company: String(job.company_name),
      },

      analysis,
    });
  } catch (error) {
    console.error("Semantic analysis error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Semantic analysis failed",
      },
      { status: 500 }
    );
  }
}