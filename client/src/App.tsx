import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Clapperboard, FolderCog, HardDrive, LoaderCircle, Play, RefreshCw, Settings, Trash2, UploadCloud, X } from "lucide-react";

type MoviePack = { modId: string; packId: string; name: string; description: string; root: string };
type Status = { modRoot: string; modsRoot: string; workshopRoot: string; mode: "local" | "pack"; activePackId: string; activePack: MoviePack | null; packs: MoviePack[]; modFound: boolean; pzRunning: boolean; ffmpegFound: boolean; version: string };
type LibraryEntry = { id: string; title: string; sourceName: string; createdAt: string; videoBytes: number; audioBytes: number; audioLayout?: "single" | "chunks"; audioChunks: number; duration: number };
type Job = { id: string; sourceName: string; title: string; phase: string; progress: number; status: "queued" | "running" | "complete" | "failed"; error?: string };
type PendingFile = { file: File; title: string };

const movieExtensions = ["mp4", "mkv", "mov", "avi", "webm", "m4v", "ogv"];
const uploadBatchSize = 10;

function formatBytes(bytes: number) {
  if (!bytes) return "0 MB";
  const units = ["B", "KB", "MB", "GB"];
  const order = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** order).toFixed(order > 1 ? 1 : 0)} ${units[order]}`;
}

function titleFromFilename(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
}

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [library, setLibrary] = useState<LibraryEntry[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [modRoot, setModRoot] = useState("");
  const [modsRoot, setModsRoot] = useState("");
  const [packId, setPackId] = useState("KBM_MyMoviePack");
  const [packName, setPackName] = useState("My KnoxBox Movie Pack");
  const [packDescription, setPackDescription] = useState("");
  const [packImage, setPackImage] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isStaging, setIsStaging] = useState(false);
  const [message, setMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const [statusResponse, libraryResponse, jobsResponse] = await Promise.all([fetch("/api/status"), fetch("/api/library"), fetch("/api/jobs")]);
    if (statusResponse.ok) {
      const next = await statusResponse.json() as Status;
      setStatus(next);
      setModRoot((current) => current || next.modRoot);
      setModsRoot((current) => current || next.modsRoot);
    }
    if (libraryResponse.ok) setLibrary(await libraryResponse.json());
    if (jobsResponse.ok) setJobs(await jobsResponse.json());
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 1200);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const accepted = Array.from(files).filter((file) => movieExtensions.includes(file.name.split(".").pop()?.toLowerCase() || ""));
    setPending((current) => [...current, ...accepted.map((file) => ({ file, title: titleFromFilename(file.name) }))]);
  }, []);

  const activeJobs = useMemo(() => jobs.filter((job) => job.status === "queued" || job.status === "running"), [jobs]);

  async function saveSettings() {
    setMessage("");
    const response = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modRoot, modsRoot }) });
    const result = await response.json();
    if (!response.ok) return setMessage(result.error || "Unable to save the mod path.");
    setMessage("TV/VHS mod path saved.");
    await refresh();
  }

  async function chooseTarget(mode: "local" | "pack", activePackId = "") {
    const response = await fetch("/api/target", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, activePackId }) });
    const result = await response.json();
    if (!response.ok) return setMessage(result.error || "Unable to select the import destination.");
    setMessage(mode === "pack" ? "Movie pack selected." : "Local TV/VHS library selected.");
    await refresh();
  }

  async function createMoviePack() {
    setMessage("");
    const body = new FormData();
    body.append("modId", packId);
    body.append("name", packName);
    body.append("description", packDescription);
    if (packImage) body.append("image", packImage, packImage.name);
    const response = await fetch("/api/packs", { method: "POST", body });
    const result = await response.json();
    if (!response.ok) return setMessage(result.error || "Unable to create the movie pack.");
    setMessage(`Created ${result.name}. New imports will be added to that mod.`);
    await refresh();
  }

  async function stageMoviePack() {
    if (!status?.activePack) return;
    setIsStaging(true);
    setMessage("");
    try {
      const response = await fetch(`/api/packs/${encodeURIComponent(status.activePack.modId)}/stage-workshop`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) return setMessage(result.error || "Unable to stage the movie pack.");
      setMessage(`Workshop copy ready: ${result.root}.${result.previewFromTemplate ? " Replace the template preview.png with your own artwork before publishing." : ""} Open Project Zomboid's Workshop menu to upload it.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsStaging(false);
    }
  }

  async function importMovies() {
    if (!pending.length) return;
    setIsUploading(true);
    setMessage("");
    const selected = [...pending];
    let queued = 0;
    try {
      for (let offset = 0; offset < selected.length; offset += uploadBatchSize) {
        const batch = selected.slice(offset, offset + uploadBatchSize);
        const body = new FormData();
        for (const item of batch) body.append("files", item.file, item.file.name);
        body.append("titles", JSON.stringify(batch.map((item) => ({ name: item.file.name, title: item.title }))));
        setMessage(`Uploading ${offset + 1}-${offset + batch.length} of ${selected.length} movies...`);
        const response = await fetch("/api/import", { method: "POST", body });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Import could not be queued.");
        queued += result.jobs.length;
        setPending((current) => current.slice(batch.length));
      }
      setMessage(`${queued} movie${queued === 1 ? "" : "s"} added to the encoding queue.`);
      await refresh();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setMessage(queued ? `${queued} movies queued; remaining files were kept. ${reason}` : reason);
    } finally {
      setIsUploading(false);
    }
  }

  async function removeMovie(entry: LibraryEntry) {
    if (!window.confirm(`Remove "${entry.title}" and its generated media?`)) return;
    const response = await fetch(`/api/library/${entry.id}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) return setMessage(result.error || "Unable to remove the movie.");
    setMessage(`Removed ${entry.title}.`);
    await refresh();
  }

  const ready = Boolean(status?.modFound && status.ffmpegFound && !status.pzRunning && activeJobs.length === 0);

  return <main className="shell">
    <header className="hero">
      <img className="brand-logo" src="/logo.gif" alt="Knoxbox Media Converter logo" />
      <p>Prepare personal movies for the KnoxBox television and VHS player.</p>
      <div className="status-row">
        <span className={`status-pill ${status?.modFound ? "ok" : "bad"}`}><HardDrive size={14} /> {status?.modFound ? "TV/VHS mod found" : "Mod path required"}</span>
        <span className={`status-pill ${status?.ffmpegFound ? "ok" : "bad"}`}><CheckCircle2 size={14} /> {status?.ffmpegFound ? "FFmpeg ready" : "FFmpeg missing"}</span>
        <span className={`status-pill ${status?.pzRunning ? "bad" : "ok"}`}><Play size={14} /> {status?.pzRunning ? "Project Zomboid is running" : "Project Zomboid is closed"}</span>
      </div>
    </header>

    <section className="grid two-column">
      <article className="panel import-panel">
        <div className="panel-heading"><div><span className="step">01</span><h2>Select movies</h2></div><button className="quiet-button" onClick={() => fileInput.current?.click()}><UploadCloud size={16} /> Browse</button></div>
        <input ref={fileInput} type="file" multiple accept={movieExtensions.map((extension) => `.${extension}`).join(",")} hidden onChange={(event) => event.target.files && addFiles(event.target.files)} />
        <div className={`drop-zone ${isDragging ? "dragging" : ""}`} onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setIsDragging(false)} onDrop={(event) => { event.preventDefault(); setIsDragging(false); addFiles(event.dataTransfer.files); }} onClick={() => fileInput.current?.click()}>
          <UploadCloud size={34} /><strong>Drop movies here</strong><span>MP4, MKV, MOV, AVI, WebM, M4V or OGV</span>
        </div>
        {pending.length > 0 && <div className="pending-list">{pending.map((item, index) => <div className="pending-item" key={`${item.file.name}-${index}`}>
          <div className="file-meta"><Clapperboard size={18} /><span>{item.file.name}<small>{formatBytes(item.file.size)}</small></span></div>
          <input value={item.title} aria-label={`Title for ${item.file.name}`} onChange={(event) => setPending((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, title: event.target.value } : entry))} />
          <button className="icon-button" onClick={() => setPending((current) => current.filter((_, entryIndex) => entryIndex !== index))}><X size={17} /></button>
        </div>)}</div>}
        <button className="primary-button" disabled={!ready || !pending.length || isUploading} onClick={importMovies}>{isUploading ? <LoaderCircle className="spin" size={18} /> : <Clapperboard size={18} />}{isUploading ? "Uploading to local encoder..." : `Import ${pending.length || ""} movie${pending.length === 1 ? "" : "s"} to ${status?.mode === "pack" ? status.activePack?.name || "pack" : "local library"}`}</button>
      </article>

      <article className="panel settings-panel">
        <div className="panel-heading"><div><span className="step">02</span><h2>Installation</h2></div><Settings size={18} /></div>
        <label>KBM_TVVHS folder</label>
        <div className="path-row"><FolderCog size={18} /><input value={modRoot} onChange={(event) => setModRoot(event.target.value)} /></div>
        <label className="spaced-label">Project Zomboid mods folder</label>
        <div className="path-row"><FolderCog size={18} /><input value={modsRoot} onChange={(event) => setModsRoot(event.target.value)} /></div>
        <button className="quiet-button full" onClick={saveSettings}>Save and validate path</button>
        <dl className="spec-list">
          <div><dt>Video</dt><dd>320 x 180 H.264 Baseline</dd></div><div><dt>Frame order</dt><dd>B-frames disabled</dd></div><div><dt>Audio</dt><dd>Compact mono OGG, 32 kHz</dd></div><div><dt>Playback</dt><dd>Existing KBM television UI</dd></div>
        </dl>
        <p className="restart-note">Project Zomboid must remain closed while importing or removing movies. Restart the game after the queue finishes.</p>
      </article>
    </section>

    <section className="panel target-panel">
      <div className="panel-heading"><div><span className="step">03</span><h2>Import destination</h2></div><span className="count">{status?.mode === "pack" ? status.activePack?.name : "Local library"}</span></div>
      <div className="target-options">
        <button className={`target-option ${status?.mode === "local" ? "selected" : ""}`} disabled={activeJobs.length > 0} onClick={() => chooseTarget("local")}><strong>Personal local library</strong><span>Add movies directly to your KBM_TVVHS installation for your own use.</span></button>
        <div className="pack-option">
          <label>Existing movie pack</label>
          <select value={status?.activePackId || ""} disabled={!status?.packs.length || activeJobs.length > 0} onChange={(event) => event.target.value && chooseTarget("pack", event.target.value)}>
            <option value="">Select a generated pack</option>{status?.packs.map((pack) => <option key={pack.modId} value={pack.modId}>{pack.name} ({pack.modId})</option>)}
          </select>
          <small>Each pack is a separate ready-to-enable PZ mod that depends on KBM_TVVHS.</small>
        </div>
      </div>
      <div className="pack-builder">
        <h3>Create a movie-pack mod</h3>
        <div className="pack-fields"><label>Mod ID<input value={packId} onChange={(event) => setPackId(event.target.value)} /></label><label>Display name<input value={packName} onChange={(event) => setPackName(event.target.value)} /></label></div>
        <label>Description<input value={packDescription} placeholder="Optional description for mod.info" onChange={(event) => setPackDescription(event.target.value)} /></label>
        <label>Pack image (PNG, optional)<span className="file-picker"><input type="file" accept="image/png,.png" onChange={(event) => setPackImage(event.target.files?.[0] || null)} /><strong>{packImage ? packImage.name : "Choose 256x256 PNG artwork"}</strong></span><small>Use exactly 256x256 pixels and keep it under 1 MB. The importer uses it as the in-game poster and keeps a preview.png copy for Workshop packaging.</small></label>
        <button className="quiet-button full" disabled={Boolean(status?.pzRunning || activeJobs.length)} onClick={createMoviePack}>Create pack and select it</button>
      </div>
      {status?.mode === "pack" && status.activePack && <div className="pack-builder">
        <h3>Publish a movie pack</h3>
        <p>After importing and testing your movies, make a Workshop-ready copy of this pack. This does not upload it to Steam.</p>
        <button className="quiet-button full" disabled={Boolean(status.pzRunning || activeJobs.length || isStaging)} onClick={stageMoviePack}>{isStaging ? "Preparing Workshop copy..." : "Stage pack for Workshop"}</button>
        <small>Location: {status.workshopRoot}\{status.activePack.modId}. Repeat after editing the local pack to refresh its Workshop copy.</small>
      </div>}
    </section>

    {(message || jobs.length > 0) && <section className="panel queue-panel">
      <div className="panel-heading"><div><span className="step">04</span><h2>Encoding queue</h2></div><button className="icon-button" onClick={refresh}><RefreshCw size={16} /></button></div>
      {message && <p className="message">{message}</p>}
      <div className="job-list">{jobs.slice().reverse().map((job) => <div className={`job ${job.status}`} key={job.id}>
        <div className="job-title"><span>{job.title}</span><small>{job.phase}</small></div><div className="progress-track"><div style={{ width: `${job.progress}%` }} /></div><strong>{Math.round(job.progress)}%</strong>{job.error && <p>{job.error}</p>}
      </div>)}</div>
    </section>}

    <section className="panel library-panel">
      <div className="panel-heading"><div><span className="step">05</span><h2>{status?.mode === "pack" ? "Movie pack library" : "User movie library"}</h2></div><span className="count">{library.length} installed</span></div>
      {library.length === 0 ? <div className="empty-library"><Clapperboard size={30} /><strong>No movies in this destination</strong><span>Select files above to build this library.</span></div> : <div className="library-list">{library.map((entry) => <div className="library-item" key={entry.id}>
        <div className="tape-icon">VHS</div><div><strong>{entry.title}</strong><span>{entry.sourceName}</span></div><div className="library-stats"><span>{Math.round(entry.duration / 60)} min</span><span>{entry.audioChunks === 0 ? "No audio" : entry.audioLayout === "single" ? "1 audio file" : `${entry.audioChunks} audio chunks`}</span><span>{formatBytes(entry.videoBytes + entry.audioBytes)}</span></div><button className="icon-button danger" disabled={status?.pzRunning} onClick={() => removeMovie(entry)} title="Remove movie"><Trash2 size={17} /></button>
      </div>)}</div>}
    </section>
    <footer>Local processing only | Source movies never leave this computer | v{status?.version || "0.1.0"}</footer>
  </main>;
}
