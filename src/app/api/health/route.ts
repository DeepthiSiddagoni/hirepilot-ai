import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function GET() {
  try {
    const timeResult = await sql`
      SELECT NOW() AS server_time
    `;

    const jobsResult = await sql`
      SELECT COUNT(*)::int AS count
      FROM jobs
    `;

    return NextResponse.json({
      success: true,
      database: "Neon connected",
      serverTime: timeResult[0].server_time,
      jobsInDatabase: jobsResult[0].count,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        success: false,
        database: "Connection failed",
      },
      { status: 500 }
    );
  }
}