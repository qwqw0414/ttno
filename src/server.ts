import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import {
  Runner,
  InMemorySessionService,
  Event,
  getFunctionCalls,
  getFunctionResponses,
} from "@google/adk";
import { Content, Part } from "@google/genai";
import { rootAgent, extractWebContent } from "./agent.js";

// ============================================================================
// Constants
// ============================================================================

const PORT = process.env.PORT || 8080;
const APP_NAME = "ttno";

const COLORS = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
};

// ============================================================================
// Services
// ============================================================================

const sessionService = new InMemorySessionService();
const runner = new Runner({
  agent: rootAgent,
  appName: APP_NAME,
  sessionService: sessionService,
});

// ============================================================================
// Express App
// ============================================================================

const app = express();
app.use(express.json());

// ============================================================================
// Logger
// ============================================================================

function logHeader(title: string): void {
  const line = "=".repeat(60);
  console.log(`\n${COLORS.cyan}${line}${COLORS.reset}`);
  console.log(`${COLORS.bright}${COLORS.cyan} ${title}${COLORS.reset}`);
  console.log(`${COLORS.cyan}${line}${COLORS.reset}`);
}

function logSection(title: string): void {
  console.log(`\n${COLORS.yellow}--- ${title} ---${COLORS.reset}`);
}

function logEvent(event: Event): void {
  const timestamp = new Date(event.timestamp * 1000).toISOString().slice(11, 23);
  const author = event.author || "unknown";

  // Event header
  console.log(
    `\n${COLORS.gray}[${timestamp}]${COLORS.reset} ` +
      `${COLORS.bright}${COLORS.blue}[${author}]${COLORS.reset}`
  );

  // Function calls (tool requests)
  const functionCalls = getFunctionCalls(event);
  if (functionCalls.length > 0) {
    for (const call of functionCalls) {
      console.log(
        `  ${COLORS.magenta}>> Tool Call:${COLORS.reset} ${COLORS.bright}${call.name}${COLORS.reset}`
      );
      if (call.args) {
        const argsStr = JSON.stringify(call.args, null, 2)
          .split("\n")
          .map((line) => `     ${COLORS.dim}${line}${COLORS.reset}`)
          .join("\n");
        console.log(argsStr);
      }
    }
  }

  // Function responses (tool results)
  const functionResponses = getFunctionResponses(event);
  if (functionResponses.length > 0) {
    for (const response of functionResponses) {
      console.log(
        `  ${COLORS.green}<< Tool Result:${COLORS.reset} ${COLORS.bright}${response.name}${COLORS.reset}`
      );
      if (response.response) {
        const responseStr = JSON.stringify(response.response, null, 2);
        const truncated =
          responseStr.length > 500
            ? responseStr.slice(0, 500) + "...(truncated)"
            : responseStr;
        const lines = truncated
          .split("\n")
          .map((line) => `     ${COLORS.dim}${line}${COLORS.reset}`)
          .join("\n");
        console.log(lines);
      }
    }
  }

  // Text content
  if (event.content?.parts) {
    for (const part of event.content.parts) {
      if ("text" in part && part.text) {
        const isPartial = event.partial ? " (streaming)" : "";
        const prefix = event.partial ? "..." : "";
        const text = part.text.trim();
        if (text) {
          console.log(
            `  ${COLORS.cyan}Text${isPartial}:${COLORS.reset} ${prefix}${text.slice(0, 200)}${text.length > 200 ? "..." : ""}`
          );
        }
      }
    }
  }

  // Error
  if (event.errorMessage) {
    console.log(
      `  ${COLORS.red}Error:${COLORS.reset} ${event.errorCode || ""} - ${event.errorMessage}`
    );
  }
}

function logSummary(
  startTime: number,
  success: boolean,
  notionUrl?: string
): void {
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  logSection("Summary");
  console.log(`  ${COLORS.gray}Duration:${COLORS.reset} ${duration}s`);
  console.log(
    `  ${COLORS.gray}Status:${COLORS.reset} ${success ? COLORS.green + "Success" : COLORS.red + "Failed"}${COLORS.reset}`
  );
  if (notionUrl) {
    console.log(`  ${COLORS.gray}Notion URL:${COLORS.reset} ${notionUrl}`);
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

interface AgentResponse {
  success: boolean;
  message: string;
  notionUrl?: string;
  error?: string;
}

async function runAgent(url: string, userId: string): Promise<AgentResponse> {
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const startTime = Date.now();

  logHeader(`Processing: ${url}`);
  console.log(`  ${COLORS.gray}Session:${COLORS.reset} ${sessionId}`);
  console.log(`  ${COLORS.gray}User:${COLORS.reset} ${userId}`);

  // Step 1: Extract web content first
  logSection("Extracting Web Content");
  const extracted = await extractWebContent(url);

  if (extracted.error) {
    console.log(`  ${COLORS.red}Error:${COLORS.reset} ${extracted.error}`);
    return {
      success: false,
      message: "Failed to extract content",
      error: extracted.error,
    };
  }

  console.log(`  ${COLORS.gray}Title:${COLORS.reset} ${extracted.title}`);
  console.log(
    `  ${COLORS.gray}Content length:${COLORS.reset} ${extracted.content.length} chars`
  );

  const session = await sessionService.createSession({
    appName: APP_NAME,
    userId: userId,
    sessionId: sessionId,
  });

  // Step 2: Send Markdown to agent for translation and Notion creation
  const userMessage: Content = {
    role: "user",
    parts: [
      {
        text: `다음 Markdown 콘텐츠를 한국어로 번역하고 Notion 페이지를 생성하세요.

원본 URL: ${url}
제목: ${extracted.title}

Markdown 콘텐츠:
${extracted.content}

작업:
1. 제목과 본문을 한국어로 번역 (코드 블록은 원본 유지, 이미지 URL 유지)
2. API-post-search로 "AgentSpaces" 페이지 검색
3. API-post-page로 번역된 콘텐츠를 새 페이지로 생성 (이미지는 image 블록으로)
4. 생성된 Notion 페이지 URL 반환`,
      } as Part,
    ],
  };

  let finalMessage = "";
  let notionUrl: string | undefined;
  let eventCount = 0;

  logSection("Agent Events");

  try {
    for await (const event of runner.runAsync({
      userId: userId,
      sessionId: session.id,
      newMessage: userMessage,
    })) {
      eventCount++;
      logEvent(event);

      if (event.content?.parts) {
        for (const part of event.content.parts) {
          if ("text" in part && part.text) {
            finalMessage += part.text;
            const urlMatch = part.text.match(
              /https:\/\/(?:www\.)?notion\.so\/[^\s)]+/
            );
            if (urlMatch) {
              notionUrl = urlMatch[0];
            }
          }
        }
      }
    }

    console.log(`\n  ${COLORS.gray}Total events:${COLORS.reset} ${eventCount}`);
    logSummary(startTime, true, notionUrl);

    return {
      success: true,
      message: finalMessage,
      notionUrl: notionUrl,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(`\n  ${COLORS.red}Error:${COLORS.reset} ${errorMessage}`);
    logSummary(startTime, false);

    return {
      success: false,
      message: "Failed to process the URL",
      error: errorMessage,
    };
  }
}

// ============================================================================
// Routes
// ============================================================================

app.get("/api/tt/*splat", async (req: Request, res: Response) => {
  const targetUrl = (req.params as { splat: string[] }).splat.join("/");

  if (!targetUrl) {
    res.status(400).json({ error: "URL parameter is required" });
    return;
  }

  const fullUrl = targetUrl.startsWith("http")
    ? targetUrl
    : `https://${targetUrl}`;

  try {
    const userId = `user_${req.ip || "anonymous"}`;
    const result = await runAgent(fullUrl, userId);

    if (result.success) {
      res.json({
        success: true,
        originalUrl: fullUrl,
        notionUrl: result.notionUrl,
        message: result.message,
      });
    } else {
      res.status(500).json({
        success: false,
        originalUrl: fullUrl,
        error: result.error,
        message: result.message,
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`${COLORS.red}[Error]${COLORS.reset} ${errorMessage}`);
    res.status(500).json({
      success: false,
      originalUrl: fullUrl,
      error: errorMessage,
    });
  }
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// ============================================================================
// Error Handler
// ============================================================================

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(`${COLORS.red}[Error]${COLORS.reset} ${err.message}`);
  res.status(500).json({ error: "Internal server error" });
});

// ============================================================================
// Start Server
// ============================================================================

app.listen(PORT, () => {
  console.log(`\n${COLORS.bright}${COLORS.green}Server started${COLORS.reset}`);
  console.log(`  ${COLORS.gray}URL:${COLORS.reset} http://localhost:${PORT}`);
  console.log(
    `  ${COLORS.gray}API:${COLORS.reset} http://localhost:${PORT}/api/tt/{url}`
  );
  console.log(
    `  ${COLORS.gray}Health:${COLORS.reset} http://localhost:${PORT}/health\n`
  );
});
