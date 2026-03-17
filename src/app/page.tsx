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
// Constants
// ============================================================================

const STATUS_CONFIG = {
  pending: {
    bgClass: "bg-slate-100 dark:bg-slate-800/50",
    borderClass: "border-slate-200 dark:border-slate-700",
    textClass: "text-slate-600 dark:text-slate-400",
    label: "대기 중",
  },
  processing: {
    bgClass: "bg-indigo-50 dark:bg-indigo-900/20",
    borderClass: "border-indigo-200 dark:border-indigo-800",
    textClass: "text-indigo-600 dark:text-indigo-400",
    label: "처리 중",
  },
  completed: {
    bgClass: "bg-emerald-50 dark:bg-emerald-900/20",
    borderClass: "border-emerald-200 dark:border-emerald-800",
    textClass: "text-emerald-600 dark:text-emerald-400",
    label: "완료",
  },
  error: {
    bgClass: "bg-red-50 dark:bg-red-900/20",
    borderClass: "border-red-200 dark:border-red-800",
    textClass: "text-red-600 dark:text-red-400",
    label: "오류",
  },
} as const;

// ============================================================================
// Icons
// ============================================================================

function IconLink({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
    </svg>
  );
}

function IconPlus({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  );
}

function IconPlay({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function IconTrash({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function IconX({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function IconCheck({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function IconExternalLink({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  );
}

function IconClock({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function IconNotion({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.98-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.886l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952l1.448.327s0 .84-1.168.84l-3.22.186c-.094-.187 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.14c-.093-.514.28-.886.747-.933zM2.872 1.807l13.028-.934c1.635-.14 2.055-.046 3.082.7l4.249 2.986c.7.513.933.653.933 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V3.534c0-.84.374-1.54 1.73-1.727z" />
    </svg>
  );
}

function Spinner({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
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
      const errorMessage = error instanceof Error ? error.message : "Network error";
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
  const completedCount = urlItems.filter((item) => item.status === "completed" || item.status === "error").length;

  return (
    <div className="min-h-screen gradient-bg">
      {/* Decorative Elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-violet-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <header className="text-center mb-12">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-600 dark:from-indigo-400 dark:via-violet-400 dark:to-indigo-400 bg-clip-text text-transparent">
              TTNO
            </h1>
          </header>

          {/* Input Section */}
          <div className="glass rounded-2xl shadow-xl shadow-slate-200/50 dark:shadow-slate-900/50 p-6 mb-8">
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                  <IconLink className="w-5 h-5 text-slate-400" />
                </div>
                <input
                  type="text"
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addUrl();
                  }}
                  placeholder="URL을 입력하세요"
                  className="w-full pl-12 pr-4 py-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl
                             text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500
                             focus-ring transition-smooth"
                />
              </div>
              <button
                onClick={addUrl}
                disabled={!inputUrl.trim()}
                className="group px-6 py-4 rounded-xl font-medium transition-smooth flex items-center gap-2
                           bg-white/60 dark:bg-slate-800/60 backdrop-blur-md
                           border border-indigo-200 dark:border-indigo-500/30
                           text-indigo-600 dark:text-indigo-400
                           hover:bg-indigo-500/10 dark:hover:bg-indigo-500/20
                           hover:border-indigo-400 dark:hover:border-indigo-400/50
                           hover:shadow-lg hover:shadow-indigo-500/10
                           disabled:bg-slate-100/60 disabled:dark:bg-slate-800/40
                           disabled:border-slate-200 disabled:dark:border-slate-700
                           disabled:text-slate-400 disabled:dark:text-slate-600
                           disabled:cursor-not-allowed disabled:shadow-none"
              >
                <IconPlus className="w-5 h-5 transition-transform group-hover:rotate-90" />
                <span className="hidden sm:inline">추가</span>
              </button>
            </div>
          </div>

          {/* URL Queue */}
          {urlItems.length > 0 && (
            <div className="glass rounded-2xl shadow-xl shadow-slate-200/50 dark:shadow-slate-900/50 overflow-hidden mb-8">
              {/* Queue Header */}
              <div className="px-6 py-4 border-b border-slate-200/50 dark:border-slate-700/50">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                      URL 목록
                    </h2>
                    <div className="flex items-center gap-2 text-sm">
                      {pendingCount > 0 && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                          <IconClock className="w-3.5 h-3.5" />
                          {pendingCount}
                        </span>
                      )}
                      {processingCount > 0 && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">
                          <Spinner className="w-3.5 h-3.5" />
                          {processingCount}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {completedCount > 0 && (
                      <button
                        onClick={clearCompleted}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 dark:text-slate-400
                                   hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800
                                   rounded-lg transition-smooth"
                      >
                        <IconTrash className="w-4 h-4" />
                        정리
                      </button>
                    )}
                    <button
                      onClick={processUrls}
                      disabled={isProcessing || pendingCount === 0}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-600
                                 hover:from-emerald-600 hover:to-teal-700 text-white rounded-lg text-sm font-medium
                                 shadow-lg shadow-emerald-500/25
                                 disabled:from-slate-300 disabled:to-slate-400 disabled:shadow-none disabled:cursor-not-allowed
                                 transition-smooth"
                    >
                      {isProcessing ? (
                        <>
                          <Spinner className="w-4 h-4" />
                          처리 중...
                        </>
                      ) : (
                        <>
                          <IconPlay className="w-4 h-4" />
                          번역 시작
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Queue Items */}
              <div className="divide-y divide-slate-200/50 dark:divide-slate-700/50">
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
            <div className="glass rounded-2xl shadow-xl shadow-slate-200/50 dark:shadow-slate-900/50 p-12">
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 mb-6 rounded-full bg-slate-100 dark:bg-slate-800">
                  <IconLink className="w-8 h-8 text-slate-400" />
                </div>
                <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-2">
                  번역할 URL을 추가해주세요
                </h3>
                <p className="text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                  위 입력창에 번역하고 싶은 웹 페이지 URL을 입력하고 추가 버튼을 눌러주세요.
                </p>
              </div>
            </div>
          )}

          {/* Footer */}
          <footer className="mt-12 text-center text-sm text-slate-500 dark:text-slate-400">
            <p>Translate To Notion</p>
          </footer>
        </div>
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
  const config = STATUS_CONFIG[item.status];

  return (
    <div className="px-6 py-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-smooth">
      <div className="flex items-start gap-4">
        {/* Status Indicator */}
        <div className={`flex-shrink-0 mt-0.5 w-8 h-8 rounded-lg ${config.bgClass} flex items-center justify-center`}>
          {item.status === "pending" && (
            <IconClock className={`w-4 h-4 ${config.textClass}`} />
          )}
          {item.status === "processing" && (
            <Spinner className={`w-4 h-4 ${config.textClass}`} />
          )}
          {item.status === "completed" && (
            <IconCheck className={`w-4 h-4 ${config.textClass}`} />
          )}
          {item.status === "error" && (
            <IconX className={`w-4 h-4 ${config.textClass}`} />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${config.bgClass} ${config.textClass}`}>
              {config.label}
            </span>
          </div>
          <p className="text-sm text-slate-900 dark:text-white truncate font-mono">
            {item.url}
          </p>
          {item.error && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-1.5 flex items-center gap-1">
              <IconX className="w-3 h-3" />
              {item.error}
            </p>
          )}
          {item.status === "completed" && (
            <div className="flex items-center gap-4 mt-2">
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400
                           hover:text-indigo-600 dark:hover:text-indigo-400 transition-smooth"
              >
                <IconExternalLink className="w-3.5 h-3.5" />
                원본
              </a>
              {item.notionUrl && (
                <a
                  href={item.notionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400
                             hover:text-emerald-700 dark:hover:text-emerald-300 transition-smooth"
                >
                  <IconNotion className="w-3.5 h-3.5" />
                  Notion에서 보기
                </a>
              )}
            </div>
          )}
        </div>

        {/* Remove Button */}
        {item.status === "pending" && (
          <button
            onClick={onRemove}
            className="flex-shrink-0 p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20
                       rounded-lg transition-smooth"
            aria-label="삭제"
          >
            <IconX className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
}
