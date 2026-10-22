import OBR,{type Theme as OBRTheme} from "@owlbear-rodeo/sdk";
import {useEffect,useMemo,useRef,useState,useSyncExternalStore,type ReactNode} from "react";
import {createRoot} from "react-dom/client";
import {Accordion,AccordionDetails,AccordionSummary,Alert,Box,Button,Chip,Collapse,Divider,FormControl,FormControlLabel,IconButton,InputLabel,LinearProgress,MenuItem,Paper,Select,Stack,Switch,TextField,Tooltip,Typography} from "@mui/material";
import {ThemeProvider,createTheme} from "@mui/material/styles";
import AddIcon from "@mui/icons-material/Add";
import PlayIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import ExpandIcon from "@mui/icons-material/ExpandMore";
import HelpIcon from "@mui/icons-material/HelpOutline";
import RouteIcon from "@mui/icons-material/Route";
import UndoIcon from "@mui/icons-material/Undo";
import {PanelController,type PanelSnapshot} from "./panel-controller";
import {VERSION,durationMs,normalizedSettings,type GroupView,type PauseEffect,type Settings} from "./shared";
import {effectCycleMs} from "./effects";
import "./style.css";

const controller=new PanelController(OBR);
const menuProps={disableScrollLock:true,marginThreshold:4,MenuListProps:{dense:true},PaperProps:{sx:{borderRadius:1}}};
const labelSx={m:0,minHeight:32,"& .MuiFormControlLabel-label":{fontSize:13}};
function SelectField({label,value,options,disabled,onChange}:{label:string;value:string;options:ReadonlyArray<readonly [string,string]>;disabled?:boolean;onChange:(value:string)=>void}){
 const id=useRef(`select-${crypto.randomUUID()}`).current;
 return <FormControl size="small" fullWidth disabled={disabled}><InputLabel id={id}>{label}</InputLabel><Select labelId={id} label={label} value={value} onChange={e=>onChange(e.target.value)} MenuProps={menuProps}>{options.map(([key,text])=><MenuItem key={key} value={key}>{text}</MenuItem>)}</Select></FormControl>;
}
function NumberField({label,value,min,max,step=1,disabled,onCommit}:{label:string;value:number;min:number;max:number;step?:number;disabled?:boolean;onCommit:(value:number)=>void}){
 const [text,setText]=useState(String(value)),[error,setError]=useState(false),focus=useRef(false);
 useEffect(()=>{if(!focus.current){setText(String(value));setError(false);}},[value]);
 function commit(){focus.current=false;const n=Number(text);if(!text.trim()||!Number.isFinite(n)||n<min||n>max){setError(true);return;}setError(false);if(n!==value)onCommit(n);}
 return <TextField size="small" fullWidth label={label} type="number" value={text} disabled={disabled} error={error} helperText={error?`${min}–${max}`:undefined} slotProps={{htmlInput:{min,max,step,inputMode:"decimal","aria-label":label}}} onFocus={()=>{focus.current=true;}} onChange={e=>setText(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();(e.target as HTMLInputElement).blur();}}}/>;
}
function NameField({value,disabled,onCommit}:{value:string;disabled:boolean;onCommit:(name:string)=>void}){
 const [text,setText]=useState(value),focus=useRef(false);useEffect(()=>{if(!focus.current)setText(value);},[value]);
 return <TextField fullWidth size="small" label="ชื่อกลุ่ม" value={text} disabled={disabled} slotProps={{htmlInput:{maxLength:80}}} onFocus={()=>{focus.current=true;}} onChange={e=>setText(e.target.value)} onBlur={()=>{focus.current=false;if(text!==value)onCommit(text);}} onKeyDown={e=>{if(e.key==="Enter")(e.target as HTMLInputElement).blur();}}/>;
}
function TipButton({title,disabled,onClick,children}:{title:string;disabled?:boolean;onClick:()=>void;children:ReactNode}){return <Tooltip title={title}><span><IconButton size="small" aria-label={title} disabled={disabled} onClick={onClick}>{children}</IconButton></span></Tooltip>;}
const effectOptions=[["none","ปกติ · ไม่ใส่เอฟเฟกต์"],["shake","สั่น"],["wiggle","ดุ๊กดิ๊ก · หมุนซ้าย–ขวา"]] as const;
const pointEffects=[["inherit","ตามเอฟเฟกต์กลุ่ม"],["none","หยุดนิ่ง"],["shake","สั่นตอนพัก"],["wiggle","ดุ๊กดิ๊กตอนพัก"]] as const;
function GroupPanel({group:g,snapshot}:{group:GroupView;snapshot:PanelSnapshot}){
 const {state,busy}=snapshot,draft=controller.draft(g),s=normalizedSettings(draft.settings),free=s.movement==="stationary";
 const unavailable=!snapshot.online||!state.gm||!state.ready,picking=!!state.pickingId,locked=unavailable||g.running||picking||busy,ready=free?s.effect!=="none":!!g.route;
 const update=(patch:Partial<Settings>)=>controller.update(g.id,patch);
 const perform=(type:"start"|"stop"|"pickLine"|"pickStart"|"capture"|"remove"|"reset"|"showRoute"|"select")=>controller.perform({type,id:g.id});
 const [details,setDetails]=useState(false),activePoint=g.waypointIndex??1;
 const phase=g.manualPaused?"พักให้ลาก/หมุน":g.running?(g.pauseRemaining?`พักจุด ${activePoint+1} · ${Math.ceil(g.pauseRemaining)} วิ`:free?(s.effect==="shake"?"กำลังสั่น":"กำลังดุ๊กดิ๊ก"):`กำลังเดิน · จุด ${activePoint+1}`):g.progress>=1&&s.mode==="once"?"จบรอบ":"พร้อม";
 const effectActive=s.effect!=="none"||s.waypointEffects?.some(e=>e==="wiggle"||e==="shake");
 return <Paper variant="outlined" component="article" aria-label={g.name} sx={{p:1.5,minWidth:0,borderRadius:2}}>
  <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{mb:1.5}}><Box sx={{minWidth:0}}><Typography variant="subtitle2" sx={{overflowWrap:"anywhere"}}>{draft.name||g.name}</Typography><Typography variant="caption" color="text.secondary">{g.count} Token · {free?"เอฟเฟกต์อิสระ":`${g.route?.length??0} จุด`}</Typography></Box><Chip size="small" variant="outlined" color={g.manualPaused?"warning":g.running?"primary":"default"} label={phase}/></Stack>
  <Stack spacing={1.5}>
   <Stack direction="row" spacing={1}><SelectField label="การเคลื่อนที่" value={s.movement} disabled={locked} options={[["line","เดิน LINE"],["stationary","เอฟเฟกต์อิสระ"]]} onChange={v=>update({movement:v as Settings["movement"],...(v==="stationary"&&s.effect==="none"?{effect:"wiggle"}:{})})}/><SelectField label="เอฟเฟกต์" value={s.effect} disabled={locked} options={free?effectOptions.slice(1):effectOptions} onChange={v=>update({effect:v as Settings["effect"]})}/></Stack>
   {free?<><SelectField label="การเล่นเอฟเฟกต์" value={s.mode} disabled={locked} options={[["patrol","วนซ้ำ (Loop)"],["once","ครั้งเดียว · จบแล้วกลับเป็น Play"]]} onChange={v=>update({mode:v as Settings["mode"]})}/><Typography variant="caption" color="text.secondary">หนึ่งรอบ ≈ {(effectCycleMs(s)/1000).toLocaleString("th-TH",{maximumFractionDigits:2})} วินาที</Typography><Alert severity="info" variant="outlined" sx={{py:0,"& .MuiAlert-message":{fontSize:12}}}>{g.manualPaused?"กำลังพักเอฟเฟกต์ ลากหรือหมุนได้ตามปกติ แล้วคลิกพื้นที่ว่างเพื่อเล่นต่อ":"เอฟเฟกต์จะพักเมื่อเลือก Token และเล่นต่อเมื่อคลิกพื้นที่ว่าง"}</Alert></>:<>
    <Stack direction="row" spacing={1} alignItems="flex-start"><Button size="small" variant="outlined" startIcon={<RouteIcon/>} disabled={locked||!g.count} sx={{flex:1,minHeight:40,whiteSpace:"nowrap"}} onClick={()=>perform("pickLine")}>{g.route?"วาด LINE ใหม่":"สร้าง LINE"}</Button><Box sx={{flex:1,minWidth:0}}><NumberField label="ความเร็ว (ช่อง/วิ)" value={s.speed} min={.1} max={20} step={.1} disabled={locked} onCommit={speed=>update({speed})}/></Box></Stack>
    <Stack direction="row" spacing={1} flexWrap="wrap"><FormControlLabel sx={labelSx} control={<Switch size="small" checked={s.mode==="patrol"} disabled={locked} onChange={(_,on)=>update({mode:on?"patrol":"once"})}/>} label="วนไปกลับ"/><FormControlLabel sx={labelSx} control={<Switch size="small" checked={s.flip} disabled={locked} onChange={(_,flip)=>update({flip})}/>} label="Flip ตามทิศเดิน"/></Stack>
   </>}
   {!g.count&&<Alert severity="warning">เลือก Token บนแผนที่แล้วกดเปลี่ยน Token ในตั้งค่า</Alert>}{!free&&!g.route&&<Typography variant="caption" color="text.secondary">สร้าง LINE แล้วคลิกช่องเริ่มและจุดถัดไปบนแผนที่</Typography>}{g.message.startsWith("หยุดเพราะเกิดข้อผิดพลาด")&&<Alert severity="error">{g.message}</Alert>}
   <Button size="small" fullWidth variant={g.running?"outlined":"contained"} color={g.running?"inherit":"primary"} startIcon={g.running?<StopIcon/>:<PlayIcon/>} disabled={unavailable||picking||(!g.running&&(busy||!ready||!g.count))} onClick={()=>perform(g.running?"stop":"start")}>{g.running?"หยุด":free?"เล่นเอฟเฟกต์":g.progress>0&&g.progress<1?"เดินต่อ":"เริ่มเดิน"}</Button>
   {g.running&&<LinearProgress variant="determinate" aria-label={`ความคืบหน้า ${g.name}`} value={Math.max(0,Math.min(100,g.progress*100))} color={g.manualPaused?"inherit":"primary"}/>}
   <Accordion disableGutters elevation={0} expanded={details} onChange={(_,on)=>setDetails(on)} sx={{background:"transparent","&:before":{display:"none"}}}>
    <AccordionSummary expandIcon={<ExpandIcon/>} sx={{p:0,minHeight:32,"& .MuiAccordionSummary-content":{my:.5}}}><Typography variant="body2">ตั้งค่า · {g.name}</Typography></AccordionSummary>
    <AccordionDetails sx={{p:0,pt:1}}><Stack spacing={1.5}>
     <NameField value={draft.name} disabled={locked} onCommit={name=>controller.update(g.id,{},name)}/>
     {!free&&<><Stack direction="row" spacing={1}><Button fullWidth size="small" variant="outlined" disabled={locked||!g.route} onClick={()=>perform("pickStart")}>เลือกจุดเริ่ม</Button><Button fullWidth size="small" variant="outlined" disabled={unavailable||picking||busy||!g.route} onClick={()=>{if(state.selectedId!==g.id)perform("select");if(state.selectedId===g.id||state.routeVisible===false)perform("showRoute");}}>{state.selectedId===g.id&&state.routeVisible!==false?"ซ่อนเส้นทาง":"แสดงเส้นทาง"}</Button></Stack><FormControlLabel sx={labelSx} control={<Switch size="small" checked={s.smooth} disabled={locked} onChange={(_,smooth)=>update({smooth})}/>} label="ค่อย ๆ ออกตัวและหยุด"/><SelectField label="ภาพต้นฉบับหัน" value={s.facing} disabled={locked||!s.flip} options={[["right","ขวา →"],["left","ซ้าย ←"]]} onChange={facing=>update({facing:facing as Settings["facing"]})}/></>}
     {effectActive&&<><Divider/>{(s.effect==="wiggle"||s.waypointEffects?.includes("wiggle"))&&<NumberField label="หมุนซ้าย–ขวา ± (องศา)" value={s.wiggleAngle} min={1} max={30} disabled={locked} onCommit={wiggleAngle=>update({wiggleAngle})}/>} {(s.effect==="shake"||s.waypointEffects?.includes("shake"))&&<NumberField label="ระยะสั่น ± (ช่อง)" value={s.shakeDistance} min={.005} max={.25} step={.005} disabled={locked} onCommit={shakeDistance=>update({shakeDistance})}/>}<NumberField label="จังหวะเอฟเฟกต์ (เท่า)" value={s.effectSpeed} min={.25} max={3} step={.25} disabled={locked} onCommit={effectSpeed=>update({effectSpeed})}/></>}
     {!free&&g.route&&<Accordion disableGutters elevation={0} sx={{background:"transparent","&:before":{display:"none"}}}><AccordionSummary expandIcon={<ExpandIcon/>} sx={{p:0}}><Typography variant="body2">เวลาเดิน · จุดพัก · เอฟเฟกต์รายจุด</Typography></AccordionSummary><AccordionDetails sx={{p:0}}><Stack spacing={1.5}>
      <Typography variant="caption" color="text.secondary">เวลาเดินไม่รวมเวลาพัก · 0 วินาที = ผ่านเลย · วนไปกลับพักทั้งสองขา</Typography>
      {g.route.map((point,i)=><Box key={i} sx={{pb:1.5,borderBottom:1,borderColor:"divider"}}><Stack direction="row" spacing={1} alignItems="center" sx={{mb:1}}><Chip size="small" label={i+1}/><Box><Typography variant="body2">จุด {i+1}{i===0?" · เริ่ม":i===g.route!.length-1?" · สุดท้าย":""}</Typography><Typography variant="caption" color="text.secondary">{i===0?"ออกเดินทันที · เวลาพักใช้ตอนกลับ":state.gridDpi?`เดินถึงจุดนี้ ${(durationMs(g.route![i-1],point,state.gridDpi,s.speed)/1000).toLocaleString("th-TH",{maximumFractionDigits:2})} วินาที`:"กำลังอ่านกริด"}</Typography></Box></Stack><Stack spacing={1}>
       <NumberField label={`เวลาพักจุด ${i+1} (วินาที)`} value={s.waypointPauses?.[i]??0} min={0} max={3600} step={.1} disabled={locked} onCommit={value=>{const pauses=Array.from({length:g.route!.length},(_,n)=>s.waypointPauses?.[n]??0);pauses[i]=value;update({waypointPauses:pauses});}}/>
       <SelectField label={`เอฟเฟกต์ตอนพักจุด ${i+1}`} value={s.waypointEffects?.[i]??"inherit"} options={pointEffects} disabled={locked} onChange={value=>{const effects=Array.from({length:g.route!.length},(_,n)=>s.waypointEffects?.[n]??"inherit");effects[i]=value as PauseEffect;update({waypointEffects:effects});}}/>
      </Stack></Box>)}
     </Stack></AccordionDetails></Accordion>}
     <Divider/><Stack direction="row" spacing={.5} flexWrap="wrap"><Button size="small" color="inherit" disabled={locked} onClick={()=>perform("capture")}>เปลี่ยน Token</Button><Button size="small" color="inherit" disabled={unavailable||picking||busy||(!free&&!g.route)} onClick={()=>perform("reset")}>{free?"ปิดเอฟเฟกต์":"กลับจุดเริ่ม"}</Button><Button size="small" color="error" disabled={unavailable||picking||busy} onClick={()=>perform("remove")}>ลบกลุ่ม</Button></Stack>
    </Stack></AccordionDetails>
   </Accordion>
  </Stack>
 </Paper>;
}
function Panel(){
 const snapshot=useSyncExternalStore(controller.subscribe,controller.getSnapshot),{state,online,busy}=snapshot;
 const [hostTheme,setHostTheme]=useState<OBRTheme>(),[help,setHelp]=useState(false);
 useEffect(()=>{controller.connect();let live=true;let unsubscribe:(()=>void)|undefined;
  if(OBR.isAvailable)OBR.onReady(async()=>{unsubscribe=OBR.theme.onChange(t=>{if(live)setHostTheme(t);});try{const theme=await OBR.theme.getTheme();if(live)setHostTheme(theme);}catch{}});
  return()=>{live=false;unsubscribe?.();controller.dispose();};
 },[]);
 const theme=useMemo(()=>createTheme({palette:{mode:hostTheme?.mode==="LIGHT"?"light":"dark",primary:hostTheme?.primary??{main:"#bb99ff"},secondary:hostTheme?.secondary??{main:"#bb99ff"},...(hostTheme?{text:hostTheme.text}:{}),background:{default:"transparent",paper:hostTheme?.background.paper??"#3d4051"}},shape:{borderRadius:12},typography:{fontFamily:"Roboto, Arial, Tahoma, sans-serif",fontSize:13},components:{MuiButtonBase:{defaultProps:{disableRipple:true}},MuiButton:{styleOverrides:{root:{textTransform:"none",minHeight:32}}},MuiInputBase:{styleOverrides:{input:{fontSize:13}}},MuiMenuItem:{styleOverrides:{root:{fontSize:13,minHeight:32}}}}}),[hostTheme]);
 const unavailable=!online||!state.ready||!state.gm,running=state.groups.filter(g=>g.running).length,paused=state.groups.filter(g=>g.manualPaused).length,error=snapshot.error||state.error,pick=state.groups.find(g=>g.id===state.pickingId);
 return <ThemeProvider theme={theme}><Stack spacing={1.5} sx={{p:1,color:"text.primary",minWidth:0}}>
  <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between"><Typography variant="subtitle1" fontWeight={500}>Token Move</Typography><Stack direction="row"><TipButton title="เริ่มทุกกลุ่ม" disabled={unavailable||busy||!!pick||!state.groups.some(g=>!g.running&&g.count&&(g.settings.movement==="stationary"?g.settings.effect!=="none":g.route))} onClick={()=>controller.perform({type:"startAll"})}><PlayIcon/></TipButton><TipButton title="หยุดทุกกลุ่ม" disabled={unavailable||!running} onClick={()=>controller.perform({type:"stopAll"})}><StopIcon/></TipButton></Stack></Stack>
  <Divider/>{!OBR.isAvailable&&<Alert severity="info">เปิดส่วนเสริมนี้จากห้อง Owlbear Rodeo เพื่อใช้งาน</Alert>}
  <Stack direction="row" spacing={.5}><Button fullWidth size="small" variant="outlined" startIcon={<AddIcon/>} disabled={unavailable||busy||!!pick} onClick={()=>controller.perform({type:"create"})}>เพิ่มกลุ่มจาก Token ที่เลือก</Button><TipButton title="วิธีใช้งาน" onClick={()=>setHelp(!help)}><HelpIcon/></TipButton></Stack>
  <Collapse in={help}><Alert severity="info" variant="outlined"><Typography variant="body2">เลือก Token → เพิ่มกลุ่ม → เลือกโหมด → กดเล่น</Typography><Typography variant="body2" sx={{mt:1}}>เอฟเฟกต์อิสระ: ขณะเลือก Token เอฟเฟกต์จะพักให้ลากหรือหมุนด้วยเครื่องมือเดิม คลิกพื้นที่ว่างเพื่อเล่นต่อ เวลาที่พักไม่นับเป็นเวลาเอฟเฟกต์</Typography><Typography variant="body2" sx={{mt:1}}>LINE: คลิกช่องเริ่มและจุดถัดไป Enter หรือคลิกจุดล่าสุดซ้ำเพื่อบันทึก · Backspace ย้อนจุด · Esc ยกเลิก</Typography></Alert></Collapse>
  <Stack direction="row" justifyContent="space-between"><Typography variant="caption" color="text.secondary">{state.groups.length} กลุ่ม</Typography><Typography variant="caption" color="text.secondary">{running?`${running} เปิดใช้งาน${paused?` · ${paused} พักให้ลาก`:""}`:"พร้อมใช้งาน"}</Typography></Stack>
  {!state.groups.length&&<Paper variant="outlined" sx={{p:3,textAlign:"center"}}><Typography variant="body2">เลือก Token แล้วเพิ่มกลุ่มแรก</Typography><Typography variant="caption" color="text.secondary">เดินตาม LINE หรือเล่นเอฟเฟกต์อิสระ</Typography></Paper>}
  {state.groups.map(g=><GroupPanel key={g.id} group={g} snapshot={snapshot}/>)}
  {pick&&<Alert severity="info"><Stack spacing={1}><Typography variant="body2">{state.pickMode==="line"?`วาด LINE · ${state.draft?.length??0} จุด`:`เลือกจุดเริ่ม · ${pick.name}`}</Typography><Typography variant="caption">{state.message}</Typography><Stack direction="row" spacing={.5}>{state.pickMode==="line"&&<><Button size="small" variant="contained" disabled={busy||(state.draft?.length??0)<2} onClick={()=>controller.perform({type:"finishLine",id:pick.id})}>บันทึก LINE</Button><TipButton title="ย้อนจุดล่าสุด" disabled={busy||!state.draft?.length} onClick={()=>controller.perform({type:"undoLine",id:pick.id})}><UndoIcon/></TipButton></>}<Button size="small" disabled={busy} onClick={()=>controller.perform({type:"cancelPick",id:pick.id})}>ยกเลิก</Button></Stack></Stack></Alert>}
  {error&&<Alert severity="error">{error}</Alert>}<Divider/>
  <Stack direction="row" spacing={1} justifyContent="space-between"><Typography variant="caption" color="text.secondary" role="status" aria-live="polite">{busy?"กำลังบันทึก…":unavailable?state.message:snapshot.drafts.size?"มีการแก้ไขที่ยังไม่บันทึก":"บันทึกอัตโนมัติ"}</Typography><Typography variant="caption" color="text.secondary" sx={{whiteSpace:"nowrap"}}>{online?(state.gm?"GM":"ผู้เล่น"):"ตัวอย่าง"} · {VERSION}</Typography></Stack>
 </Stack></ThemeProvider>;
}
const root=createRoot(document.querySelector("#app")!);root.render(<Panel/>);window.addEventListener("pagehide",()=>root.unmount(),{once:true});

