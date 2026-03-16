import { NextRequest, NextResponse } from "next/server";
import { getTranslatorService, TranslateResult } from "@/lib/agent";

export const maxDuration = 300;

interface TranslateRequest {
  urls: string[];
}

export async function POST(request: NextRequest) {
  try {
    const body: TranslateRequest = await request.json();
    const { urls } = body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json(
        { error: "urls array is required" },
        { status: 400 }
      );
    }

    const validUrls = urls.filter((url) => {
      try {
        new URL(url.startsWith("http") ? url : `https://${url}`);
        return true;
      } catch {
        return false;
      }
    });

    if (validUrls.length === 0) {
      return NextResponse.json(
        { error: "No valid URLs provided" },
        { status: 400 }
      );
    }

    const normalizedUrls = validUrls.map((url) =>
      url.startsWith("http") ? url : `https://${url}`
    );

    const service = getTranslatorService();
    const results: TranslateResult[] =
      await service.translateMultiple(normalizedUrls);

    return NextResponse.json({
      success: true,
      results: results,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[Translate API Error]", errorMessage);

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
      },
      { status: 500 }
    );
  }
}
