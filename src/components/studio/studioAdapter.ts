import {adaptRatings,type Ratings} from "./ratingModel";
export type EvidenceStatus = 'MEASURED'|'INFERRED'|'PERSONALIZED'|'NOT ASSESSED'|'UNKNOWN'|'CONFLICT';
export type Evidence = { label: string; status: EvidenceStatus; value: string; provenance: string };
export type StudioReport = { version: string; ratings: Ratings; evidence: Evidence[]; scenes: {time:number;label:string}[]; music: Evidence; sources: Evidence[] };
const object = (v: unknown): Record<string, unknown> => v && typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const text=(v:unknown)=>typeof v==='string'?v:typeof v==='number'&&Number.isFinite(v)?String(v):'';
export function evidenceStatus(v:unknown):EvidenceStatus { const s=text(v);return ({MEASURED_SIGNAL:'MEASURED',MEASURED:'MEASURED',EVALUATED_SEMANTIC:'INFERRED',INFERRED:'INFERRED',PERSONALIZED_ESTIMATE:'PERSONALIZED',PERSONALIZED:'PERSONALIZED',NOT_YET_ASSESSED:'NOT ASSESSED',UNKNOWN:'UNKNOWN',CONFLICT:'CONFLICT',VERIFIED_MATCH:'INFERRED',POSSIBLE_MATCH:'INFERRED'} as Record<string,EvidenceStatus>)[s]||'UNKNOWN'; }
function collect(value:unknown,label:string,inherited:EvidenceStatus,provenance:string,depth=0):Evidence[]{
 if(depth>4)return [];
 const field=object(value);const status=field.status?evidenceStatus(field.status):inherited;const origin=text(field.provenance||field.evaluator)||provenance;
 const direct=field.value??field.predicted_score??field.score;
 if(direct===null||status==='NOT ASSESSED')return[{label,status,value:'Not yet assessed',provenance:origin}];
 if(text(direct))return[{label,status,value:text(direct),provenance:origin}];
 if(typeof value==='string'||typeof value==='number')return[{label,status,value:text(value),provenance:origin}];
 return Object.entries(field).filter(([k])=>!['status','provenance','owner_weights','evaluator'].includes(k)).flatMap(([k,v])=>collect(v,k.replace(/_/g,' '),status,origin,depth+1));
}
export function adaptStudioReport(input:unknown):StudioReport {
 const r=object(input);if(r.schema_version!=='6.0.0')throw Error('Import an Edit DNA v6.0.0 report.');
 const evidence:Evidence[]=[];const sources:Evidence[]=[];
 for(const [key,label]of [['section_a_visual_recognition','Visual source'],['section_b_music_recognition','Music identification'],['section_c_physical_signals','Technical measurements'],['section_d_semantic_evaluation','Semantic interpretation'],['section_e_personalized_model','Owner-fit estimate']] ){
 const section=object(r[key]);const status=evidenceStatus(section.status||section.provenance?.toString().toUpperCase());
 evidence.push(...collect(section,label,status,text(section.provenance)));
 if(key==='section_a_visual_recognition')for(const entity of (Array.isArray(section.candidates)?section.candidates:[section.matched_entity])){const e=object(entity);if(text(e.title||e.name))sources.push({label:text(e.type)||'Source candidate',status,value:text(e.title||e.name),provenance:text(section.provenance)});}
 }
 const m=object(r.section_b_music_recognition);const track=object(m.matched_track);const state=evidenceStatus(m.status);const music={label:'Detected music',status:state,value:state==='CONFLICT'?'Conflicting evidence — review needed':text(track.title)?[text(track.title),text(track.artist)].filter(Boolean).join(' · '):'Music not yet identified.',provenance:text(m.provenance)};
 const physical=object(r.section_c_physical_signals);const raw=Array.isArray(physical.cut_timestamps)?physical.cut_timestamps:[];const scenes=raw.filter((x):x is number=>typeof x==='number'&&Number.isFinite(x)&&x>=0).map((time,i)=>({time,label:`Cut ${i+1}`}));
 return{version:'6.0.0',ratings:adaptRatings(r),evidence,scenes,music,sources};
}
