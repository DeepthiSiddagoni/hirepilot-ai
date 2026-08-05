import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  analyzeSponsorshipForJob,
} from "@/lib/intelligence/sponsorship-engine";

export async function POST(
  request: NextRequest
) {
  try {
    const body =
      await request.json();

    const jobId =
      String(
        body.jobId ?? ""
      ).trim();

    if (!jobId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "jobId is required",
        },
        {
          status: 400,
        }
      );
    }

    const result =
      await analyzeSponsorshipForJob(
        jobId
      );

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error(
      "Sponsorship analysis failed:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown sponsorship analysis error",
      },
      {
        status: 500,
      }
    );
  }
}
