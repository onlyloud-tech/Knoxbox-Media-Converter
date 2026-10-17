import { execFile, spawn } from "child_process";
import { createHash, randomUUID } from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";

export const APP_VERSION = "0.3.2";
export type ImportMode = "local" | "pack";
export type MoviePack = { modId: string; packId: string; name: string; description: string; root: string };
export type Settings = { modRoot: string; modsRoot: string; mode: ImportMode; activePackId: string };
export type MovieEntry = { id:string; sha256:string; title:string; sourceName:string; createdAt:string; itemType:string; recMediaId:string; video:string; soundName:string; audioLayout?:"single"|"chunks"; audioChunks:number; audioChunkSeconds:number; duration:number; videoBytes:number; audioBytes:number };
type Progress = (phase:string, percent:number) => void;
type Target = { kind:ImportMode; root:string; state:string; videoDir:string; audioDir:string; videoPrefix:string; soundPath:string; module:string; itemPrefix:string; itemTypePrefix:string; recPrefix:string; soundPrefix:string; catalogLua:string; items:string; sounds:string; recorded:string; pack?:MoviePack };

const appDataDirectory = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
const settingsDirectory = path.join(appDataDirectory, "KnoxboxMediaConverter");
const settingsPath = path.join(settingsDirectory, "settings.json");
export function defaultModRoot(){ return path.join(os.homedir(), "Zomboid", "mods", "KBM_TVVHS"); }
export function defaultModsRoot(){ return path.join(os.homedir(), "Zomboid", "mods"); }
export function loadSettings():Settings { try { const d=JSON.parse(fs.readFileSync(settingsPath,"utf8")); let modRoot=path.resolve(String(d.modRoot||defaultModRoot())); if(path.basename(modRoot).toLowerCase()==="kbm_gameboy"){const migrated=path.join(path.dirname(modRoot),"KBM_TVVHS");if(isValidModRoot(migrated))modRoot=migrated;} return { modRoot, modsRoot:path.resolve(String(d.modsRoot||path.dirname(modRoot))), mode:d.mode==="pack"?"pack":"local", activePackId:String(d.activePackId||"") }; } catch { return {modRoot:defaultModRoot(),modsRoot:defaultModsRoot(),mode:"local",activePackId:""}; } }
async function writeAtomic(target:string, contents:string|Buffer){ await fsp.mkdir(path.dirname(target),{recursive:true}); const temp=`${target}.tmp-${process.pid}-${randomUUID()}`; await fsp.writeFile(temp,contents); await fsp.rename(temp,target); }
async function persist(s:Settings){ await fsp.mkdir(settingsDirectory,{recursive:true}); await writeAtomic(settingsPath,JSON.stringify(s,null,2)); return s; }
export function isValidModRoot(root:string){ return fs.existsSync(path.join(root,"common/media/lua/client/KBMGB/Movie/MovieRegistry.lua")); }
export async function saveSettings(modRoot:string,modsRoot?:string){ const old=loadSettings(); const core=path.resolve(modRoot.trim()); if(!isValidModRoot(core)) throw new Error("That folder is not a KBM_TVVHS installation."); const mods=path.resolve(String(modsRoot||old.modsRoot||path.dirname(core)).trim()); await fsp.mkdir(mods,{recursive:true}); return persist({...old,modRoot:core,modsRoot:mods}); }
export async function setImportTarget(mode:ImportMode,activePackId=""){ const s=loadSettings(); if(mode==="pack"&&!getPack(activePackId,s.modsRoot)) throw new Error("Select or create a valid movie pack first."); return persist({...s,mode,activePackId:mode==="pack"?activePackId:""}); }

function validModId(v:string){ const id=v.trim(); if(!/^[A-Za-z][A-Za-z0-9_]{2,63}$/.test(id)) throw new Error("Pack ID must start with a letter and contain only letters, numbers, and underscores (3-64 characters)."); if(["KBM_Core","KBM_GameBoy","KBM_Consoles","KBM_TVVHS","KBM_PublicDomainMovies"].includes(id)) throw new Error("That pack ID is reserved."); return id; }
function ns(id:string){ return `${id.replace(/[^A-Za-z0-9_]/g,"_")}_Movies`; }
function metadata(root:string){ return path.join(root,"42","kbm-movie-pack.json"); }
export function getPack(modId:string,modsRoot=loadSettings().modsRoot):MoviePack|null { if(!/^[A-Za-z][A-Za-z0-9_]{2,63}$/.test(modId)) return null; const root=path.join(modsRoot,modId); try { const d=JSON.parse(fs.readFileSync(metadata(root),"utf8")); if(d.modId!==modId)return null; return {modId,packId:String(d.packId),name:String(d.name),description:String(d.description||""),root}; } catch{return null;} }
export async function listPacks(modsRoot=loadSettings().modsRoot){ try { const names=await fsp.readdir(modsRoot); return names.map(n=>getPack(n,modsRoot)).filter((p):p is MoviePack=>Boolean(p)).sort((a,b)=>a.name.localeCompare(b.name)); } catch{return [];} }
export async function createPack(input:{modId:string;name:string;description?:string;image?:Buffer}){
  if(await isPzRunning()) throw new Error("Project Zomboid is running. Close it before creating a movie pack.");
  const s=loadSettings(),modId=validModId(input.modId),name=input.name.trim();
  if(!name) throw new Error("Enter a movie pack name.");
  const root=path.join(s.modsRoot,modId);
  if(fs.existsSync(root)) throw new Error(fs.existsSync(metadata(root))?"That movie pack already exists. Select it from the list instead.":`A different mod already exists at ${root}.`);
  if(input.image){
    const signature=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
    if(input.image.length<24||!input.image.subarray(0,8).equals(signature)) throw new Error("The selected pack image is not a valid PNG file.");
    const width=input.image.readUInt32BE(16),height=input.image.readUInt32BE(20);
    if(width!==256||height!==256) throw new Error(`Pack image must be exactly 256x256 pixels; selected image is ${width}x${height}.`);
  }
  const pack={modId,packId:`kbm-${modId.toLowerCase().replace(/_/g,"-")}`,name,description:String(input.description||"").trim(),root};
  const modInfo=[`name=${name}`,`id=${modId}`,`description=${pack.description||"KnoxBox movie pack"}`,"modversion=1.0.0","require=KBM_TVVHS"];
  if(input.image) modInfo.push("poster=poster.png");
  modInfo.push("");
  await writeAtomic(path.join(root,"42","mod.info"),modInfo.join("\n"));
  if(input.image) await Promise.all([writeAtomic(path.join(root,"42","poster.png"),input.image),writeAtomic(path.join(root,"preview.png"),input.image)]);
  await writeAtomic(metadata(root),JSON.stringify({version:1,modId,packId:pack.packId,name,description:pack.description,hasImage:Boolean(input.image)},null,2));
  const target=packTarget(pack); await saveCatalogFor(target,[]); await generatePackDefinitions(pack,[]); await persist({...s,mode:"pack",activePackId:modId}); return pack;
}

export function findFfmpeg(){ const resources=(process as NodeJS.Process&{resourcesPath?:string}).resourcesPath; const options=[process.env.KBM_FFMPEG,resources?path.join(resources,"vendor/ffmpeg/ffmpeg.exe"):"",path.resolve(process.cwd(),"vendor/ffmpeg/ffmpeg.exe")].filter(Boolean) as string[]; return options.find(fs.existsSync)||""; }
export function isPzRunning():Promise<boolean>{ if(process.platform!=="win32")return Promise.resolve(false); return new Promise(resolve=>execFile("tasklist.exe",["/FI","IMAGENAME eq ProjectZomboid64.exe","/NH"],{windowsHide:true},(e,out)=>resolve(!e&&/ProjectZomboid64\.exe/i.test(out)))); }
function lua(v:string){ return `"${v.replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/[\r\n]+/g," ")}"`; }
function script(v:string){return v.replace(/,/g," -").replace(/[\r\n]+/g," ").trim();}

function localTarget(root:string):Target{return{kind:"local",root,state:"common/media/video/user_movies/catalog.json",videoDir:"common/media/video/user_movies",audioDir:"common/media/sound/KBM/UserMovies",videoPrefix:"user_movies",soundPath:"media/sound/KBM/UserMovies",module:"KBM",itemPrefix:"UserMovie_",itemTypePrefix:"KBM.UserMovie_",recPrefix:"KBM_GB_UserMovie_",soundPrefix:"UserMovie_",catalogLua:"common/media/lua/shared/KBMGB/Movie/UserMovieCatalog.lua",items:"common/media/scripts/KBMGB_UserMovie_Items.txt",sounds:"common/media/scripts/KBMGB_UserMovie_Sounds.txt",recorded:"common/media/lua/shared/RecordedMedia/KBMGB_UserMovieRecordedMedia.lua"};}
function packTarget(pack:MoviePack):Target{const n=ns(pack.modId),m="42/media";return{kind:"pack",root:pack.root,state:"42/kbm-movie-catalog.json",videoDir:`${m}/video/${n}`,audioDir:`${m}/sound/KBM/${n}`,videoPrefix:n,soundPath:`media/sound/KBM/${n}`,module:n,itemPrefix:"VHS_",itemTypePrefix:`${n}.VHS_`,recPrefix:`${n}_Recorded_`,soundPrefix:`${n}_`,catalogLua:`${m}/lua/shared/${n}/Catalog.lua`,items:`${m}/scripts/${n}_Items.txt`,sounds:`${m}/scripts/${n}_Sounds.txt`,recorded:`${m}/lua/shared/RecordedMedia/${n}RecordedMedia.lua`,pack};}
function currentTarget(){const s=loadSettings();if(s.mode==="pack"){const p=getPack(s.activePackId,s.modsRoot);if(!p)throw new Error("The selected movie pack no longer exists. Select or create a pack.");return packTarget(p);}if(!isValidModRoot(s.modRoot))throw new Error("The configured KBM_TVVHS folder is not valid.");return localTarget(s.modRoot);}
async function loadCatalogFor(t:Target):Promise<MovieEntry[]>{try{const d=JSON.parse(await fsp.readFile(path.join(t.root,t.state),"utf8"));return Array.isArray(d.entries)?d.entries:[];}catch{return[];}}
async function saveCatalogFor(t:Target,entries:MovieEntry[]){await writeAtomic(path.join(t.root,t.state),JSON.stringify({version:1,...(t.pack?{pack:{modId:t.pack.modId,packId:t.pack.packId,name:t.pack.name,description:t.pack.description}}:{}),entries},null,2));}
export async function loadCatalog(){return loadCatalogFor(currentTarget());}

async function generate(t:Target,entries:MovieEntry[]){
  const sorted=[...entries].sort((a,b)=>a.title.localeCompare(b.title)||a.id.localeCompare(b.id));
  const catalog=["-- Generated by Knoxbox Media Converter. Do not edit by hand.","return { entries = {"];
  const items=[`module ${t.module}`,"{"];
  const media=["RecMedia = RecMedia or {}",""];
  const sounds=[`module ${t.module}`,"{"];
  for(const e of sorted){
    const single=e.audioLayout==="single";
    catalog.push(`    { id=${lua(e.id)}, itemType=${lua(e.itemType)}, recMediaId=${lua(e.recMediaId)}, label=${lua(e.title)}, video=${lua(e.video)}, soundName=${e.audioChunks?lua(e.soundName):"nil"}, audioLayout=${lua(single?"single":"chunks")}, audioChunkSeconds=30 },`);
    items.push(`    item ${t.itemPrefix}${e.id}`,"    {","        ItemType = base:normal,",`        DisplayName = VHS - ${script(e.title)},`,"        DisplayCategory = Entertainment,","        Icon = vhs_tape,","        Weight = 0.3,","        MediaCategory = Retail-VHS,","        WorldStaticModel = VhsTape,","        OnCreate = KBMGB_OnCreateBYOM,","    }","");
    const title=lua(e.title);
    media.push(`RecMedia[${lua(e.recMediaId)}] = { itemDisplayName=${title}, title=${title}, subtitle=${lua(t.pack?.name||"User Movie")}, author="", extra="Converted with Knoxbox Media Converter.", spawning=0, category="VHS", lines={{ text="KnoxBox movie", r=0.8, g=0.9, b=1, codes="KBMGB-MOVIE" }}, }`);
    const count=single?(e.audioChunks?1:0):e.audioChunks;
    for(let i=0;i<count;i++){
      const s=String(i).padStart(3,"0");
      const file=single?"audio.ogg":`seg_${s}.ogg`;
      sounds.push(`    sound KBM_Movie_${e.soundName}_${s}`,"    {","        category = UI,","        clip","        {",`            file = ${t.soundPath}/${e.id}/${file},`,"        }","    }","");
    }
  }
  catalog.push("} }","");items.push("}","");sounds.push("}","");media.push("");
  await Promise.all([[t.catalogLua,catalog],[t.items,items],[t.sounds,sounds],[t.recorded,media]].map(([file,lines])=>writeAtomic(path.join(t.root,file as string),(lines as string[]).join("\n"))));
}
export async function generateDefinitions(modRoot:string,entries:MovieEntry[]){return generate(localTarget(modRoot),entries);}
async function generatePackDefinitions(pack:MoviePack,entries:MovieEntry[]){const t=packTarget(pack),n=ns(pack.modId);await generate(t,entries);await writeAtomic(path.join(pack.root,`42/media/lua/shared/${n}/Register.lua`),[`local Registry = require "KBMGB/Movie/MoviePackRegistry"`,`local Catalog = require "${n}/Catalog"`,`Registry.register({ packId=${lua(pack.packId)}, modId=${lua(pack.modId)}, name=${lua(pack.name)}, entries=Catalog.entries or {} })`,""].join("\n"));await writeAtomic(path.join(pack.root,`42/media/lua/server/Items/${n}Distributions.lua`),['require "Items/ProceduralDistributions"',`local Catalog = require "${n}/Catalog"`,'local targets = { "MovieRentalShelves", "CrateVHSTapes" }','local function addOnce(items, fullType, weight)','    for i = 1, #items, 2 do if items[i] == fullType then items[i + 1] = weight; return end end','    items[#items + 1] = fullType; items[#items + 1] = weight','end','local function addLoot()','    local entries = Catalog.entries or {}','    if #entries == 0 then return end','    local weight = 100 / #entries','    for _, listName in ipairs(targets) do','        local list = ProceduralDistributions.list[listName]','        if list and list.items then for _, entry in ipairs(entries) do addOnce(list.items, entry.itemType, weight) end end','    end',`    print("[KBMGB][MoviePack] ${pack.modId} VHS loot ready: " .. tostring(#entries))`,'end','Events.OnPreDistributionMerge.Add(addLoot)',''].join("\n"));}

async function sha256(file:string,onBytes?:(n:number)=>void){const h=createHash("sha256");let n=0;await new Promise<void>((resolve,reject)=>{const s=fs.createReadStream(file);s.on("data",(c:string|Buffer)=>{h.update(c);n+=Buffer.byteLength(c);onBytes?.(n);});s.on("error",reject);s.on("end",resolve);});return h.digest("hex");}
function execute(exe:string,args:string[],onLine?:(line:string)=>void){return new Promise<{code:number;output:string}>((resolve,reject)=>{const p=spawn(exe,args,{windowsHide:true});let output="",pending="";const collect=(c:string|Buffer)=>{const x=c.toString();output=(output+x).slice(-20000);pending+=x;const lines=pending.split(/\r?\n/);pending=lines.pop()||"";lines.forEach(l=>onLine?.(l));};p.stdout.on("data",collect);p.stderr.on("data",collect);p.on("error",reject);p.on("close",code=>{if(pending)onLine?.(pending);resolve({code:code??-1,output});});});}
async function probe(ffmpeg:string,source:string){const r=await execute(ffmpeg,["-hide_banner","-i",source]);const m=r.output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);const duration=m?Number(m[1])*3600+Number(m[2])*60+Number(m[3]):0;if(!/Video:\s*[^\r\n]+/i.test(r.output))throw new Error("No video stream was found in this file.");return{duration,hasAudio:/Audio:\s*[^\r\n]+/i.test(r.output)};}
async function runFfmpeg(ffmpeg:string,args:string[],duration:number,start:number,span:number,progress:Progress){const r=await execute(ffmpeg,args,line=>{const m=line.match(/^out_time_(?:us|ms)=(\d+)/);if(m&&duration>0)progress("Encoding",Math.min(start+span,start+span*Number(m[1])/1_000_000/duration));});if(r.code!==0)throw new Error(r.output.trim().split(/\r?\n/).slice(-8).join("\n")||`FFmpeg exited with code ${r.code}.`);}

export async function installMovie(uploadPath:string,sourceName:string,requestedTitle:string,progress:Progress){const t=currentTarget();if(await isPzRunning())throw new Error("Project Zomboid is running. Close it before importing movies.");const ffmpeg=findFfmpeg();if(!ffmpeg)throw new Error("The bundled FFmpeg executable could not be found.");const stat=await fsp.stat(uploadPath);progress("Hashing source",1);const hash=await sha256(uploadPath,b=>progress("Hashing source",Math.min(5,b/stat.size*5))),id=hash.slice(0,12),title=requestedTitle.trim()||path.parse(sourceName).name,entries=await loadCatalogFor(t),existing=entries.find(e=>e.id===id);if(existing&&fs.existsSync(path.join(t.root,t.videoDir,`${id}.mp4`))){existing.title=title;await saveCatalogFor(t,entries);t.pack?await generatePackDefinitions(t.pack,entries):await generate(t,entries);progress("Already installed",100);await fsp.rm(uploadPath,{force:true});return existing;}progress("Inspecting streams",6);const info=await probe(ffmpeg,uploadPath),build=await fsp.mkdtemp(path.join(os.tmpdir(),`kbm-movie-${id}-`)),video=path.join(build,"video.mp4"),audio=path.join(build,"audio");await fsp.mkdir(audio);try{await runFfmpeg(ffmpeg,["-y","-hide_banner","-loglevel","error","-i",uploadPath,"-map","0:v:0","-an","-vf","scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2","-c:v","libx264","-profile:v","baseline","-pix_fmt","yuv420p","-crf","28","-bf","0","-x264-params","bframes=0","-movflags","+faststart","-progress","pipe:1","-nostats",video],info.duration,7,68,(p,n)=>progress(p==="Encoding"?"Encoding video":p,n));let chunks=0;if(info.hasAudio){await runFfmpeg(ffmpeg,["-y","-hide_banner","-loglevel","error","-i",uploadPath,"-map","0:a:0","-vn","-c:a","libvorbis","-ac","1","-ar","32000","-q:a","0","-progress","pipe:1","-nostats",path.join(audio,"audio.ogg")],info.duration,76,17,(p,n)=>progress(p==="Encoding"?"Encoding audio":p,n));chunks=1;}progress("Installing media",94);const vdir=path.join(t.root,t.videoDir),adir=path.join(t.root,t.audioDir);await fsp.mkdir(vdir,{recursive:true});await fsp.mkdir(adir,{recursive:true});const vdest=path.join(vdir,`${id}.mp4`),vtemp=`${vdest}.tmp`;await fsp.copyFile(video,vtemp);await fsp.rm(vdest,{force:true});await fsp.rename(vtemp,vdest);const adest=path.join(adir,id),atemp=path.join(adir,`${id}.tmp-${randomUUID()}`);await fsp.cp(audio,atemp,{recursive:true});await fsp.rm(adest,{recursive:true,force:true});await fsp.rename(atemp,adest);let audioBytes=0;for(const f of chunks?await fsp.readdir(adest):[])audioBytes+=(await fsp.stat(path.join(adest,f))).size;const entry:MovieEntry={id,sha256:hash,title,sourceName,createdAt:new Date().toISOString(),itemType:`${t.itemTypePrefix}${id}`,recMediaId:`${t.recPrefix}${id}`,video:`${t.videoPrefix}/${id}.mp4`,soundName:`${t.soundPrefix}${id}`,audioLayout:"single",audioChunks:chunks,audioChunkSeconds:30,duration:info.duration,videoBytes:(await fsp.stat(vdest)).size,audioBytes};const next=[...entries.filter(e=>e.id!==id),entry];await saveCatalogFor(t,next);t.pack?await generatePackDefinitions(t.pack,next):await generate(t,next);progress(t.kind==="pack"?"Added to movie pack":"Installed - restart Project Zomboid",100);return entry;}finally{await fsp.rm(build,{recursive:true,force:true});await fsp.rm(uploadPath,{force:true});}}
export async function removeMovie(id:string){const t=currentTarget();if(!/^[a-f0-9]{12}$/i.test(id))throw new Error("Invalid movie id.");if(await isPzRunning())throw new Error("Project Zomboid is running. Close it before removing movies.");const entries=await loadCatalogFor(t),entry=entries.find(e=>e.id===id);if(!entry)throw new Error("Movie not found.");await fsp.rm(path.join(t.root,t.videoDir,`${id}.mp4`),{force:true});await fsp.rm(path.join(t.root,t.audioDir,id),{recursive:true,force:true});const remaining=entries.filter(e=>e.id!==id);await saveCatalogFor(t,remaining);t.pack?await generatePackDefinitions(t.pack,remaining):await generate(t,remaining);}
