import { NextResponse } from "next/server";
import { fetchWorkdayJobs } from "@/lib/collectors/workday";

export async function GET() {
  try {
    const jobs =
      await fetchWorkdayJobs({
        host:
          "citi.wd5.myworkdayjobs.com",

        tenant:
          "citi",

        site:
          "2",

    
        country:
         "US",

        maxJobs:
          5,

        pageSize:
          20,
      });

    return NextResponse.json({
      success: true,

      jobsFound:
        jobs.length,

      jobs:
        jobs.map(
          (job) => ({
            id:
              job.id,

            title:
              job.title,

            location:
              job.location,

            country:
              job.country,

            employment_type:
              job.employment_type,

            remote_type:
              job.remote_type,

            posted_at:
              job.posted_at,

            job_url:
              job.job_url,

            description_preview:
              job.description?.slice(
                0,
                300
              ) ?? null,
          })
        ),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Workday test failed",
      },
      {
        status: 500,
      }
    );
  }
}
