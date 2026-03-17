import { z } from "zod";
import {
  LlmAgent,
  MCPToolset,
  FunctionTool,
  Runner,
  InMemorySessionService,
  getFunctionCalls,
  getFunctionResponses,
} from "@google/adk";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { Content, Part } from "@google/genai";
import type { Browser } from "puppeteer";

// ============================================================================
// Constants
// ============================================================================

const MODEL_NAME = process.env.GEMINI_MODEL_NAME || "gemini-2.5-flash";
const NOTION_TOKEN = process.env.NOTION_API_KEY;
const NOTION_SPACE_NAME = process.env.NOTION_SPACE_NAME || "AgentSpaces";
const MAX_CONTENT_LENGTH = 15000;
const APP_NAME = "ttno";
const FETCH_TIMEOUT_MS = 30000;
const MAX_RETRIES = 2;
const CONCURRENT_LIMIT = 10;

// ============================================================================
// Types
// ============================================================================

export type ProcessMode = "translate" | "translate_summary";

export interface TranslateResult {
  success: boolean;
  originalUrl: string;
  notionUrl?: string;
  error?: string;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * 타임아웃이 있는 fetch 요청
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 재시도 로직이 포함된 함수 실행
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = MAX_RETRIES,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries) {
        console.log(
          `[TTNO] Retry ${attempt + 1}/${maxRetries} after error: ${lastError.message}`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}

/**
 * 동시성 제한이 있는 Promise.all
 */
async function promiseAllWithLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number = CONCURRENT_LIMIT
): Promise<T[]> {
  const results: T[] = [];
  const executing: Promise<void>[] = [];

  for (const task of tasks) {
    const p = task().then((result) => {
      results.push(result);
    });

    executing.push(p);

    if (executing.length >= limit) {
      await Promise.race(executing);
      executing.splice(
        executing.findIndex((e) => e === p),
        1
      );
    }
  }

  await Promise.all(executing);
  return results;
}

// ============================================================================
// Tools
// ============================================================================

const fetchWebPageParamsSchema = z.object({
  url: z.string().describe("추출할 웹 페이지의 URL"),
});

// Fallback 선택자 목록 (문서 사이트에서 자주 사용되는 선택자)
const CONTENT_SELECTORS = [
  "main",
  "article",
  '[role="main"]',
  ".content",
  ".main-content",
  "#content",
  "#main-content",
  ".documentation",
  ".docs-content",
  ".markdown-body",
  ".post-content",
  ".entry-content",
];

// 제거할 요소 선택자
const REMOVE_SELECTORS = [
  "nav",
  "header",
  "footer",
  "aside",
  ".sidebar",
  ".navigation",
  ".menu",
  ".toc",
  ".table-of-contents",
  "script",
  "style",
  "noscript",
];

/**
 * DOM에서 콘텐츠 추출 (Readability 또는 fallback 선택자 사용)
 */
function extractContentFromDocument(
  document: Document,
  fallbackTitle: string = "Untitled"
): { title: string; content: string } | null {
  // 1차: Readability 시도
  const reader = new Readability(document.cloneNode(true) as Document);
  const article = reader.parse();

  if (article) {
    return { title: article.title, content: article.content };
  }

  // 2차: Fallback 선택자 시도
  let contentElement: Element | null = null;
  for (const selector of CONTENT_SELECTORS) {
    contentElement = document.querySelector(selector);
    if (contentElement) {
      console.log(`[TTNO] Found content with selector: ${selector}`);
      break;
    }
  }

  if (!contentElement) {
    return null;
  }

  // 불필요한 요소 제거
  for (const sel of REMOVE_SELECTORS) {
    contentElement.querySelectorAll(sel).forEach((el) => el.remove());
  }

  const title =
    document.querySelector("h1")?.textContent?.trim() ||
    document.title ||
    fallbackTitle;

  return { title, content: contentElement.innerHTML };
}

async function fetchWebPageContent(
  params: z.infer<typeof fetchWebPageParamsSchema>
): Promise<{ title: string; content: string; url: string; error?: string }> {
  const { url } = params;

  try {
    // 타임아웃이 있는 fetch 사용
    const response = await fetchWithTimeout(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    });

    if (!response.ok) {
      return {
        title: "",
        content: "",
        url,
        error: `HTTP error: ${response.status} ${response.statusText}`,
      };
    }

    const html = await response.text();
    const dom = new JSDOM(html, { url });

    // 1차/2차 시도: Readability + fallback 선택자
    let extracted = extractContentFromDocument(dom.window.document);

    // 3차 시도: Puppeteer로 JavaScript 렌더링된 콘텐츠 가져오기
    if (!extracted) {
      console.log(`[TTNO] Static extraction failed, trying Puppeteer`);
      let browser: Browser | null = null;

      try {
        const puppeteer = await import("puppeteer");
        browser = await puppeteer.default.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

        const renderedHtml = await page.content();
        const pageTitle = await page.title();

        const renderedDom = new JSDOM(renderedHtml, { url });
        extracted = extractContentFromDocument(
          renderedDom.window.document,
          pageTitle
        );

        if (extracted) {
          console.log(`[TTNO] Puppeteer extraction successful`);
        }
      } catch (puppeteerError) {
        console.log(
          `[TTNO] Puppeteer failed: ${puppeteerError instanceof Error ? puppeteerError.message : String(puppeteerError)}`
        );
      } finally {
        // 브라우저 종료 보장
        if (browser) {
          await browser.close().catch(() => {});
        }
      }
    }

    if (!extracted) {
      return {
        title: "",
        content: "",
        url,
        error: "Could not extract article content from page",
      };
    }

    // HTML을 Markdown으로 변환
    const turndownService = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
    });

    turndownService.addRule("codeBlock", {
      filter: ["pre"],
      replacement: (_content: string, node: Node) => {
        const element = node as Element;
        const code = element.querySelector("code");
        const language = code?.className?.match(/language-(\w+)/)?.[1] || "";
        const codeContent = code?.textContent || element.textContent || "";
        return `\n\`\`\`${language}\n${codeContent.trim()}\n\`\`\`\n`;
      },
    });

    turndownService.addRule("images", {
      filter: "img",
      replacement: (_content: string, node: Node) => {
        const element = node as Element;
        let src = element.getAttribute("src") || "";
        const alt = element.getAttribute("alt") || "";

        if (src && !src.startsWith("http")) {
          try {
            src = new URL(src, url).href;
          } catch {
            // URL 변환 실패시 원본 유지
          }
        }

        if (src) {
          return `\n![${alt}](${src})\n`;
        }
        return "";
      },
    });

    let markdown = turndownService.turndown(extracted.content);

    if (markdown.length > MAX_CONTENT_LENGTH) {
      markdown = markdown.slice(0, MAX_CONTENT_LENGTH) + "\n\n...(truncated)";
    }

    return {
      title: extracted.title || "Untitled",
      content: markdown,
      url,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { title: "", content: "", url, error: errorMessage };
  }
}

const fetchWebPageTool = new FunctionTool({
  name: "fetchWebPage",
  description:
    "웹 페이지 URL에서 HTML을 가져와 본문을 추출하고 Markdown으로 변환합니다. 제목, 본문(Markdown), URL을 반환합니다.",
  parameters: fetchWebPageParamsSchema,
  execute: fetchWebPageContent,
});

// ============================================================================
// Agent Instruction
// ============================================================================

const AGENT_INSTRUCTION = `당신은 웹 콘텐츠 번역 에이전트입니다.

## 작업 순서

### 1단계: 웹 페이지 콘텐츠 추출
fetchWebPage 도구를 사용하여 URL에서 콘텐츠를 추출합니다.
- 도구가 HTML을 가져와 본문을 추출하고 Markdown으로 변환합니다.
- 반환값: title (제목), content (Markdown 본문), url (원본 URL)

### 2단계: URL에서 그룹명 추출
URL을 분석하여 적절한 그룹명을 결정합니다.

규칙:
- github.io 도메인: 첫 번째 경로를 그룹명으로 사용
  예: google.github.io/adk-docs/get-started → "adk-docs"
- 서브도메인이 docs/api/developer인 경우: 메인 도메인 사용
  예: docs.python.org/3/library → "python.org"
- 일반 도메인: 도메인 자체를 그룹명으로 사용
  예: medium.com/@user/article → "medium.com"
- 특수 케이스:
  - github.com/owner/repo → "repo"
  - dev.to/user/article → "dev.to"

### 3단계: Markdown 콘텐츠 번역 및 페이지 제목 결정
- 추출된 Markdown 콘텐츠를 한국어로 번역
- 코드 블록 내용은 번역하지 않고 원본 유지
- 이미지 URL은 그대로 유지

번역 표기 규칙:
- 기술 용어나 제목은 "한글 번역 (영문 원본)" 형식으로 표기
- 예시:
  - "Server Components" → "서버 컴포넌트 (Server Components)"
  - "Fetching Data" → "데이터 페칭 (Fetching Data)"
  - "App Router" → "앱 라우터 (App Router)"
  - "Edge Runtime" → "엣지 런타임 (Edge Runtime)"
- 코드명, 함수명, API명은 번역하지 않고 원본 유지 (fetch, useState, getServerSideProps 등)

페이지 제목 결정:
- 내용을 반영한 명확하고 간결한 한국어 제목
- 예: "Getting Started" → "시작하기", "About ADK" → "ADK 소개"
- 제목은 20자 이내로 간결하게

### 4단계: Notion 그룹 페이지 확인 및 생성
1. API-post-search로 "${NOTION_SPACE_NAME}" 페이지 검색:
{
  "query": "${NOTION_SPACE_NAME}",
  "filter": {"value": "page", "property": "object"}
}

2. API-get-block-children으로 "${NOTION_SPACE_NAME}" 하위 페이지 목록 조회:
- block_id: ${NOTION_SPACE_NAME} 페이지의 ID
- 반환된 child_page 블록들의 title을 확인

3. 그룹 페이지 존재 여부 확인:
- 하위 페이지 중 그룹명과 일치하는 페이지가 있는지 확인
- 있으면: 해당 페이지 ID를 부모로 사용
- 없으면: API-post-page로 그룹 페이지 먼저 생성
  {
    "parent": {"page_id": "${NOTION_SPACE_NAME}_페이지_ID"},
    "properties": {"title": {"title": [{"text": {"content": "그룹명"}}]}}
  }

### 5단계: 번역된 콘텐츠를 Notion 페이지로 생성
- 부모: 4단계에서 확인/생성한 그룹 페이지
- 페이지 제목: 3단계에서 결정한 한국어 제목 사용
- API-post-page로 번역된 내용을 새 페이지로 생성

#### 처리 모드에 따른 페이지 구성

**[번역만 모드]** - 사용자가 "번역만 진행" 요청 시:
1. 원본 링크 (bookmark 블록)
2. divider
3. 번역된 본문 내용

**[번역+요약 모드]** - 사용자가 "핵심 요약" 요청 시:
1. 원본 링크 (bookmark 블록)
2. divider
3. 핵심 요약 callout 블록 (아이콘: 📋)
   - 문서의 핵심 내용을 3-5개 bullet point로 요약
   - 각 요약은 한 문장으로 간결하게
   - 예시:
     {"object": "block", "type": "callout", "callout": {
       "rich_text": [{"type": "text", "text": {"content": "핵심 요약\\n• 첫 번째 핵심 포인트\\n• 두 번째 핵심 포인트\\n• 세 번째 핵심 포인트"}}],
       "icon": {"emoji": "📋"}
     }}
4. divider
5. 번역된 본문 내용

## 페이지 가독성 향상 규칙

### 여백 및 구조
- heading 앞에는 빈 paragraph 블록 추가 (시각적 여백)
- 코드 블록 앞뒤로 빈 paragraph 추가
- 섹션 간 구분이 필요하면 divider 사용
- 긴 문단은 적절히 나누어 여러 paragraph로 분리

### 빈 줄 삽입 예시
빈 paragraph: {"object": "block", "type": "paragraph", "paragraph": {"rich_text": []}}

### 구조화
- 주요 섹션은 heading_1 또는 heading_2 사용
- 하위 항목은 heading_3 사용
- 관련 내용은 목록(bulleted/numbered)으로 정리
- 중요한 정보는 callout으로 강조
- 코드 예제가 있으면 code 블록 사용 (언어 명시)

## 사용 가능한 블록 타입

### 기본 텍스트
- heading_1: {"object": "block", "type": "heading_1", "heading_1": {"rich_text": [{"type": "text", "text": {"content": "대제목"}}]}}
- heading_2: {"object": "block", "type": "heading_2", "heading_2": {"rich_text": [{"type": "text", "text": {"content": "중제목"}}]}}
- heading_3: {"object": "block", "type": "heading_3", "heading_3": {"rich_text": [{"type": "text", "text": {"content": "소제목"}}]}}
- paragraph: {"object": "block", "type": "paragraph", "paragraph": {"rich_text": [{"type": "text", "text": {"content": "본문"}}]}}

### 목록
- bulleted_list_item: {"object": "block", "type": "bulleted_list_item", "bulleted_list_item": {"rich_text": [{"type": "text", "text": {"content": "글머리 항목"}}]}}
- numbered_list_item: {"object": "block", "type": "numbered_list_item", "numbered_list_item": {"rich_text": [{"type": "text", "text": {"content": "번호 항목"}}]}}
- to_do: {"object": "block", "type": "to_do", "to_do": {"rich_text": [{"type": "text", "text": {"content": "할일"}}], "checked": false}}

### 미디어
- image: {"object": "block", "type": "image", "image": {"type": "external", "external": {"url": "https://example.com/image.png"}}}
- video: {"object": "block", "type": "video", "video": {"type": "external", "external": {"url": "https://youtube.com/watch?v=xxx"}}}
- embed: {"object": "block", "type": "embed", "embed": {"url": "https://example.com/embed"}}
- bookmark: {"object": "block", "type": "bookmark", "bookmark": {"url": "https://example.com"}}

### 코드
- code: {"object": "block", "type": "code", "code": {"rich_text": [{"type": "text", "text": {"content": "코드내용"}}], "language": "python"}}

### 강조/인용
- callout: {"object": "block", "type": "callout", "callout": {"rich_text": [{"type": "text", "text": {"content": "강조 내용"}}], "icon": {"emoji": "💡"}}}
- quote: {"object": "block", "type": "quote", "quote": {"rich_text": [{"type": "text", "text": {"content": "인용문"}}]}}

### 구조
- divider: {"object": "block", "type": "divider", "divider": {}}
- toggle: {"object": "block", "type": "toggle", "toggle": {"rich_text": [{"type": "text", "text": {"content": "토글 제목"}}]}}
- table_of_contents: {"object": "block", "type": "table_of_contents", "table_of_contents": {}}

## Markdown → Notion 블록 매핑
- # → heading_1
- ## → heading_2
- ### → heading_3
- 일반 텍스트 → paragraph
- - 또는 * → bulleted_list_item
- 1. 2. 3. → numbered_list_item
- [ ] → to_do (checked: false)
- [x] → to_do (checked: true)
- > → quote
- \`\`\`language → code
- ![alt](url) → image
- --- → divider
- 중요/경고 박스 → callout

## 중요 규칙 (400 에러 방지)

### children 형식 (가장 중요!)
children은 반드시 객체 배열이어야 함. JSON 문자열 배열 절대 금지!
- 올바른 예: "children": [{"object": "block", "type": "paragraph", ...}]
- 잘못된 예: "children": ["{\"object\": \"block\"...}"]  ← 문자열이면 400 에러

### rich_text 형식
rich_text는 반드시 객체 배열이어야 함. 문자열 배열 절대 금지!
- 올바른 예: "rich_text": [{"type": "text", "text": {"content": "내용"}}]
- 잘못된 예: "rich_text": ["내용"]  ← 이렇게 하면 400 에러

### 텍스트 스타일링 (annotations)
bold, italic, code 등을 사용할 때는 annotations 객체 사용:
{
  "type": "text",
  "text": {"content": "강조"},
  "annotations": {"bold": true}
}

인라인 코드 예시 (\`fetch\` 처럼 표시):
{
  "type": "text",
  "text": {"content": "fetch"},
  "annotations": {"code": true}
}

### 인라인 링크
텍스트에 링크를 걸 때는 text.link 사용:
{
  "type": "text",
  "text": {
    "content": "링크 텍스트",
    "link": {"url": "https://example.com"}
  }
}

### 복합 rich_text 예시
"The \`fetch\` API" 처럼 일부만 코드 스타일인 경우:
"rich_text": [
  {"type": "text", "text": {"content": "The "}},
  {"type": "text", "text": {"content": "fetch"}, "annotations": {"code": true}},
  {"type": "text", "text": {"content": " API"}}
]

### 기타 규칙
- API 호출시 예시에 없는 파라미터 절대 추가 금지
- 절대 금지: href (최상위), Notion-Version
- rich_text content는 2000자 이내 (초과시 분할)
- 페이지 생성 후 응답의 url 필드 값을 반환`;

// ============================================================================
// Agent
// ============================================================================

function createAgent() {
  if (!NOTION_TOKEN) {
    throw new Error(
      "NOTION_API_KEY is not provided. Please set it in .env file."
    );
  }

  return new LlmAgent({
    model: MODEL_NAME,
    name: "translator_agent",
    description:
      "웹 페이지에서 콘텐츠를 추출하고 한국어로 번역하여 Notion에 저장합니다",
    instruction: AGENT_INSTRUCTION,
    tools: [
      fetchWebPageTool,
      new MCPToolset({
        type: "StdioConnectionParams",
        serverParams: {
          command: "npx",
          args: ["-y", "@notionhq/notion-mcp-server"],
          env: {
            NOTION_TOKEN: NOTION_TOKEN,
          },
        },
      }),
    ],
  });
}

// ============================================================================
// Translator Service
// ============================================================================

export class TranslatorService {
  private sessionService: InMemorySessionService;
  private runner: Runner;

  constructor() {
    this.sessionService = new InMemorySessionService();
    this.runner = new Runner({
      agent: createAgent(),
      appName: APP_NAME,
      sessionService: this.sessionService,
    });
  }

  async translate(url: string, mode: ProcessMode = "translate"): Promise<TranslateResult> {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const userId = "web_user";
    const shortUrl = url.length > 50 ? url.substring(0, 50) + "..." : url;
    const modeLabel = mode === "translate_summary" ? "번역+요약" : "번역";

    console.log(`\n[TTNO] ========== Start: ${shortUrl} (${modeLabel}) ==========`);

    try {
      const session = await this.sessionService.createSession({
        appName: APP_NAME,
        userId: userId,
        sessionId: sessionId,
      });
      console.log(`[TTNO] [session]=[${sessionId}] [mode]=[${mode}]`);

      const modeInstruction = mode === "translate_summary"
        ? "번역 후 페이지 최상단에 핵심 요약(3-5개 bullet point)을 callout 블록으로 추가해주세요."
        : "번역만 진행해주세요.";

      const userMessage: Content = {
        role: "user",
        parts: [
          {
            text: `다음 URL의 웹 페이지를 처리해주세요: ${url}\n\n처리 모드: ${modeInstruction}`,
          } as Part,
        ],
      };

      let notionUrl: string | undefined;
      let eventCount = 0;

      for await (const event of this.runner.runAsync({
        userId: userId,
        sessionId: session.id,
        newMessage: userMessage,
      })) {
        eventCount++;

        // Tool 호출 로깅
        const functionCalls = getFunctionCalls(event);
        for (const call of functionCalls) {
          console.log(`[TTNO] >> Tool Call: ${call.name}`);
          if (call.args) {
            const args = call.args as Record<string, unknown>;
            // API-post-page 호출 시 children 블록 수만 표시 (너무 길어서)
            if (call.name === "API-post-page" && args.children) {
              const children = args.children as Array<Record<string, unknown>>;
              const summary = {
                parent: args.parent,
                properties: args.properties,
                children_count: children.length,
                first_block_type: children[0]?.type,
              };
              console.log(`[TTNO]    Args (summary): ${JSON.stringify(summary)}`);
            } else {
              const argsStr = JSON.stringify(args);
              const truncated = argsStr.length > 300
                ? argsStr.substring(0, 300) + "..."
                : argsStr;
              console.log(`[TTNO]    Args: ${truncated}`);
            }
          }
        }

        // Tool 응답 로깅 및 Notion URL 추출
        const functionResponses = getFunctionResponses(event);
        for (const response of functionResponses) {
          let respStr = JSON.stringify(response.response || {});

          // MCP 도구 응답 구조: content[].text 에서 실제 응답 추출
          const respObj = response.response as Record<string, unknown>;
          if (respObj?.content && Array.isArray(respObj.content)) {
            const textContent = respObj.content.find(
              (c: Record<string, unknown>) => c.type === "text" && c.text
            );
            if (textContent?.text) {
              respStr = String(textContent.text);
            }
          }

          // 에러 판단: HTTP 상태 코드나 명확한 에러 메시지 기반
          const isHttpError = /\b(400|401|403|404|500)\b/.test(respStr);
          const hasErrorMessage =
            respStr.includes('"error"') ||
            respStr.includes("Bad Request") ||
            respStr.includes("validation_error");
          const hasSuccess =
            respStr.includes('"object":"page"') ||
            respStr.includes('"object":"block"');
          const hasError = (isHttpError || hasErrorMessage) && !hasSuccess;

          const status = hasError ? "FAILED" : "success";
          console.log(`[TTNO] << Tool Result: ${response.name} (${status})`);
          if (hasError) {
            console.log(`[TTNO]    Error: ${respStr.substring(0, 500)}`);
          }

          // Tool 응답에서 Notion 페이지 URL 추출 (마지막 생성된 페이지 우선)
          if (response.name === "API-post-page" && !hasError) {
            const urlFieldMatch = respStr.match(
              /"url"\s*:\s*"(https:\/\/(?:www\.)?notion\.so\/[^"]+)"/
            );
            if (urlFieldMatch && !urlFieldMatch[1].includes("/images/")) {
              notionUrl = urlFieldMatch[1];
              console.log(`[TTNO] Notion URL detected: ${notionUrl}`);
            }
          }
        }

        // 텍스트 응답에서 Notion URL 추출 (이미지 URL 제외)
        if (event.content?.parts) {
          for (const part of event.content.parts) {
            if ("text" in part && part.text) {
              const urlMatch = part.text.match(
                /https:\/\/(?:www\.)?notion\.so\/(?!images\/)[^\s)]+/
              );
              if (urlMatch && !notionUrl && !urlMatch[0].includes("/images/")) {
                notionUrl = urlMatch[0];
                console.log(`[TTNO] Notion URL detected from text: ${notionUrl}`);
              }
            }
          }
        }
      }

      console.log(`[TTNO] [events]=[${eventCount}]`);

      // 세션 정리
      await this.sessionService.deleteSession({
        appName: APP_NAME,
        userId: userId,
        sessionId: session.id,
      });
      console.log(`[TTNO] Session cleaned up`);
      console.log(`[TTNO] ========== Done: ${shortUrl} ==========\n`);

      return {
        success: true,
        originalUrl: url,
        notionUrl: notionUrl,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.log(`[TTNO] Error: ${errorMessage}`);

      // 에러 발생 시에도 세션 정리 시도
      try {
        await this.sessionService.deleteSession({
          appName: APP_NAME,
          userId: userId,
          sessionId: sessionId,
        });
        console.log(`[TTNO] Session cleaned up (after error)`);
      } catch {
        // 세션 삭제 실패 무시
      }

      console.log(`[TTNO] ========== Failed: ${shortUrl} ==========\n`);

      return {
        success: false,
        originalUrl: url,
        error: errorMessage,
      };
    }
  }

  async translateMultiple(
    urls: string[],
    mode: ProcessMode = "translate"
  ): Promise<TranslateResult[]> {
    console.log(
      `[TTNO] Processing ${urls.length} URLs with concurrency limit ${CONCURRENT_LIMIT}`
    );

    // 동시성 제한 적용 (10개씩 병렬 처리)
    const tasks = urls.map(
      (url) => () =>
        withRetry(() => this.translate(url, mode), MAX_RETRIES, 2000)
    );

    const results = await promiseAllWithLimit(tasks, CONCURRENT_LIMIT);

    // 원래 URL 순서 유지
    const resultsMap = new Map(results.map((r) => [r.originalUrl, r]));
    return urls.map(
      (url) =>
        resultsMap.get(url) || {
          success: false,
          originalUrl: url,
          error: "No result returned",
        }
    );
  }
}

// 싱글톤 인스턴스
let translatorService: TranslatorService | null = null;

export function getTranslatorService(): TranslatorService {
  if (!translatorService) {
    translatorService = new TranslatorService();
  }
  return translatorService;
}
