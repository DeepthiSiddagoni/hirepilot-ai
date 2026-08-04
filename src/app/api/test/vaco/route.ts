import { NextResponse } from "next/server";
import { fetchVacoJobs } from "@/lib/collectors/vaco";

export async function GET() {
  try {
    const jobs = await fetchVacoJobs({
      maxPages: 2,
      countryCode: "US",
      detailConcurrency: 3,
      delayMs: 200,
    });

    const preview = jobs.slice(0, 10).map((job) => ({
      id: job.id,
      title: job.title,
      location: job.location,
      category: job.category,
      employment_type: job.employment_type,
      remote_type: job.remote_type,
      salary_min: job.salary_min,
      salary_max: job.salary_max,
      salary_currency: job.salary_currency,
      salary_period: job.salary_period,
      job_url: job.absolute_url,
      description_preview:
        job.description?.slice(0, 300) ?? null,
    }));

    return NextResponse.json({
      success: true,
      jobsFound: jobs.length,
      preview,
    });
  } catch (error) {
    console.error("Vaco test failed:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Vaco test failed",
      },
      { status: 500 }
    );
  }
}
