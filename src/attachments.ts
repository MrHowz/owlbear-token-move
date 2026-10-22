import type {Item} from "@owlbear-rodeo/sdk";
/** Select a hierarchy once, even when both a parent and several children are selected. */
export function selectionRoots(selected:Item[],scene:Item[]):Item[]{
 const byId=new Map(scene.map(i=>[i.id,i])),roots=new Map<string,Item>();
 for(const item of selected){let root=byId.get(item.id)??item;const seen=new Set<string>();
  while(root.attachedTo){if(seen.has(root.id))throw new Error("พบวงวนการ attach กรุณาแก้การแนบก่อน");seen.add(root.id);const parent=byId.get(root.attachedTo);if(!parent)throw new Error("ไม่พบ Token หลักที่ attach อยู่ กรุณาเลือกชุดใหม่");root=parent;}
  if(root.locked)throw new Error("ปลดล็อก Token หลักก่อนเริ่ม");roots.set(root.id,root);
 }
 return [...roots.values()];
}
/** Interactions skip hierarchy processing, so apply each parent's delta exactly once. */
export function followAttachments(items:Item[],before:Item[],rootIds:Set<string>){
 const old=new Map(before.map(i=>[i.id,i])),next=new Map(items.map(i=>[i.id,i]));const done=new Set(rootIds),visiting=new Set<string>();
 function follow(item:Item){
  if(done.has(item.id))return;if(visiting.has(item.id))throw new Error("พบวงวนการ attach");visiting.add(item.id);
  const parent=item.attachedTo?next.get(item.attachedTo):undefined;
  if(parent){follow(parent);const prev=old.get(parent.id),original=old.get(item.id);
   if(prev&&original){const disabled=item.disableAttachmentBehavior??[],angle=(parent.rotation-prev.rotation)*Math.PI/180;
    const sx=prev.scale.x===0?1:parent.scale.x/prev.scale.x,sy=prev.scale.y===0?1:parent.scale.y/prev.scale.y;
    if(!disabled.includes("POSITION")){const x=(original.position.x-prev.position.x)*sx,y=(original.position.y-prev.position.y)*sy;item.position={x:parent.position.x+x*Math.cos(angle)-y*Math.sin(angle),y:parent.position.y+x*Math.sin(angle)+y*Math.cos(angle)};}
    if(!disabled.includes("ROTATION"))item.rotation=original.rotation+parent.rotation-prev.rotation;
    if(!disabled.includes("SCALE"))item.scale={x:original.scale.x*sx,y:original.scale.y*sy};
   }
  }
  visiting.delete(item.id);done.add(item.id);
 }
 items.forEach(follow);
}
