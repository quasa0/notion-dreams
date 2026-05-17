"use client";

import { Loader2 } from "lucide-react";
import { clsx } from "clsx";
import useSWR from "swr";
import type { ReportBlock, ReportRichText } from "@/app/lib/types";

async function fetchReportPreview([url, pageId]: [string, string]): Promise<ReportBlock[]> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pageId }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Failed to load report");
  return data.blocks ?? [];
}

export function NotionReportPreview({ pageId, live = false }: { pageId?: string; live?: boolean }) {
  const { data: blocks = [], error, isLoading } = useSWR(
    pageId ? ["/api/report-preview", pageId] : null,
    fetchReportPreview,
    { refreshInterval: live ? 5000 : 0, dedupingInterval: 4500 },
  );

  if (!pageId) {
    return <div className="px-5 py-6 text-[13px] text-mute">No report page was stored for this run.</div>;
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[220px] items-center justify-center gap-2 text-[13px] text-mute">
        <Loader2 size={14} className="animate-spin" />
        Loading report preview
      </div>
    );
  }

  if (error) {
    return <div className="px-5 py-6 text-[13px] text-mute">{error instanceof Error ? error.message : "Failed to load report"}</div>;
  }

  if (blocks.length === 0) {
    return <div className="px-5 py-6 text-[13px] text-mute">This report does not have previewable blocks yet.</div>;
  }

  return (
    <div className="notion-report-preview px-8 py-7">
      {blocks.map((block, index) => (
        <ReportBlockView key={block.id} block={block} index={index} />
      ))}
    </div>
  );
}

function ReportBlockView({ block, index }: { block: ReportBlock; index?: number }) {
  if (block.type === "heading_2") {
    return <h3 className="mb-4 mt-8 text-[28px] font-semibold tracking-tight text-ink"><RichText items={block.rich_text} /></h3>;
  }

  if (block.type === "numbered_list_item") {
    return (
      <div className="mb-6 grid grid-cols-[32px_minmax(0,1fr)] gap-3 text-[16px] leading-[1.5]">
        <div className="pt-0.5 text-right tabular-nums text-ink">{typeof index === "number" ? index - 1 : ""}.</div>
        <div>
          <div className="font-medium text-ink"><RichText items={block.rich_text} /></div>
          {block.children?.length ? (
            <div className="mt-3 space-y-2.5">
              {block.children.map((child) => <ReportBlockView key={child.id} block={child} />)}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (block.type === "quote") {
    const removedBlock = block.color === "red_background";
    const addedBlock = block.color === "green_background";
    return (
      <blockquote
        className={clsx(
          "whitespace-pre-wrap rounded-md border-l-[4px] px-4 py-3 text-[15px] leading-[1.65] text-ink",
          removedBlock && "border-[#B9504B] bg-[#FFF4F2]",
          addedBlock && "border-moss bg-[#F2F8F0]",
          !removedBlock && !addedBlock && "border-ink/80 bg-white",
        )}
      >
        <RichText items={block.rich_text} />
      </blockquote>
    );
  }

  return <p className="mb-2 text-[13px] leading-[1.55] text-mute"><RichText items={block.rich_text} /></p>;
}

function RichText({ items }: { items: ReportRichText[] }) {
  let cursor = 0;
  return <>{items.map((item) => {
    cursor += item.text.length + 1;
    return <RichTextPart key={`${cursor}:${item.text}:${item.href ?? ""}`} item={item} />;
  })}</>;
}

function RichTextPart({ item }: { item: ReportRichText }) {
  const content = (
    <span
      className={clsx(
        item.bold && "font-semibold",
        item.strikethrough && "line-through",
        item.color === "red" && "text-[#C8463D]",
        item.color === "green" && "text-[#3F8F62]",
      )}
    >
      {item.text}
    </span>
  );

  if (item.href) {
    return <a href={item.href} target="_blank" rel="noreferrer" className="underline decoration-ink/35 underline-offset-2 hover:decoration-ink">{content}</a>;
  }

  return content;
}
