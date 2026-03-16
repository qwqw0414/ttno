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

// ============================================================================
// Constants
// ============================================================================

const MODEL_NAME = process.env.GEMINI_MODEL_NAME || "gemini-2.5-flash";
const NOTION_TOKEN = process.env.NOTION_API_KEY;
const NOTION_SPACE_NAME = process.env.NOTION_SPACE_NAME || "AgentSpaces";
const MAX_CONTENT_LENGTH = 15000;
const APP_NAME = "ttno";

// ============================================================================
// Types
// ============================================================================

export interface TranslateResult {
  success: boolean;
  originalUrl: string;
  notionUrl?: string;
  error?: string;
}

// ============================================================================
// Tools
// ============================================================================

const fetchWebPageParamsSchema = z.object({
  url: z.string().describe("추출할 웹 페이지의 URL"),
});

async function fetchWebPageContent(
  params: z.infer<typeof fetchWebPageParamsSchema>
): Promise<{ title: string; content: string; url: string; error?: string }> {
  const { url } = params;

  try {
    const response = await fetch(url, {
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
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article) {
      return {
        title: "",
        content: "",
        url,
        error: "Could not extract article content from page",
      };
    }

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

    let markdown = turndownService.turndown(article.content);

    if (markdown.length > MAX_CONTENT_LENGTH) {
      markdown = markdown.slice(0, MAX_CONTENT_LENGTH) + "\n\n...(truncated)";
    }

    return {
      title: article.title || "Untitled",
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
- 페이지 제목 결정: 콘텐츠 내용을 분석하여 가장 적합한 한국어 제목 선정
  - 원본 제목을 그대로 사용하지 말고, 내용을 반영한 명확하고 간결한 제목 작성
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
- 페이지 구성 순서:
  1. 원본 링크 (bookmark 블록) - 반드시 최상단에 배치
  2. divider
  3. 번역된 본문 내용

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

### rich_text 형식 (가장 중요!)
rich_text는 반드시 객체 배열이어야 함. 문자열 배열 절대 금지!
- 올바른 예: "rich_text": [{"type": "text", "text": {"content": "내용"}}]
- 잘못된 예: "rich_text": ["내용"]  ← 이렇게 하면 400 에러

### 기타 규칙
- API 호출시 예시에 없는 파라미터 절대 추가 금지
- 절대 금지: annotations, link, href, Notion-Version
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

  async translate(url: string): Promise<TranslateResult> {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const userId = "web_user";
    const shortUrl = url.length > 50 ? url.substring(0, 50) + "..." : url;

    console.log(`\n[TTNO] ========== Start: ${shortUrl} ==========`);

    try {
      const session = await this.sessionService.createSession({
        appName: APP_NAME,
        userId: userId,
        sessionId: sessionId,
      });
      console.log(`[TTNO] [session]=[${sessionId}]`);

      const userMessage: Content = {
        role: "user",
        parts: [
          {
            text: `다음 URL의 웹 페이지를 처리해주세요: ${url}`,
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

        // Tool 응답 로깅
        const functionResponses = getFunctionResponses(event);
        for (const response of functionResponses) {
          const respStr = JSON.stringify(response.response || {});
          const hasError = respStr.includes("400") ||
                          respStr.includes("error") ||
                          respStr.includes("Bad Request");
          const status = hasError ? "FAILED" : "success";
          console.log(`[TTNO] << Tool Result: ${response.name} (${status})`);
          if (hasError) {
            console.log(`[TTNO]    Error: ${respStr.substring(0, 500)}`);
          }
        }

        if (event.content?.parts) {
          for (const part of event.content.parts) {
            if ("text" in part && part.text) {
              const urlMatch = part.text.match(
                /https:\/\/(?:www\.)?notion\.so\/[^\s)]+/
              );
              if (urlMatch) {
                notionUrl = urlMatch[0];
                console.log(`[TTNO] Notion URL detected`);
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

  async translateMultiple(urls: string[]): Promise<TranslateResult[]> {
    const promises = urls.map((url) => this.translate(url));
    return Promise.all(promises);
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
