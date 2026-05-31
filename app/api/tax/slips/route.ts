import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { buildT5Csv, buildT5008Csv } from "@/lib/canadian/slips";

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { searchParams } = new URL(request.url);
  const slip = searchParams.get("slip");
  const yearParam = searchParams.get("year");
  const includeRegistered = searchParams.get("includeRegistered") === "true";

  const year = yearParam ? Number(yearParam) : new Date().getUTCFullYear();
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return new NextResponse("Invalid year", { status: 400 });
  }

  let body: string;
  let filename: string;

  if (slip === "t5") {
    body = await buildT5Csv(session.user.id, year, { includeRegistered });
    filename = `t5-${year}${includeRegistered ? "-all" : ""}.csv`;
  } else if (slip === "t5008") {
    body = await buildT5008Csv(session.user.id, year);
    filename = `t5008-${year}.csv`;
  } else {
    return new NextResponse("Unknown slip type. Use slip=t5 or slip=t5008.", {
      status: 400,
    });
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
