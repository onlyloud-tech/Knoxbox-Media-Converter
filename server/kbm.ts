import { execFile, spawn } from "child_process";
import { createHash, randomUUID } from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { PNG } from "pngjs";
import { checkConversionSpace, checkInstallSpace, checkReserve } from "./disk";

export const APP_VERSION = "0.3.6";
export type ImportMode = "local" | "pack";
export type MoviePack = { modId: string; packId: string; name: string; description: string; root: string };
export type Settings = { modRoot: string; modsRoot: string; mode: ImportMode; activePackId: string };
export type MovieEntry = { id:string; sha256:string; title:string; sourceName:string; createdAt:string; itemType:string; recMediaId:string; video:string; soundName:string; audioLayout?:"single"|"chunks"; audioChunks:number; audioChunkSeconds:number; duration:number; videoBytes:number; audioBytes:number };
type Progress = (phase:string, percent:number) => void;
export type Target = { kind:ImportMode; root:string; state:string; videoDir:string; audioDir:string; videoPrefix:string; soundPath:string; module:string; itemPrefix:string; itemTypePrefix:string; recPrefix:string; soundPrefix:string; catalogLua:string; items:string; sounds:string; recorded:string; pack?:MoviePack };

const appDataDirectory = process.env.KBM_CONVERTER_DATA_DIR || process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
const settingsDirectory = path.join(appDataDirectory, "KnoxboxMediaConverter");
const settingsPath = path.join(settingsDirectory, "settings.json");
const WORKSHOP_ITEM_ID = "3823030163";
function steamLibraries():string[]{
  if(process.platform!=="win32") return [];
  const roots=[process.env["ProgramFiles(x86)"],process.env.ProgramFiles,process.env.LOCALAPPDATA]
    .filter((value):value is string=>Boolean(value)).map(value=>path.join(value,"Steam"));
  const libraries=new Set<string>();
  for(const root of roots){
    if(!fs.existsSync(root)) continue;
    libraries.add(root);
    try {
      const vdf=fs.readFileSync(path.join(root,"steamapps","libraryfolders.vdf"),"utf8");
      for(const match of vdf.matchAll(/"path"\s+"([^"]+)"/g)){
        libraries.add(match[1].replace(/\\\\/g,"\\"));
      }
    } catch { /* Steam may use only its default library. */ }
  }
  return [...libraries];
}
export function findWorkshopModRoot():string{
  for(const library of steamLibraries()){
    const mod=path.join(library,"steamapps","workshop","content","108600",WORKSHOP_ITEM_ID,"mods","KBM_TVVHS");
    if(isValidModRoot(mod)) return mod;
  }
  return "";
}
export function isWorkshopModRoot(root:string):boolean{
  return /[\\/]steamapps[\\/]workshop[\\/]content[\\/]108600[\\/]\d+[\\/]mods[\\/]KBM_TVVHS$/i.test(path.resolve(root));
}
export function defaultModRoot(){
  const local=path.join(defaultModsRoot(),"KBM_TVVHS");
  return isValidModRoot(local)?local:findWorkshopModRoot()||local;
}
export function defaultModsRoot(){ return path.join(os.homedir(), "Zomboid", "mods"); }
export function loadSettings():Settings { try { const d=JSON.parse(fs.readFileSync(settingsPath,"utf8")); let modRoot=path.resolve(String(d.modRoot||defaultModRoot())); if(path.basename(modRoot).toLowerCase()==="kbm_gameboy"){const migrated=path.join(path.dirname(modRoot),"KBM_TVVHS");if(isValidModRoot(migrated))modRoot=migrated;} if(!isValidModRoot(modRoot))modRoot=defaultModRoot(); return { modRoot, modsRoot:path.resolve(String(d.modsRoot||defaultModsRoot())), mode:d.mode==="pack"?"pack":"local", activePackId:String(d.activePackId||"") }; } catch { return {modRoot:defaultModRoot(),modsRoot:defaultModsRoot(),mode:"local",activePackId:""}; } }
async function assertSafePath(root:string,target:string){
  const base=path.resolve(root),destination=path.resolve(target),relative=path.relative(base,destination);
  if(relative===".."||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative)) throw new Error("The destination is outside the selected mod folder.");
  const anchor=path.parse(destination).root;
  let current=anchor;
  for(const part of destination.slice(anchor.length).split(path.sep).filter(Boolean)){
    current=path.join(current,part);
    try {
      if((await fsp.lstat(current)).isSymbolicLink()) throw new Error(`Linked folders or files are not supported: ${current}`);
    } catch(error){
      if((error as NodeJS.ErrnoException).code!=="ENOENT") throw error;
    }
  }
}
async function writeAtomic(target:string, contents:string|Buffer){ await fsp.mkdir(path.dirname(target),{recursive:true}); const temp=`${target}.tmp-${process.pid}-${randomUUID()}`; await fsp.writeFile(temp,contents); await fsp.rename(temp,target); }
async function persist(s:Settings){ await fsp.mkdir(settingsDirectory,{recursive:true}); await assertSafePath(settingsDirectory,settingsPath); await writeAtomic(settingsPath,JSON.stringify(s,null,2)); return s; }
export function isValidModRoot(root:string){ return fs.existsSync(path.join(root,"common/media/lua/client/KBMGB/Movie/MovieRegistry.lua")); }
export async function saveSettings(modRoot:string,modsRoot?:string){ const old=loadSettings(); const core=path.resolve(modRoot.trim()); if(!isValidModRoot(core)) throw new Error("That folder is not a KBM_TVVHS installation."); await assertSafePath(core,core); const mods=path.resolve(String(modsRoot||old.modsRoot||defaultModsRoot()).trim()); await fsp.mkdir(mods,{recursive:true}); await assertSafePath(mods,mods); return persist({...old,modRoot:core,modsRoot:mods}); }
export async function setImportTarget(mode:ImportMode,activePackId=""){ const s=loadSettings(); if(mode==="local"&&isWorkshopModRoot(s.modRoot)) throw new Error("Steam Workshop installations are updated by Steam. Create a separate movie pack for your personal movies."); if(mode==="pack"&&!getPack(activePackId,s.modsRoot)) throw new Error("Select or create a valid movie pack first."); return persist({...s,mode,activePackId:mode==="pack"?activePackId:""}); }

function validModId(v:string){ const id=v.trim(); if(!/^[A-Za-z][A-Za-z0-9_]{2,63}$/.test(id)) throw new Error("Pack ID must start with a letter and contain only letters, numbers, and underscores (3-64 characters)."); if(["KBM_Core","KBM_GameBoy","KBM_Consoles","KBM_TVVHS","KBM_PublicDomainMovies"].includes(id)) throw new Error("That pack ID is reserved."); return id; }
function ns(id:string){ return `${id.replace(/[^A-Za-z0-9_]/g,"_")}_Movies`; }
function metadata(root:string){ return path.join(root,"42","kbm-movie-pack.json"); }
export function getPack(modId:string,modsRoot=loadSettings().modsRoot):MoviePack|null { if(!/^[A-Za-z][A-Za-z0-9_]{2,63}$/.test(modId)) return null; const root=path.join(modsRoot,modId); try { const d=JSON.parse(fs.readFileSync(metadata(root),"utf8")); const description=typeof d.description==="string"?d.description:""; if(d.modId!==modId||d.packId!==`kbm-${modId.toLowerCase().replace(/_/g,"-")}`||typeof d.name!=="string"||!d.name.trim()||d.name.length>120||description.length>500)return null; return {modId,packId:d.packId,name:d.name,description,root}; } catch{return null;} }
export async function listPacks(modsRoot=loadSettings().modsRoot){ try { const names=await fsp.readdir(modsRoot); return names.map(n=>getPack(n,modsRoot)).filter((p):p is MoviePack=>Boolean(p)).sort((a,b)=>a.name.localeCompare(b.name)); } catch{return [];} }
export function workshopRoot(modsRoot=loadSettings().modsRoot){ return path.join(path.dirname(modsRoot),"Workshop"); }
function packModInfo(pack:MoviePack,hasImage:boolean){
  const oneLine=(value:string)=>value.replace(/[\x00-\x1f\x7f\u2028\u2029]+/g," ").trim();
  return [`name=${oneLine(pack.name)}`,`id=${pack.modId}`,`description=${oneLine(pack.description||"KnoxBox movie pack")}`,"modversion=1.0.0","require=KBM_TVVHS",...(hasImage?["poster=poster.png"]:[]),""].join("\n");
}
async function validatePackFiles(pack:MoviePack,entries:MovieEntry[]){
  const source=path.join(pack.root,"42"),n=ns(pack.modId);
  const required=new Set([
    "mod.info","kbm-movie-pack.json","kbm-movie-catalog.json",
    `media/lua/shared/${n}/Catalog.lua`, `media/lua/shared/${n}/Register.lua`,
    `media/lua/shared/RecordedMedia/${n}RecordedMedia.lua`,
    `media/lua/server/Items/${n}Distributions.lua`,
    `media/scripts/${n}_Items.txt`, `media/scripts/${n}_Sounds.txt`,
  ]);
  const seenIds=new Set<string>();
  for(const entry of entries){
    const id=entry.id;
    if(!/^[0-9a-f]{12}$/.test(id)||seenIds.has(id)
      ||entry.itemType!==`${n}.VHS_${id}`||entry.recMediaId!==`${n}_Recorded_${id}`
      ||entry.video!==`${n}/${id}.mp4`||entry.soundName!==`${n}_${id}`
      ||typeof entry.title!=="string"||!entry.title.trim()||entry.title.length>120
      ||typeof entry.sourceName!=="string"||entry.sourceName.length>260
      ||(entry.audioLayout!=="single"&&entry.audioLayout!=="chunks"&&entry.audioLayout!==undefined)
      ||!Number.isFinite(entry.duration)||entry.duration<0
      ||!Number.isSafeInteger(entry.audioChunks)||entry.audioChunks<0||entry.audioChunks>10000
      ||(entry.audioLayout==="single"&&entry.audioChunks>1)){
      throw new Error("This pack has an invalid movie catalog entry. Re-import or repair it before staging.");
    }
    seenIds.add(id);
    required.add(`media/video/${n}/${id}.mp4`);
    if(entry.audioLayout==="single"){
      if(entry.audioChunks===1) required.add(`media/sound/KBM/${n}/${id}/audio.ogg`);
    }else{
      for(let i=0;i<entry.audioChunks;i++) required.add(`media/sound/KBM/${n}/${id}/seg_${String(i).padStart(3,"0")}.ogg`);
    }
  }
  const allowed=new Set(required);
  if(fs.existsSync(path.join(source,"poster.png"))) allowed.add("poster.png");
  const directories=new Set([""]);
  for(const name of allowed){
    let dir=path.posix.dirname(name);
    while(dir!=="."){ directories.add(dir); dir=path.posix.dirname(dir); }
  }
  for(const dir of ["media/video",`media/video/${n}`,"media/sound","media/sound/KBM",`media/sound/KBM/${n}`]) directories.add(dir);
  const found=new Set<string>();
  async function visit(dir:string){
    for(const item of await fsp.readdir(path.join(source,...(dir?dir.split("/"):[])),{withFileTypes:true})){
      const name=dir?`${dir}/${item.name}`:item.name;
      if(item.isSymbolicLink()) throw new Error(`Movie pack contains a link: ${name}`);
      if(item.isDirectory()){
        if(!directories.has(name)) throw new Error(`Movie pack contains an unexpected folder: ${name}`);
        await visit(name);
      }else if(item.isFile()){
        if(!allowed.has(name)) throw new Error(`Movie pack contains an unexpected file: ${name}`);
        found.add(name);
      }else throw new Error(`Movie pack contains an unsupported entry: ${name}`);
    }
  }
  await visit("");
  for(const name of required) if(!found.has(name)) throw new Error(`Movie pack is missing a required file: ${name}`);
}
export async function stagePackForWorkshop(modId:string){
  if(await isPzRunning()) throw new Error("Close Project Zomboid before staging a movie pack.");
  const s=loadSettings(),pack=getPack(modId,s.modsRoot);
  if(!pack) throw new Error("Select a generated movie pack first.");
  const source=path.join(pack.root,"42"),workshop=workshopRoot(s.modsRoot),root=path.join(workshop,pack.modId);
  await assertSafePath(s.modsRoot,source);
  await fsp.mkdir(workshop,{recursive:true});
  await assertSafePath(workshop,root);
  await assertSafePath(pack.root,path.join(pack.root,"42","kbm-movie-catalog.json"));
  const entries=await loadCatalogFor(packTarget(pack));
  await validatePackFiles(pack,entries);
  const info=await fsp.readFile(path.join(source,"mod.info"),"utf8");
  if(!info.split(/\r?\n/).includes(`id=${pack.modId}`)) throw new Error("The movie pack mod.info has an unexpected mod ID.");
  if(fs.existsSync(root)){
    const existing=path.join(root,"Contents","mods",pack.modId,"42","mod.info");
    const existingInfo=await fsp.readFile(existing,"utf8").catch(()=>"");
    if(!existingInfo.split(/\r?\n/).includes(`id=${pack.modId}`)) throw new Error(`A different Workshop item already exists at ${root}.`);
  }
  const staged=`${root}.tmp-${randomUUID()}`;
  await assertSafePath(workshop,staged);
  try {
    const destination=path.join(staged,"Contents","mods",pack.modId,"42");
    await fsp.mkdir(path.dirname(destination),{recursive:true});
    await fsp.cp(source,destination,{recursive:true});
    const stagedPack={...pack,root:path.dirname(destination)};
    await validatePackFiles(stagedPack,entries);
    await generatePackDefinitions(stagedPack,entries);
    await writeAtomic(path.join(destination,"mod.info"),packModInfo(pack,fs.existsSync(path.join(destination,"poster.png"))));
    const oldMetadata=path.join(root,"workshop.txt"),oldPreview=path.join(root,"preview.png");
    await assertSafePath(workshop,oldMetadata);
    await assertSafePath(workshop,oldPreview);
    if(fs.existsSync(oldMetadata)) await fsp.copyFile(oldMetadata,path.join(staged,"workshop.txt"));
    else await fsp.writeFile(path.join(staged,"workshop.txt"),[`version=1`,`title=${pack.name.replace(/[\r\n]+/g," ")}`,`description=${(pack.description||"KnoxBox movie pack for Project Zomboid Build 42. Requires KBM_TVVHS.").replace(/[\r\n]+/g," ")}`,`tags=`,`visibility=private`,``].join("\n"));
    const sourcePreview=path.join(pack.root,"preview.png");
    await assertSafePath(pack.root,sourcePreview);
    const previewFromTemplate=!fs.existsSync(sourcePreview)&&!fs.existsSync(oldPreview);
    if(fs.existsSync(sourcePreview)) await fsp.copyFile(sourcePreview,path.join(staged,"preview.png"));
    else if(fs.existsSync(oldPreview)) await fsp.copyFile(oldPreview,path.join(staged,"preview.png"));
    else {
      const templatePreview=path.join(workshop,"ModTemplate","preview.png");
      await assertSafePath(workshop,templatePreview);
      if(!fs.existsSync(templatePreview)) throw new Error("No pack image was selected and the Project Zomboid Workshop template preview.png is missing. Add a preview.png to your local pack first.");
      await fsp.copyFile(templatePreview,path.join(staged,"preview.png"));
    }
    if(fs.existsSync(root)){
      const previous=`${root}.previous-${randomUUID()}`;
      await assertSafePath(workshop,previous);
      await fsp.rename(root,previous);
      try { await fsp.rename(staged,root); }
      catch(error){ await fsp.rename(previous,root); throw error; }
      await fsp.rm(previous,{recursive:true,force:true});
    } else await fsp.rename(staged,root);
    return {root,previewFromTemplate};
  } finally { await fsp.rm(staged,{recursive:true,force:true}); }
}
export async function createPack(input:{modId:string;name:string;description?:string;image?:Buffer}){
  if(await isPzRunning()) throw new Error("Project Zomboid is running. Close it before creating a movie pack.");
  const s=loadSettings(),modId=validModId(input.modId),name=input.name.trim();
  if(!name) throw new Error("Enter a movie pack name.");
  if(name.length>120||String(input.description||"").length>500) throw new Error("Pack name or description is too long.");
  const root=path.join(s.modsRoot,modId);
  await assertSafePath(s.modsRoot,root);
  if(fs.existsSync(root)) throw new Error(fs.existsSync(metadata(root))?"That movie pack already exists. Select it from the list instead.":`A different mod already exists at ${root}.`);
  if(input.image){
    const signature=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
    if(input.image.length<24||!input.image.subarray(0,8).equals(signature)) throw new Error("The selected pack image is not a valid PNG file.");
    const width=input.image.readUInt32BE(16),height=input.image.readUInt32BE(20);
    if(width!==256||height!==256) throw new Error(`Pack image must be exactly 256x256 pixels; selected image is ${width}x${height}.`);
    try {
      const decoded=PNG.sync.read(input.image,{checkCRC:true});
      if(decoded.width!==256||decoded.height!==256) throw new Error("Wrong decoded dimensions.");
    } catch { throw new Error("The pack image could not be fully decoded as a 256x256 PNG."); }
  }
  const pack={modId,packId:`kbm-${modId.toLowerCase().replace(/_/g,"-")}`,name,description:String(input.description||"").trim(),root};
  await writeAtomic(path.join(root,"42","mod.info"),packModInfo(pack,Boolean(input.image)));
  if(input.image) await Promise.all([writeAtomic(path.join(root,"42","poster.png"),input.image),writeAtomic(path.join(root,"preview.png"),input.image)]);
  await writeAtomic(metadata(root),JSON.stringify({version:1,modId,packId:pack.packId,name,description:pack.description,hasImage:Boolean(input.image)},null,2));
  const target=packTarget(pack); await saveCatalogFor(target,[]); await generatePackDefinitions(pack,[]); await persist({...s,mode:"pack",activePackId:modId}); return pack;
}

export function findFfmpeg(){ const resources=(process as NodeJS.Process&{resourcesPath?:string}).resourcesPath; const options=[process.env.KBM_FFMPEG,resources?path.join(resources,"vendor/ffmpeg/ffmpeg.exe"):"",path.resolve(process.cwd(),"vendor/ffmpeg/ffmpeg.exe")].filter(Boolean) as string[]; return options.find(fs.existsSync)||""; }
export function isPzRunning():Promise<boolean>{ if(process.platform!=="win32")return Promise.resolve(false); return new Promise(resolve=>execFile("tasklist.exe",["/FI","IMAGENAME eq ProjectZomboid64.exe","/NH"],{windowsHide:true},(e,out)=>resolve(!e&&/ProjectZomboid64\.exe/i.test(out)))); }
function lua(v:string){ return `"${v.replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/[\r\n\0]+/g," ")}"`; }
function script(v:string){return v.replace(/[{},\r\n\0]+/g," -").trim();}

function localTarget(root:string):Target{return{kind:"local",root,state:"common/media/video/user_movies/catalog.json",videoDir:"common/media/video/user_movies",audioDir:"common/media/sound/KBM/UserMovies",videoPrefix:"user_movies",soundPath:"media/sound/KBM/UserMovies",module:"KBM",itemPrefix:"UserMovie_",itemTypePrefix:"KBM.UserMovie_",recPrefix:"KBM_GB_UserMovie_",soundPrefix:"UserMovie_",catalogLua:"common/media/lua/shared/KBMGB/Movie/UserMovieCatalog.lua",items:"common/media/scripts/KBMGB_UserMovie_Items.txt",sounds:"common/media/scripts/KBMGB_UserMovie_Sounds.txt",recorded:"common/media/lua/shared/RecordedMedia/KBMGB_UserMovieRecordedMedia.lua"};}
function packTarget(pack:MoviePack):Target{const n=ns(pack.modId),m="42/media";return{kind:"pack",root:pack.root,state:"42/kbm-movie-catalog.json",videoDir:`${m}/video/${n}`,audioDir:`${m}/sound/KBM/${n}`,videoPrefix:n,soundPath:`media/sound/KBM/${n}`,module:n,itemPrefix:"VHS_",itemTypePrefix:`${n}.VHS_`,recPrefix:`${n}_Recorded_`,soundPrefix:`${n}_`,catalogLua:`${m}/lua/shared/${n}/Catalog.lua`,items:`${m}/scripts/${n}_Items.txt`,sounds:`${m}/scripts/${n}_Sounds.txt`,recorded:`${m}/lua/shared/RecordedMedia/${n}RecordedMedia.lua`,pack};}
export function resolveImportTarget(s=loadSettings()):Target{if(s.mode==="pack"){const p=getPack(s.activePackId,s.modsRoot);if(!p)throw new Error("The selected movie pack no longer exists. Select or create a pack.");return packTarget(p);}if(!isValidModRoot(s.modRoot))throw new Error("The configured KBM_TVVHS folder is not valid.");if(isWorkshopModRoot(s.modRoot))throw new Error("Create a separate movie pack for personal movies; Steam may replace changes inside a subscribed mod.");return localTarget(s.modRoot);}
function currentTarget(){return resolveImportTarget();}
async function loadCatalogFor(t:Target):Promise<MovieEntry[]>{try{const d=JSON.parse(await fsp.readFile(path.join(t.root,t.state),"utf8"));return Array.isArray(d.entries)?d.entries:[];}catch{return[];}}
async function saveCatalogFor(t:Target,entries:MovieEntry[]){const destination=path.join(t.root,t.state);await assertSafePath(t.root,destination);await writeAtomic(destination,JSON.stringify({version:1,...(t.pack?{pack:{modId:t.pack.modId,packId:t.pack.packId,name:t.pack.name,description:t.pack.description}}:{}),entries},null,2));}
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
  const output=[[t.catalogLua,catalog],[t.items,items],[t.sounds,sounds],[t.recorded,media]] as Array<[string,string[]]>;
  for(const [file] of output) await assertSafePath(t.root,path.join(t.root,file));
  await Promise.all(output.map(([file,lines])=>writeAtomic(path.join(t.root,file),lines.join("\n"))));
}
export async function generateDefinitions(modRoot:string,entries:MovieEntry[]){return generate(localTarget(modRoot),entries);}
async function generatePackDefinitions(pack:MoviePack,entries:MovieEntry[]){const t=packTarget(pack),n=ns(pack.modId);await generate(t,entries);const register=path.join(pack.root,`42/media/lua/shared/${n}/Register.lua`),distributions=path.join(pack.root,`42/media/lua/server/Items/${n}Distributions.lua`);await assertSafePath(pack.root,register);await assertSafePath(pack.root,distributions);await writeAtomic(register,[`local Registry = require "KBMGB/Movie/MoviePackRegistry"`,`local Catalog = require "${n}/Catalog"`,`Registry.register({ packId=${lua(pack.packId)}, modId=${lua(pack.modId)}, name=${lua(pack.name)}, entries=Catalog.entries or {} })`,""].join("\n"));await writeAtomic(distributions,['require "Items/ProceduralDistributions"',`local Catalog = require "${n}/Catalog"`,'local targets = { "MovieRentalShelves", "CrateVHSTapes" }','local function addOnce(items, fullType, weight)','    for i = 1, #items, 2 do if items[i] == fullType then items[i + 1] = weight; return end end','    items[#items + 1] = fullType','    items[#items + 1] = weight','end','local function addLoot()','    local entries = Catalog.entries or {}','    if #entries == 0 then return end','    local weight = 100 / #entries','    for _, listName in ipairs(targets) do','        local list = ProceduralDistributions.list[listName]','        if list and list.items then for _, entry in ipairs(entries) do addOnce(list.items, entry.itemType, weight) end end','    end',`    print("[KBMGB][MoviePack] ${pack.modId} VHS loot ready: " .. tostring(#entries))`,'end','Events.OnPreDistributionMerge.Add(addLoot)',''].join("\n"));}

async function sha256(file:string,onBytes?:(n:number)=>void){const h=createHash("sha256");let n=0;await new Promise<void>((resolve,reject)=>{const s=fs.createReadStream(file);s.on("data",(c:string|Buffer)=>{h.update(c);n+=Buffer.byteLength(c);onBytes?.(n);});s.on("error",reject);s.on("end",resolve);});return h.digest("hex");}
function execute(exe:string,args:string[],onLine?:(line:string)=>void,watchDirs:string[]=[]){
  return new Promise<{code:number;output:string}>((resolve,reject)=>{
    const p=spawn(exe,args,{windowsHide:true});
    let output="",pending="",lastOutput=Date.now(),timedOut=false,diskError:Error|null=null;
    const maxRuntime=setTimeout(()=>{timedOut=true;p.kill("SIGKILL");},24*60*60*1000);
    const idleCheck=setInterval(()=>{if(Date.now()-lastOutput>10*60*1000){timedOut=true;p.kill("SIGKILL");}},30*1000);
    const spaceCheck=watchDirs.length?setInterval(()=>{
      try { for(const dir of watchDirs) checkReserve(dir); }
      catch(error){ diskError=error as Error; p.kill("SIGKILL"); }
    },1000):null;
    const cleanup=()=>{clearTimeout(maxRuntime);clearInterval(idleCheck);if(spaceCheck)clearInterval(spaceCheck);};
    const collect=(c:string|Buffer)=>{lastOutput=Date.now();const x=c.toString();output=(output+x).slice(-20000);pending=(pending+x).slice(-65536);const lines=pending.split(/\r?\n/);pending=lines.pop()||"";lines.forEach(l=>onLine?.(l));};
    p.stdout.on("data",collect);p.stderr.on("data",collect);
    p.on("error",error=>{cleanup();reject(error);});
    p.on("close",code=>{cleanup();if(diskError){reject(diskError);return;}if(timedOut){reject(new Error("FFmpeg exceeded its time limit or stopped responding."));return;}if(pending)onLine?.(pending);resolve({code:code??-1,output});});
  });
}
const localInputProtocols=["-protocol_whitelist","file,pipe,crypto,data","-format_whitelist","mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,ogg"];
async function probe(ffmpeg:string,source:string){const r=await execute(ffmpeg,["-hide_banner",...localInputProtocols,"-i",source]);const m=r.output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);const duration=m?Number(m[1])*3600+Number(m[2])*60+Number(m[3]):0;if(!/Video:\s*[^\r\n]+/i.test(r.output))throw new Error("No video stream was found in this file.");return{duration,hasAudio:/Audio:\s*[^\r\n]+/i.test(r.output)};}
async function runFfmpeg(ffmpeg:string,args:string[],duration:number,start:number,span:number,progress:Progress,watchDirs:string[]){const r=await execute(ffmpeg,[...localInputProtocols,...args],line=>{const m=line.match(/^out_time_(?:us|ms)=(\d+)/);if(m&&duration>0)progress("Encoding",Math.min(start+span,start+span*Number(m[1])/1_000_000/duration));},watchDirs);if(r.code!==0)throw new Error(r.output.trim().split(/\r?\n/).slice(-8).join("\n")||`FFmpeg exited with code ${r.code}.`);}

export async function installMovie(uploadPath:string,sourceName:string,requestedTitle:string,progress:Progress,target?:Target){const t=target||currentTarget();await assertSafePath(t.root,t.root);if(await isPzRunning())throw new Error("Project Zomboid is running. Close it before importing movies.");const ffmpeg=findFfmpeg();if(!ffmpeg)throw new Error("The bundled FFmpeg executable could not be found.");const stat=await fsp.stat(uploadPath);checkConversionSpace(os.tmpdir(),t.root,stat.size);progress("Hashing source",1);const hash=await sha256(uploadPath,b=>progress("Hashing source",Math.min(5,b/stat.size*5))),id=hash.slice(0,12),title=(requestedTitle.trim()||path.parse(sourceName).name).replace(/[\x00-\x1f]+/g," ").trim().slice(0,120)||"Untitled movie",entries=await loadCatalogFor(t),existing=entries.find(e=>e.id===id);if(existing&&fs.existsSync(path.join(t.root,t.videoDir,`${id}.mp4`))){existing.title=title;await saveCatalogFor(t,entries);t.pack?await generatePackDefinitions(t.pack,entries):await generate(t,entries);progress("Already installed",100);await fsp.rm(uploadPath,{force:true});return existing;}progress("Inspecting streams",6);const info=await probe(ffmpeg,uploadPath),build=await fsp.mkdtemp(path.join(os.tmpdir(),`kbm-movie-${id}-`)),video=path.join(build,"video.mp4"),audio=path.join(build,"audio");await fsp.mkdir(audio);try{await runFfmpeg(ffmpeg,["-y","-hide_banner","-loglevel","error","-i",uploadPath,"-map","0:v:0","-an","-vf","scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2","-c:v","libx264","-profile:v","baseline","-pix_fmt","yuv420p","-crf","28","-bf","0","-x264-params","bframes=0","-movflags","+faststart","-progress","pipe:1","-nostats",video],info.duration,7,68,(p,n)=>progress(p==="Encoding"?"Encoding video":p,n),[build,t.root]);let chunks=0;if(info.hasAudio){await runFfmpeg(ffmpeg,["-y","-hide_banner","-loglevel","error","-i",uploadPath,"-map","0:a:0","-vn","-c:a","libvorbis","-ac","1","-ar","32000","-q:a","0","-progress","pipe:1","-nostats",path.join(audio,"audio.ogg")],info.duration,76,17,(p,n)=>progress(p==="Encoding"?"Encoding audio":p,n),[build,t.root]);chunks=1;}const encodedBytes=(await fsp.stat(video)).size+(chunks?(await fsp.stat(path.join(audio,"audio.ogg"))).size:0);checkInstallSpace(t.root,encodedBytes);progress("Installing media",94);const vdir=path.join(t.root,t.videoDir),adir=path.join(t.root,t.audioDir);await fsp.mkdir(vdir,{recursive:true});await fsp.mkdir(adir,{recursive:true});const vdest=path.join(vdir,`${id}.mp4`);await assertSafePath(t.root,vdest);const vtemp=`${vdest}.tmp`;await fsp.copyFile(video,vtemp);await fsp.rm(vdest,{force:true});await fsp.rename(vtemp,vdest);const adest=path.join(adir,id);await assertSafePath(t.root,adest);const atemp=path.join(adir,`${id}.tmp-${randomUUID()}`);await fsp.cp(audio,atemp,{recursive:true});await fsp.rm(adest,{recursive:true,force:true});await fsp.rename(atemp,adest);let audioBytes=0;for(const f of chunks?await fsp.readdir(adest):[])audioBytes+=(await fsp.stat(path.join(adest,f))).size;const entry:MovieEntry={id,sha256:hash,title,sourceName,createdAt:new Date().toISOString(),itemType:`${t.itemTypePrefix}${id}`,recMediaId:`${t.recPrefix}${id}`,video:`${t.videoPrefix}/${id}.mp4`,soundName:`${t.soundPrefix}${id}`,audioLayout:"single",audioChunks:chunks,audioChunkSeconds:30,duration:info.duration,videoBytes:(await fsp.stat(vdest)).size,audioBytes};const next=[...entries.filter(e=>e.id!==id),entry];await saveCatalogFor(t,next);t.pack?await generatePackDefinitions(t.pack,next):await generate(t,next);progress(t.kind==="pack"?"Added to movie pack":"Installed - restart Project Zomboid",100);return entry;}finally{await fsp.rm(build,{recursive:true,force:true});await fsp.rm(uploadPath,{force:true});}}
export async function removeMovie(id:string){const t=currentTarget();await assertSafePath(t.root,t.root);if(!/^[a-f0-9]{12}$/i.test(id))throw new Error("Invalid movie id.");if(await isPzRunning())throw new Error("Project Zomboid is running. Close it before removing movies.");const entries=await loadCatalogFor(t),entry=entries.find(e=>e.id===id);if(!entry)throw new Error("Movie not found.");const moviePath=path.join(t.root,t.videoDir,`${id}.mp4`),audioPath=path.join(t.root,t.audioDir,id);await assertSafePath(t.root,moviePath);await assertSafePath(t.root,audioPath);await fsp.rm(moviePath,{force:true});await fsp.rm(audioPath,{recursive:true,force:true});const remaining=entries.filter(e=>e.id!==id);await saveCatalogFor(t,remaining);t.pack?await generatePackDefinitions(t.pack,remaining):await generate(t,remaining);}
