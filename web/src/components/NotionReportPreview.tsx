"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { clsx } from "clsx";
import type { ReportBlock, ReportRichText } from "@/app/lib/types";

type PreviewState =
  | { status: "idle" | "loading"; blocks: ReportBlock[]; error?: undefined }
  | { status: "loaded"; blocks: ReportBlock[]; error?: undefined }
  | { status: "error"; blocks: ReportBlock[]; error: string };

export function NotionReportPreview({ pageId }: { pageId?: string }) {
  const [state, setState] = useState<PreviewState>({ status: "idle", blocks: [] });

  useEffect(() => {
    if (!pageId) return;
    let cancelled = false;
    setState({ status: "loading", blocks: [] });

    fetch("/api/report-preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pageId }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Failed to load report");
        if (!cancelled) setState({ status: "loaded", blocks: data.blocks ?? [] });
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            status: "error",
            blocks: [],
            error: error instanceof Error ? error.message : "Failed to load report",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pageId]);

  if (!pageId) {
    return <div className="px-5 py-6 text-[13px] text-mute">No report page was stored for this run.</div>;
  }

  if (state.status === "loading" || state.status === "idle") {
    return (
      <div className="flex min-h-[220px] items-center justify-center gap-2 text-[13px] text-mute">
        <Loader2 size={14} className="animate-spin" />
        Loading report preview
      </div>
    );
  }

  if (state.status === "error") {
    return <div className="px-5 py-6 text-[13px] text-mute">{state.error}</div>;
  }

  if (state.blocks.length === 0) {
    return <div className="px-5 py-6 text-[13px] text-mute">This report does not have previewable blocks yet.</div>;
  }

  return (
    <div className="notion-report-preview px-8 py-7">
      {state.blocks.map((block, index) => (
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
      <div className="mb-3 grid grid-cols-[32px_minmax(0,1fr)] gap-2 text-[16px] leading-[1.5]">
        <div className="pt-0.5 text-right tabular-nums text-ink">{typeof index === "number" ? index - 1 : ""}.</div>
        <div>
          <div className="font-medium text-ink"><RichText items={block.rich_text} /></div>
          {block.children?.length ? (
            <div className="mt-3 space-y-3">
              {block.children.map((child) => <ReportBlockView key={child.id} block={child} />)}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (block.type === "quote") {
    return (
      <blockquote className="border-l-[3px] border-ink/80 py-0.5 pl-5 text-[16px] leading-[1.55] text-ink">
        <RichText items={block.rich_text} />
      </blockquote>
    );
  }

  return <p className="mb-5 text-[18px] leading-[1.55] text-ink"><RichText items={block.rich_text} /></p>;
}

function RichText({ items }: { items: ReportRichText[] }) {
  return <>{items.map((item, index) => <RichTextPart key={index} item={item} />)}</>;
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
