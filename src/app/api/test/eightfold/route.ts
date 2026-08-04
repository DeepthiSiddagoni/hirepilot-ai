import { NextResponse } from "next/server";
import { fetchEightfoldJobs } from "@/lib/collectors/eightfold";

export async function GET() {
  try {
    const jobs = await fetchEightfoldJobs({
      host: "apply.careers.microsoft.com",
      domain: "microsoft.com",
      country: "US",
      maxJobs: 5,
    });

    return NextResponse.json({
      success: true,
      jobsFound: jobs.length,

      jobs: jobs.map((job) => ({
        id: job.id,
        title: job.title,
        location: job.location,
        country: job.country,
        employment_type: job.employment_type,
        remote_type: job.remote_type,
        posted_at: job.posted_at,
        job_url: job.job_url,

        description_preview:
          job.description?.slice(0, 500) ?? null,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown Eightfold test error",
      },
      {
        status: 500,
      }
    );
  }
}
