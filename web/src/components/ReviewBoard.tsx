"use client";

import Image from "next/image";
import { useEffect, useMemo, useReducer, useState } from "react";
import { ArrowRight, Check, Code2, FilePlus2, Loader2, RefreshCw, Shuffle, Terminal, Trash2, X, Zap } from "lucide-react";
import { clsx } from "clsx";
import type { DreamEdit, DreamRun } from "@/app/lib/types";
import { NotionReportPreview } from "./NotionReportPreview";

type Props = { initialEdits: DreamEdit[]; initialRuns: DreamRun[]; source: "notion" | "demo" };
type DashboardData = { edits: DreamEdit[]; runs: DreamRun[]; source: "notion" | "demo" };
type FilterId = "changed" | "skipped" | "all";
type DetailTab = "overview" | "logs";
type SeededPage = { id: string; title: string; url?: string };
type BoardState = {
  topBusy: "refresh" | "trigger" | "seed" | "mingle" | null;
  seedResult: string | null;
  seededPages: SeededPage[];
  noticeExpiresAt: number | null;
  edits: DreamEdit[];
  runs: DreamRun[];
  selectedRunKey: string | null;
  detailTab: DetailTab;
};
type BoardAction =
  | { type: "busy"; value: BoardState["topBusy"] }
  | { type: "notice"; message: string | null; pages?: SeededPage[]; expiresAt?: number | null }
  | { type: "selectRun"; key: string | null; tab?: DetailTab }
  | { type: "optimisticRun"; run: DreamRun }
  | { type: "removeRun"; key: string }
  | { type: "dashboardData"; data: DashboardData }
  | { type: "runs"; updater: (runs: DreamRun[]) => DreamRun[] };

const pacificReportFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "America/Los_Angeles",
});

function initBoardState({ initialEdits, initialRuns }: Props): BoardState {
  return {
    topBusy: null,
    seedResult: null,
    seededPages: [],
    noticeExpiresAt: null,
    edits: initialEdits,
    runs: initialRuns,
    selectedRunKey: initialRuns[0]?.key ?? null,
    detailTab: "overview",
  };
}

function boardReducer(state: BoardState, action: BoardAction): BoardState {
  switch (action.type) {
    case "busy":
      return { ...state, topBusy: action.value };
    case "notice":
      return {
        ...state,
        seedResult: action.message,
        seededPages: action.pages ?? [],
        noticeExpiresAt: action.expiresAt ?? null,
      };
    case "selectRun":
      return { ...state, selectedRunKey: action.key, detailTab: action.tab ?? "overview" };
    case "optimisticRun":
      return {
        ...state,
        runs: [action.run, ...state.runs.filter((run) => run.key !== action.run.key)],
        selectedRunKey: action.run.key,
      };
    case "removeRun":
      return { ...state, runs: state.runs.filter((run) => run.key !== action.key) };
    case "dashboardData": {
      const runs = mergeRunsWithInitiating(action.data.runs, state.runs);
      const selectedRunKey = runs.some((run) => run.key === state.selectedRunKey) ? state.selectedRunKey : runs[0]?.key ?? null;
      return { ...state, edits: action.data.edits, runs, selectedRunKey };
    }
    case "runs": {
      const runs = action.updater(state.runs);
      const selectedRunKey = runs.some((run) => run.key === state.selectedRunKey) ? state.selectedRunKey : runs[0]?.key ?? null;
      return { ...state, runs, selectedRunKey };
    }
  }
}

export function ReviewBoard({ initialEdits, initialRuns }: Props) {
  const [filter, setFilter] = useState<FilterId>("changed");
  const [state, dispatch] = useReducer(boardReducer, { initialEdits, initialRuns, source: "notion" }, initBoardState);
  const { topBusy, seedResult, seededPages, noticeExpiresAt, edits, runs, selectedRunKey, detailTab } = state;
  const changedCount = edits.filter((e) => e.status === "changed").length;
  const skippedCount = edits.filter((e) => e.status === "skipped").length;
  const visible = useMemo(() => filter === "all" ? edits : edits.filter((e) => e.status === filter), [filter, edits]);
  const lastRun = runs[0];
  const [now, setNow] = useState<number | null>(null);
  const selectedRun = runs.find((run) => run.key === selectedRunKey) ?? runs[0] ?? null;
  const hasActiveRun = runs.some(isRunActive);
  useEffect(() => {
    refreshDashboardData().catch((error) => console.error("Failed to refresh dashboard on mount", error));
  }, []);
  useEffect(() => {
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => {
    if (!hasActiveRun) return;
    const interval = window.setInterval(() => {
      refreshDashboardData().catch((error) => console.error("Failed to refresh in-progress run", error));
    }, 500);
    return () => window.clearInterval(interval);
  }, [hasActiveRun]);
  useEffect(() => {
    if (!noticeExpiresAt) return;
    if (!now) return;
    if (now >= noticeExpiresAt) {
      dispatch({ type: "notice", message: null });
    }
  }, [noticeExpiresAt, now]);
  function selectRun(key: string, tab: DetailTab = "overview") {
    dispatch({ type: "selectRun", key, tab });
  }
  async function triggerDream() {
    const requestedAt = new Date().toISOString();
    const optimisticRun = initiatingRun(requestedAt);
    dispatch({ type: "busy", value: "trigger" });
    dispatch({ type: "optimisticRun", run: optimisticRun });
    try {
      const response = await fetch("/api/trigger-dream", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Failed to trigger dream");
      await refreshDashboardData(requestedAt);
    } catch (error) {
      dispatch({ type: "removeRun", key: optimisticRun.key });
      window.alert(error instanceof Error ? error.message : "Failed to trigger dream");
    } finally {
      dispatch({ type: "busy", value: null });
    }
  }
  async function refreshDashboard() {
    dispatch({ type: "busy", value: "refresh" });
    try {
      await refreshDashboardData();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to refresh dashboard");
    } finally {
      dispatch({ type: "busy", value: null });
    }
  }
  async function refreshDashboardData(waitForRanAt?: string) {
    const data = waitForRanAt ? await waitForDashboardRun(waitForRanAt) : await fetchDashboardData();
    dispatch({ type: "dashboardData", data });
  }
  async function seedFastclipPages() {
    dispatch({ type: "busy", value: "seed" });
    dispatch({ type: "notice", message: null });
    try {
      const response = await fetch("/api/seed-fastclip", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Failed to create pages");
      dispatch({ type: "notice", message: `Created ${data.created.length} fastclip.it pages in Notion`, pages: data.created ?? [], expiresAt: Date.now() + 10000 });
    } catch (error) {
      dispatch({ type: "notice", message: error instanceof Error ? error.message : "Failed to create pages", expiresAt: Date.now() + 10000 });
    } finally {
      dispatch({ type: "busy", value: null });
    }
  }
  async function minglePages() {
    dispatch({ type: "busy", value: "mingle" });
    dispatch({ type: "notice", message: null });
    try {
      const response = await fetch("/api/mingle-pages", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Failed to mingle pages");
      dispatch({ type: "notice", message: `Mingled ${data.edited.length} existing pages in Notion`, pages: data.edited ?? [], expiresAt: Date.now() + 10000 });
    } catch (error) {
      dispatch({ type: "notice", message: error instanceof Error ? error.message : "Failed to mingle pages", expiresAt: Date.now() + 10000 });
    } finally {
      dispatch({ type: "busy", value: null });
    }
  }
  return <div className="min-h-screen bg-paper text-ink">
    <header className="sticky top-0 z-20 border-b border-line bg-paper/85 backdrop-blur"><div className="mx-auto flex max-w-[1480px] items-center justify-between gap-6 px-8 py-3.5"><div className="flex items-center gap-3"><Logo/><div className="flex flex-wrap items-center gap-2.5"><span className="text-[14px] font-semibold tracking-tight sm:text-[15px]">Notion Dreams</span><span className="hidden h-4 w-px bg-line sm:block"/><span className="rounded-md border border-line bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-mute">notion worker</span></div></div><div className="hidden items-center gap-7 md:flex"><TopStat k="last run" v={lastRun && now ? relativeFromNow(lastRun.ran_at, now) : "—"} mono/></div><div className="flex items-center gap-2"><button onClick={refreshDashboard} disabled={topBusy!==null} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-white px-2.5 text-[12px] font-medium text-ink transition-colors hover:bg-paper2 disabled:opacity-50"><RefreshCw size={13} className={topBusy==="refresh" ? "animate-spin" : ""}/>Refresh</button><button onClick={triggerDream} disabled={topBusy!==null} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-ink px-3 text-[12px] font-medium text-paper transition-colors hover:bg-[#0B100D] disabled:opacity-60">{topBusy==="trigger" ? <Loader2 size={13} className="animate-spin"/> : <Zap size={12}/>} {topBusy==="trigger" ? "Dreaming..." : "Trigger dream"}</button></div></div></header>
    <main className="mx-auto max-w-[1480px] px-8 pb-24 pt-8">{seedResult&&noticeExpiresAt&&now&&<SeedNotice message={seedResult} pages={seededPages} expiresAt={noticeExpiresAt} now={now}/>}<div className="grid grid-cols-12 items-end gap-10"><div className="col-span-12 lg:col-span-7 xl:col-span-8"><div className="font-mono text-[10px] uppercase tracking-[0.18em] text-mute">background editor · worker</div><h1 className="mt-3 max-w-3xl text-[44px] font-semibold leading-[1.05] tracking-tight">Cleaner Notion, overnight.</h1><p className="mt-3 max-w-xl text-[14.5px] leading-[1.6] text-mute">Scans changed pages, tightens wording, and writes an audit report.</p></div><div className="col-span-12 lg:col-span-5 xl:col-span-4"><DemoControls busy={topBusy} onSeed={seedFastclipPages} onMingle={minglePages}/></div></div><div className="mt-12 grid grid-cols-12 gap-10"><aside className="col-span-12 lg:col-span-3"><RunHistory runs={runs} now={now} selectedKey={selectedRun?.key ?? null} onSelect={selectRun} onRunsChange={(updater)=>dispatch({type:"runs",updater})}/></aside><section className="col-span-12 lg:col-span-9">{selectedRun?<RunDetail run={selectedRun} initialTab={detailTab}/>:<><div className="flex items-end justify-between border-b border-line pb-3"><div className="flex items-baseline gap-3"><h2 className="text-[15px] font-semibold tracking-tight">Dream edits</h2><span className="font-mono text-[11px] text-mute">{visible.length} shown</span></div><FilterTabs value={filter} onChange={setFilter} counts={{changed:changedCount, skipped:skippedCount, all:edits.length}}/></div><div className="mt-6 flex flex-col gap-6">{visible.length>0 ? visible.map((edit)=><EditRow key={edit.id} edit={edit}/>) : <EmptyState/>}</div></>}</section></div></main></div>;
}
async function fetchDashboardData(): Promise<DashboardData> {
  const response = await fetch(`/api/dashboard?t=${Date.now()}`, {
    cache: "no-store",
    headers: { "cache-control": "no-cache" },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Failed to refresh dashboard");
  return data;
}
async function waitForDashboardRun(ranAt: string, deadline = Date.now() + 1000 * 30, latest?: DashboardData): Promise<DashboardData> {
  const current = latest ?? await fetchDashboardData();
  const targetMs = new Date(ranAt).getTime();
  if (current.runs.some((run) => run.ran_at && new Date(run.ran_at).getTime() >= targetMs - 5000)) return current;
  if (Date.now() >= deadline) return current;
  await new Promise((resolve) => setTimeout(resolve, 500));
  return waitForDashboardRun(ranAt, deadline, await fetchDashboardData());
}
function initiatingRun(requestedAt:string):DreamRun{return{key:`initiating-${requestedAt}`,run_id:"Initiating dream",ran_at:requestedAt,blocks_changed:0,blocks_reviewed:0,pages_scanned:0,status:"initiating",source:"manual"}}
function isRunActive(run: DreamRun){const status=(run.status??"").toLowerCase();return status==="initiating"||status==="in progress"}
function isRunInProgress(run: DreamRun){return (run.status??"").toLowerCase()==="in progress"}
function isRunInitiating(run: DreamRun){return (run.status??"").toLowerCase()==="initiating"}
function runStatusMeta(run: DreamRun){const status=(run.status??"").toLowerCase();if(status==="initiating")return{label:"Initiating",dot:"bg-amber",badge:"bg-amberSoft text-amber",icon:Loader2,spin:true,tone:"active" as const};if(status==="in progress")return{label:"In progress",dot:"bg-amber",badge:"bg-amberSoft text-amber",icon:Loader2,spin:true,tone:"active" as const};if(status==="failed"||status==="error")return{label:"Failed",dot:"bg-[#C8463D]",badge:"bg-[#F8DDD9] text-[#A43A32]",icon:X,spin:false,tone:"failed" as const};if(status==="succeeded"||status==="success"||status==="done"||status==="completed"||status==="complete")return{label:"Succeeded",dot:"bg-moss",badge:"bg-mossSoft text-moss",icon:Check,spin:false,tone:"succeeded" as const};return{label:run.status??"Unknown",dot:"bg-mute",badge:"bg-paper2 text-mute",icon:Code2,spin:false,tone:"unknown" as const}}
function mergeRunsWithInitiating(fresh:DreamRun[],current:DreamRun[]){const now=Date.now();const activeFresh=fresh.some((run)=>isRunInProgress(run)||new Date(run.ran_at??0).getTime()>now-120000);const initiating=current.filter((run)=>isRunInitiating(run)&&!activeFresh&&now-new Date(run.ran_at??0).getTime()<120000);return[...initiating,...fresh]}
function TopStat({k,v,mono=false}:{k:string;v:string|number;mono?:boolean}){return <div className="flex items-baseline gap-2"><span className="font-mono text-[10px] uppercase tracking-[0.14em] text-mute">{k}</span><span className={clsx("text-[13px] font-semibold tabular-nums", mono && "font-mono")}>{v}</span></div>}
function Logo(){return <div className="flex size-7 items-center justify-center rounded-md border border-line bg-white"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="#111714" strokeWidth="1.4"/><path d="M4 8.2c2.2.9 4.1-.4 4.7-3.2 1.1 1.4 1.4 3.9-.2 5.2-1.4 1.1-3.6.7-4.5-2Z" stroke="#4F7A5C" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg></div>}
function DemoControls({busy,onSeed,onMingle}:{busy:"refresh"|"trigger"|"seed"|"mingle"|null;onSeed:()=>void;onMingle:()=>void}){return <section className="rounded-lg border border-line bg-white p-4 shadow-soft"><div className="flex items-start justify-between gap-4"><div><div className="font-mono text-[10px] uppercase tracking-[0.16em] text-mute">Demo controls</div><h2 className="mt-1 text-[15px] font-semibold tracking-tight">Prepare Notion pages</h2></div><span className="rounded-md bg-mossSoft px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-moss">live</span></div><div className="mt-4 grid gap-2"><button onClick={onSeed} disabled={busy!==null} className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-line bg-paper px-3 text-[12px] font-medium text-ink transition-colors hover:bg-paper2 disabled:opacity-50">{busy==="seed" ? <Loader2 size={13} className="animate-spin"/> : <FilePlus2 size={13}/>}Generate new pages</button><button onClick={onMingle} disabled={busy!==null} className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-line bg-paper px-3 text-[12px] font-medium text-ink transition-colors hover:bg-paper2 disabled:opacity-50">{busy==="mingle" ? <Loader2 size={13} className="animate-spin"/> : <Shuffle size={13}/>}Update some pages</button></div></section>}
function FilterTabs({value,onChange,counts}:{value:FilterId;onChange:(v:FilterId)=>void;counts:Record<FilterId,number>}){const opts:{id:FilterId;label:string}[]=[{id:"changed",label:"Changed"},{id:"skipped",label:"Skipped"},{id:"all",label:"All"}];return <div className="flex items-center gap-1 rounded-md border border-line bg-white p-0.5">{opts.map((o)=>{const active=value===o.id;return <button key={o.id} onClick={()=>onChange(o.id)} className={clsx("inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-[12px] font-medium transition-colors",active?"bg-ink text-paper":"text-mute hover:text-ink")}>{o.label}<span className={clsx("font-mono text-[10px]",active?"text-paper/70":"text-mute2")}>{counts[o.id]}</span></button>})}</div>}
function RunHistory({runs,now,selectedKey,onSelect,onRunsChange}:{runs:DreamRun[];now:number|null;selectedKey:string|null;onSelect:(key:string,tab?:DetailTab)=>void;onRunsChange:(updater:(runs:DreamRun[])=>DreamRun[])=>void}){const [busy,setBusy]=useState<string|null>(null);const showSleeping=runs.some(isRunActive);async function deleteRun(run:DreamRun,mode:"report"|"run-and-report"){setBusy(`${run.key}:${mode}`);try{const response=await fetch("/api/delete-run",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({mode,runPageId:run.run_page_id??run.key,reportPageId:run.report_page_id})});const data=await response.json();if(!response.ok)throw new Error(data.error??"Delete failed");if(mode==="run-and-report"){onRunsChange((current)=>current.filter((item)=>item.key!==run.key));}else{onRunsChange((current)=>current.map((item)=>item.key===run.key?{...item,report_page_id:undefined,report_url:undefined}:item));}}catch(error){window.alert(error instanceof Error ? error.message : "Delete failed");}finally{setBusy(null);}}return <div className="lg:sticky lg:top-[68px]"><div className="border-b border-line pb-3"><div className="flex items-baseline justify-between gap-3"><h2 className="text-[15px] font-semibold tracking-tight">Notion Worker runs</h2></div><div className="relative mt-3 aspect-video overflow-hidden rounded-lg bg-paper2"><video src="/videos/idle-360.mp4" autoPlay muted loop playsInline preload="auto" className={clsx("absolute inset-0 h-full w-full object-cover transition-opacity duration-300",showSleeping?"opacity-0":"opacity-100")}/><video src="/videos/sleeping-360.mp4" autoPlay muted loop playsInline preload="auto" className={clsx("absolute inset-0 h-full w-full object-cover transition-opacity duration-300",showSleeping?"opacity-100":"opacity-0")}/><div className={clsx("absolute left-2 top-2 z-10 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] drop-shadow-sm",showSleeping?"text-amber":"text-ink")}>{showSleeping?"Dreaming...":"Idle"}</div></div></div><ol className="mt-5 flex flex-col pr-2">{runs.map((r,i)=>{const status=runStatusMeta(r);const Icon=status.icon;const deletingReport=busy===`${r.key}:report`;const deletingBoth=busy===`${r.key}:run-and-report`;const reportName=humanReportName(r);const added=r.chars_added??0;const removed=r.chars_removed??0;return <li key={r.key} onClick={()=>onSelect(r.key,"overview")} onKeyDown={(event)=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();onSelect(r.key,"overview");}}} role="button" tabIndex={0} className={clsx("relative grid cursor-pointer grid-cols-[26px_1fr] gap-3 rounded-md pb-5 transition-colors",selectedKey===r.key&&"bg-white/70")}>{i<runs.length-1&&<span className="absolute left-[12px] top-5 h-full w-px bg-line"/>}<span className={clsx("relative z-10 mt-0.5 flex size-6 items-center justify-center rounded-full ring-4 ring-paper",status.dot)}><Icon size={12} strokeWidth={2.3} className={clsx("text-white",status.spin&&"animate-spin")}/></span><div className="min-w-0"><div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2"><span className="font-mono text-[11px] tabular-nums text-ink">{now ? relativeFromNow(r.ran_at, now) : "—"}</span><span className={clsx("justify-self-end rounded px-1.5 py-0.5 text-right font-mono text-[9.5px] leading-tight tracking-[0.04em]",status.badge)}>{status.label}</span></div><div className="mt-1 truncate text-[12px] font-medium text-ink" title={reportName}>{reportName}</div><div className="mt-0.5 flex items-baseline justify-between gap-3 text-[12.5px] text-mute"><span><span className="font-semibold text-ink tabular-nums">{r.blocks_changed ?? 0}</span> blocks changed</span><span className="shrink-0 font-mono text-[11px] font-semibold tabular-nums"><span className="text-moss">+{added}</span><span className="ml-1.5 text-[#C8463D]">-{removed}</span></span></div><div className="mt-2 flex flex-wrap gap-1.5">{r.report_url&&<a href={r.report_url} target="_blank" rel="noreferrer" onClick={(event)=>event.stopPropagation()} className="rounded border border-line bg-white px-2 py-1 font-mono text-[10px] text-mute hover:text-ink">Open report</a>}<button onClick={(event)=>{event.stopPropagation();onSelect(r.key,"logs");}} disabled={isRunInitiating(r)} className="inline-flex items-center gap-1 rounded border border-line bg-white px-2 py-1 font-mono text-[10px] text-mute hover:text-ink disabled:opacity-40"> <Terminal size={10}/> Logs</button><button onClick={(event)=>{event.stopPropagation();deleteRun(r,"report");}} disabled={!r.report_page_id||busy!==null||isRunInitiating(r)} className="inline-flex items-center gap-1 rounded border border-line bg-white px-2 py-1 font-mono text-[10px] text-mute hover:text-ink disabled:opacity-40">{deletingReport?<Loader2 size={10} className="animate-spin"/>:<Trash2 size={10}/>} Report</button><button onClick={(event)=>{event.stopPropagation();deleteRun(r,"run-and-report");}} disabled={busy!==null||isRunInitiating(r)} className="inline-flex items-center gap-1 rounded border border-line bg-white px-2 py-1 font-mono text-[10px] text-mute hover:text-ink disabled:opacity-40">{deletingBoth?<Loader2 size={10} className="animate-spin"/>:<Trash2 size={10}/>} Run</button></div></div></li>})}</ol></div>}
function RunDetail({run,initialTab}:{run:DreamRun;initialTab:DetailTab}){const [tab,setTab]=useState<DetailTab>("overview");const [logs,setLogs]=useState<{status:"idle"|"loading"|"loaded"|"error";text:string;meta?:string}>({status:"idle",text:""});useEffect(()=>{setLogs({status:"idle",text:""});if(initialTab==="logs"){loadLogs();}else{setTab("overview");}},[run.key,initialTab]);async function loadLogs(){setTab("logs");if(logs.status==="loaded"||logs.status==="loading")return;setLogs({status:"loading",text:""});try{const response=await fetch("/api/run-logs",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({ranAt:run.ran_at})});const data=await response.json();if(!response.ok)throw new Error(data.error??"Failed to load logs");const prefix=data.hasTypeScriptLogs?"":`No detailed [dreams] TypeScript logs were captured for this older run. New worker runs include the detailed execution trace.\n\n`;setLogs({status:"loaded",text:`${prefix}${data.logs??""}`.trim(),meta:`${data.runId} · exit ${data.exitCode}`});}catch(error){setLogs({status:"error",text:error instanceof Error?error.message:"Failed to load logs"});}}const reportName=humanReportName(run);const reportUrl=run.public_report_url??run.report_url;const hasZeroTextDelta=(run.chars_added??0)===0&&(run.chars_removed??0)===0;const hasZeroPagesChanged=(run.pages_scanned??0)===0;const assistantImage=hasZeroTextDelta||hasZeroPagesChanged?"/notion-dreams-zero-change.png":"/notion-dreams-girl.png";return <div><div className="flex items-start justify-between gap-6 border-b border-line pb-4"><div><div className="font-mono text-[10px] uppercase tracking-[0.18em] text-mute">selected run</div><h2 className="mt-1 text-[22px] font-semibold tracking-tight">{reportName}</h2><p className="mt-1 font-mono text-[11px] text-mute">{run.run_id}</p></div></div><div className="mt-4 flex gap-1 rounded-md border border-line bg-white p-0.5 w-fit"><button onClick={()=>setTab("overview")} className={clsx("rounded px-3 py-1.5 text-[12px] font-medium",tab==="overview"?"bg-ink text-paper":"text-mute hover:text-ink")}>Overview</button><button onClick={loadLogs} className={clsx("rounded px-3 py-1.5 text-[12px] font-medium",tab==="logs"?"bg-ink text-paper":"text-mute hover:text-ink")}>TypeScript logs</button></div>{tab==="overview"?<div className="mt-5"><div className="grid items-stretch gap-1 xl:grid-cols-[minmax(0,1fr)_156px]"><div className="mb-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line"><DetailCell label="blocks reviewed" value={run.blocks_reviewed??0}/><DiffStatCell added={run.chars_added??0} removed={run.chars_removed??0}/><DetailCell label="blocks changed" value={run.blocks_changed??0}/><DetailCell label="pages changed" value={run.pages_scanned??0}/><DetailCell label="started" value={run.ran_at?humanReportName({...run,run_id:undefined}):"—"}/><StatusDetailCell run={run}/></div><div className="flex min-h-[230px] items-end justify-end overflow-hidden"><Image src={assistantImage} alt="Notion Dreams assistant" width={220} height={360} className="h-full max-h-[360px] w-auto max-w-none object-contain object-bottom"/></div></div><ReportEmbed run={run} url={reportUrl} isPublic={Boolean(run.public_report_url)}/></div>:<div className="mt-5 overflow-hidden rounded-xl border border-line bg-[#111714] text-paper"><div className="border-b border-white/10 px-4 py-2 font-mono text-[11px] text-paper/70">{logs.status==="loading"?"Loading worker logs...":logs.meta??"Worker execution logs"}</div><pre className="max-h-[560px] overflow-auto whitespace-pre-wrap p-4 font-mono text-[11px] leading-[1.6]">{logs.status==="idle"?"Loading worker logs...":logs.text}</pre></div>}</div>}
function DetailCell({label,value}:{label:string;value:string|number}){return <div className="flex min-h-[92px] flex-col items-end bg-white p-4 text-right"><div className="font-mono text-[10px] uppercase tracking-[0.14em] text-mute">{label}</div><div className="mt-2 max-w-full break-words text-[15px] font-semibold text-ink">{value}</div></div>}
function StatusDetailCell({run}:{run:DreamRun}){const status=runStatusMeta(run);const Icon=status.icon;return <div className="flex min-h-[92px] flex-col items-end bg-white p-4 text-right"><div className="font-mono text-[10px] uppercase tracking-[0.14em] text-mute">status</div><div className={clsx("mt-2 inline-flex max-w-full items-center gap-2 break-words text-[15px] font-semibold",status.tone==="active"&&"text-amber",status.tone==="succeeded"&&"text-moss",status.tone==="failed"&&"text-[#A43A32]",status.tone==="unknown"&&"text-ink")}><span className={clsx("flex size-5 shrink-0 items-center justify-center rounded-full",status.dot)}><Icon size={12} strokeWidth={2.4} className={clsx("text-white",status.spin&&"animate-spin")}/></span>{status.label.toLowerCase()}</div></div>}
function DiffStatCell({added,removed}:{added:number;removed:number}){return <div className="flex min-h-[92px] flex-col items-end bg-white p-4 text-right"><div className="font-mono text-[10px] uppercase tracking-[0.14em] text-mute">text delta</div><div className="mt-2 flex items-baseline justify-end gap-2 font-mono text-[15px] font-semibold tabular-nums"><span className="text-moss">+{added}</span><span className="text-[#C8463D]">-{removed}</span></div></div>}
function ReportEmbed({run,url,isPublic}:{run:DreamRun;url?:string;isPublic:boolean}){return <div className="overflow-hidden rounded-xl border border-line bg-white"><div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3"><div><div className="font-mono text-[10px] uppercase tracking-[0.14em] text-mute">Notion report</div>{!isPublic&&<p className="mt-1 text-[12px] text-mute">Rendered from Notion page data inside the dashboard. Open in Notion to view the original page.</p>}</div>{url&&<a href={url} target="_blank" rel="noreferrer" className="shrink-0 rounded-md border border-line bg-paper px-2.5 py-1.5 text-[12px] font-medium text-ink hover:bg-paper2">Open</a>}</div><NotionReportPreview pageId={run.report_page_id}/></div>}
function EditRow({edit}:{edit:DreamEdit}){return <article className="overflow-hidden rounded-lg border border-line bg-white shadow-soft"><header className="flex flex-wrap items-start justify-between gap-6 border-b border-line bg-[#FCFBF7] px-6 pb-4 pt-5"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2.5"><h3 className="truncate text-[17px] font-semibold tracking-tight">{edit.page}</h3><StatusPill status={edit.status}/></div><div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11.5px] text-mute"><span className="truncate">{edit.path}</span><span className="text-line">·</span><span>{edit.block_type}</span></div></div></header><div className="px-6 py-5"><div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-mute"><span>Before</span><ArrowRight size={12}/><span>After</span></div><div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"><TextPanel title="Removed text" body={edit.before_text} tone="removed"/><TextPanel title="Replacement" body={edit.after_text} tone="added"/></div><div className="mt-4 border-l-2 border-moss bg-mossSoft/45 px-4 py-3"><div className="font-mono text-[10px] uppercase tracking-[0.14em] text-moss">Dream reason</div><p className="mt-1.5 text-[13px] leading-[1.6] text-ink">{edit.edit_reason}</p></div></div></article>}
function StatusPill({status}:{status:string}){const cfg=status==="changed"?{label:"changed",cls:"bg-mossSoft text-moss",dot:"bg-moss"}:status==="skipped"?{label:"skipped",cls:"bg-paper2 text-mute",dot:"bg-mute2"}:{label:"pending",cls:"bg-amberSoft text-amber",dot:"bg-amber"};return <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em]",cfg.cls)}><span className={clsx("h-1.5 w-1.5 rounded-full",cfg.dot)}/>{cfg.label}</span>}
function TextPanel({title,body,tone}:{title:string;body:string;tone:"removed"|"added"}){const removed=tone==="removed";return <figure className={clsx("min-h-[180px] border-l-4 px-4 py-3",removed?"border-[#B9504B] bg-[#FFF4F2]":"border-moss bg-[#F2F8F0]")}><figcaption className={clsx("font-mono text-[10px] uppercase tracking-[0.14em]",removed?"text-[#9D3E39]":"text-moss")}>{title}</figcaption><blockquote className="relative mt-3 text-[14px] leading-[1.75] text-ink"><span className={clsx("absolute -left-1 -top-3 select-none text-[32px] leading-none",removed?"text-[#E0A09B]":"text-[#A8C8A7]")}>“</span><p className="pl-5">{body}</p></blockquote></figure>}
function SeedNotice({message,pages,expiresAt,now}:{message:string;pages:SeededPage[];expiresAt:number;now:number}){const total=10000;const remaining=Math.max(0,expiresAt-now);const progress=remaining/total;const radius=9;const circumference=2*Math.PI*radius;return <div className="mb-5 flex items-start gap-3 rounded-md border border-line bg-white px-4 py-3 text-[13px] text-ink shadow-soft"><div className="mt-0.5 size-6 shrink-0"><svg viewBox="0 0 24 24" className="-rotate-90"><circle cx="12" cy="12" r={radius} fill="none" stroke="#E1DED6" strokeWidth="2"/><circle cx="12" cy="12" r={radius} fill="none" stroke="#4F7A5C" strokeWidth="2" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference*(1-progress)}/></svg></div><div className="min-w-0"><div className="font-medium">{message}</div>{pages.length>0&&<div className="mt-2 flex flex-wrap gap-2">{pages.map((page)=>page.url?<a key={page.id} href={page.url} target="_blank" rel="noreferrer" className="rounded border border-line bg-paper px-2 py-1 font-mono text-[11px] text-mute hover:text-ink">{page.title}</a>:<span key={page.id} className="rounded border border-line bg-paper px-2 py-1 font-mono text-[11px] text-mute">{page.title}</span>)}</div>}</div></div>}
function EmptyState(){return <div className="rounded-xl border border-dashed border-line bg-white px-6 py-10 text-center"><div className="text-[15px] font-semibold tracking-tight">No edit examples yet</div><p className="mx-auto mt-2 max-w-md text-[13px] leading-[1.6] text-mute">The dashboard is reading live worker reports. Current reports are hello-world runs, so they only populate run history until the polishing worker starts changing blocks.</p></div>}
function relativeFromNow(value?:string,now=Date.now()){if(!value)return"—";const diff=Math.max(0,now-new Date(value).getTime());const totalSeconds=Math.floor(diff/1000);if(totalSeconds<60)return`${totalSeconds} ${totalSeconds===1?"second":"seconds"} ago`;const min=Math.floor(totalSeconds/60);const seconds=totalSeconds%60;if(min<60)return`${min} ${min===1?"minute":"minutes"} ${seconds} ${seconds===1?"second":"seconds"} ago`;const hours=Math.floor(min/60);const rest=min%60;if(hours<24)return rest>0?`${hours} ${hours===1?"hour":"hours"} ${rest} ${rest===1?"minute":"minutes"} ago`:`${hours} ${hours===1?"hour":"hours"} ago`;const days=Math.floor(hours/24);if(days<30)return`${days} ${days===1?"day":"days"} ago`;const months=Math.floor(days/30);if(months<12)return`${months} ${months===1?"month":"months"} ago`;const years=Math.floor(days/365);return`${years} ${years===1?"year":"years"} ago`}
function humanReportName(run:DreamRun){const raw=run.run_id;if(raw&&!/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/.test(raw))return raw;if(run.ran_at)return pacificReportFormatter.format(new Date(run.ran_at)).replace(" at 24:"," at 00:");return raw??"Untitled report"}
