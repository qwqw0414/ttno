"use client";

import { useState, useCallback } from "react";

// ============================================================================
// Types
// ============================================================================

interface UrlItem {
  id: string;
  url: string;
  status: "pending" | "processing" | "completed" | "error";
  notionUrl?: string;
  error?: string;
}

interface ApiResult {
  success: boolean;
  originalUrl: string;
  notionUrl?: string;
  error?: string;
}

// ============================================================================
// Page Component
// ============================================================================

export default function Home() {
  const [inputUrl, setInputUrl] = useState("");
  const [urlItems, setUrlItems] = useState<UrlItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const addUrl = useCallback(() => {
    const trimmedUrl = inputUrl.trim();
    if (!trimmedUrl) return;

    const newItem: UrlItem = {
      id: `${Date.now()}_${Math.random().toString(36).substring(7)}`,
      url: trimmedUrl.startsWith("http") ? trimmedUrl : `https://${trimmedUrl}`,
      status: "pending",
    };

    setUrlItems((prev) => [...prev, newItem]);
    setInputUrl("");
  }, [inputUrl]);

  const removeUrl = useCallback((id: string) => {
    setUrlItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const processUrls = useCallback(async () => {
    const pendingItems = urlItems.filter((item) => item.status === "pending");
    if (pendingItems.length === 0) return;

    setIsProcessing(true);

    // 모든 pending 항목을 processing으로 변경
    setUrlItems((prev) =>
      prev.map((item) =>
        item.status === "pending" ? { ...item, status: "processing" } : item
      )
    );

    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urls: pendingItems.map((item) => item.url),
        }),
      });

      const data = await response.json();

      if (data.success && data.results) {
        const resultsMap = new Map<string, ApiResult>();
        data.results.forEach((result: ApiResult) => {
          resultsMap.set(result.originalUrl, result);
        });

        setUrlItems((prev) =>
          prev.map((item) => {
            if (item.status !== "processing") return item;

            const result = resultsMap.get(item.url);
            if (result) {
              return {
                ...item,
                status: result.success ? "completed" : "error",
                notionUrl: result.notionUrl,
                error: result.error,
              };
            }
            return { ...item, status: "error", error: "No response received" };
          })
        );
      } else {
        setUrlItems((prev) =>
          prev.map((item) =>
            item.status === "processing"
              ? { ...item, status: "error", error: data.error || "Unknown error" }
              : item
          )
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Network error";
      setUrlItems((prev) =>
        prev.map((item) =>
          item.status === "processing"
            ? { ...item, status: "error", error: errorMessage }
            : item
        )
      );
    } finally {
      setIsProcessing(false);
    }
  }, [urlItems]);

  const clearCompleted = useCallback(() => {
    setUrlItems((prev) =>
      prev.filter((item) => item.status !== "completed" && item.status !== "error")
    );
  }, []);

  const pendingCount = urlItems.filter((item) => item.status === "pending").length;
  const processingCount = urlItems.filter((item) => item.status === "processing").length;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            TTNO
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Translate To Notion - 웹 페이지를 한국어로 번역하여 Notion에 저장
          </p>
        </div>

        {/* Input Section */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6">
          <div className="flex gap-3">
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addUrl();
              }}
              placeholder="URL을 입력하세요 (예: google.github.io/adk-docs/)"
              className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg
                         bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                         focus:ring-2 focus:ring-blue-500 focus:border-transparent
                         placeholder-gray-400 dark:placeholder-gray-500"
            />
            <button
              onClick={addUrl}
              disabled={!inputUrl.trim()}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium
                         hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed
                         transition-colors"
            >
              추가
            </button>
          </div>
        </div>

        {/* URL Queue */}
        {urlItems.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                URL 목록 ({urlItems.length})
              </h2>
              <div className="flex gap-2">
                {(urlItems.some((i) => i.status === "completed" || i.status === "error")) && (
                  <button
                    onClick={clearCompleted}
                    className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400
                               hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
                  >
                    완료 항목 삭제
                  </button>
                )}
                <button
                  onClick={processUrls}
                  disabled={isProcessing || pendingCount === 0}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium
                             hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed
                             transition-colors"
                >
                  {isProcessing
                    ? `처리 중... (${processingCount})`
                    : `번역 시작 (${pendingCount})`}
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {urlItems.map((item) => (
                <UrlItemCard
                  key={item.id}
                  item={item}
                  onRemove={() => removeUrl(item.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {urlItems.length === 0 && (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            <p>번역할 URL을 추가해주세요</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// URL Item Card Component
// ============================================================================

function UrlItemCard({
  item,
  onRemove,
}: {
  item: UrlItem;
  onRemove: () => void;
}) {
  const statusConfig = {
    pending: {
      bg: "bg-gray-100 dark:bg-gray-700",
      text: "text-gray-600 dark:text-gray-400",
      label: "대기 중",
      icon: "○",
    },
    processing: {
      bg: "bg-blue-50 dark:bg-blue-900/30",
      text: "text-blue-600 dark:text-blue-400",
      label: "처리 중",
      icon: "◎",
    },
    completed: {
      bg: "bg-green-50 dark:bg-green-900/30",
      text: "text-green-600 dark:text-green-400",
      label: "완료",
      icon: "●",
    },
    error: {
      bg: "bg-red-50 dark:bg-red-900/30",
      text: "text-red-600 dark:text-red-400",
      label: "오류",
      icon: "✕",
    },
  };

  const config = statusConfig[item.status];

  return (
    <div className={`p-4 rounded-lg ${config.bg}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-sm font-medium ${config.text}`}>
              {config.icon} {config.label}
            </span>
            {item.status === "processing" && (
              <span className="inline-block w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            )}
          </div>
          <p className="text-sm text-gray-900 dark:text-white truncate">
            {item.url}
          </p>
          {item.error && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-1">
              {item.error}
            </p>
          )}
          {item.status === "completed" && (
            <div className="flex gap-3 mt-2">
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                원본 보기
              </a>
              {item.notionUrl && (
                <a
                  href={item.notionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-green-600 dark:text-green-400 hover:underline"
                >
                  Notion에서 보기
                </a>
              )}
            </div>
          )}
        </div>
        {item.status === "pending" && (
          <button
            onClick={onRemove}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200
                       transition-colors p-1"
            aria-label="삭제"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
