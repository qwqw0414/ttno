import "dotenv/config";
import { z } from "zod";
import { LlmAgent, MCPToolset, FunctionTool } from "@google/adk";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

// ============================================================================
// Constants
// ============================================================================

const MODEL_NAME = process.env.GEMINI_MODEL_NAME || "gemini-2.5-flash";
const NOTION_TOKEN = process.env.NOTION_API_KEY;
const NOTION_SPACE_NAME = process.env.NOTION_SPACE_NAME || "AgentSpaces";
const MAX_CONTENT_LENGTH = 15000;

if (!NOTION_TOKEN) {
  throw new Error(
    "NOTION_API_KEY is not provided. Please set it in .env file."
  );
}

// ============================================================================
// HTML Extraction Utility
// ============================================================================

export interface ExtractedContent {
  title: string;
  content: string;
  url: string;
  error?: string;
}

export async function extractWebContent(url: string): Promise<ExtractedContent> {
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

    // 코드 블록 처리
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

    // 이미지 처리 - 절대 URL로 변환
    turndownService.addRule("images", {
      filter: "img",
      replacement: (_content: string, node: Node) => {
        const element = node as Element;
        let src = element.getAttribute("src") || "";
        const alt = element.getAttribute("alt") || "";

        // 상대경로를 절대경로로 변환
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

// ============================================================================
// Tools
// ============================================================================

const translateAndCreatePageParamsSchema = z.object({
  title: z.string().describe("The title of the article"),
  content: z.string().describe("The markdown content to translate"),
  originalUrl: z.string().describe("The original URL of the article"),
});

const translateAndCreatePageTool = new FunctionTool({
  name: "translateContent",
  description: "Translates content to Korean. Returns the translated text.",
  parameters: translateAndCreatePageParamsSchema,
  execute: async (params: z.infer<typeof translateAndCreatePageParamsSchema>) => {
    return {
      title: params.title,
      content: params.content,
      originalUrl: params.originalUrl,
      status: "ready_for_translation",
    };
  },
});

// ============================================================================
// Agent
// ============================================================================

const AGENT_INSTRUCTION = `당신은 웹 콘텐츠 번역 에이전트입니다.

## 작업 순서

### 1단계: Markdown 콘텐츠 번역
- 받은 Markdown 콘텐츠를 한국어로 번역
- 코드 블록 내용은 번역하지 않고 원본 유지
- 이미지 URL은 그대로 유지

### 2단계: Notion 페이지 생성
1. API-post-search로 "${NOTION_SPACE_NAME}" 페이지 검색:
{
  "query": "${NOTION_SPACE_NAME}",
  "filter": {"value": "page", "property": "object"}
}

2. API-post-page로 번역된 내용을 새 페이지로 생성:
{
  "parent": {"page_id": "검색결과의_PAGE_ID"},
  "properties": {
    "title": {"title": [{"type": "text", "text": {"content": "번역된 제목"}}]}
  },
  "children": [
    {"object": "block", "type": "bookmark", "bookmark": {"url": "원본URL"}},
    {"object": "block", "type": "heading_2", "heading_2": {"rich_text": [{"type": "text", "text": {"content": "섹션제목"}}]}},
    {"object": "block", "type": "paragraph", "paragraph": {"rich_text": [{"type": "text", "text": {"content": "본문내용"}}]}},
    {"object": "block", "type": "image", "image": {"type": "external", "external": {"url": "https://example.com/image.png"}}},
    {"object": "block", "type": "bulleted_list_item", "bulleted_list_item": {"rich_text": [{"type": "text", "text": {"content": "목록항목"}}]}},
    {"object": "block", "type": "code", "code": {"rich_text": [{"type": "text", "text": {"content": "코드내용"}}], "language": "python"}}
  ]
}

## 블록 타입 설명
- bookmark: 원본 URL 링크
- heading_1, heading_2, heading_3: 제목 (# = heading_1, ## = heading_2, ### = heading_3)
- paragraph: 일반 텍스트
- image: 이미지 - Markdown의 ![alt](url) 형식을 이 블록으로 변환
- bulleted_list_item: 글머리 기호 목록 (- 또는 * 항목)
- code: 코드 블록 (\`\`\`language ... \`\`\`)

## 이미지 처리
- Markdown의 ![alt](url) 형식을 찾아서 image 블록으로 변환
- 이미지 블록: {"object": "block", "type": "image", "image": {"type": "external", "external": {"url": "이미지URL"}}}

## 중요 규칙
- API 호출시 예시에 없는 파라미터 추가 금지
- rich_text: {"type": "text", "text": {"content": "..."}} 형식만 사용
- annotations (bold, italic 등) 사용 금지
- text 객체 안에 link 사용 금지
- 페이지 생성 후 응답의 url 필드 값을 반환`;

export const rootAgent = new LlmAgent({
  model: MODEL_NAME,
  name: "translator_agent",
  description: "Translates Markdown content to Korean and saves to Notion",
  instruction: AGENT_INSTRUCTION,
  tools: [
    translateAndCreatePageTool,
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
