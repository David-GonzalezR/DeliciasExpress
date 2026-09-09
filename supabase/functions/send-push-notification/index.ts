import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@deliciasexpress.local";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
const enc = new TextEncoder();
const STATUS_LABELS: Record<string,string> = { recibido:"Recibido ✅", preparando:"Preparando 👨‍🍳", buscando_domiciliario:"Buscando domiciliario 🔍", en_camino:"En camino 🛵", entregado:"Entregado 🏠", cancelado:"Cancelado ❌" };

function b64uToBytes(s:string){ const b=s.replace(/-/g,"+").replace(/_/g,"/"); const p=b.padEnd(b.length+(4-b.length%4)%4,"="); return Uint8Array.from(atob(p),c=>c.charCodeAt(0)); }
function bytesToB64u(a:Uint8Array){ return btoa(String.fromCharCode(...a)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,""); }
async function hkdfExtract(salt:Uint8Array, ikm:Uint8Array){ const k=await crypto.subtle.importKey("raw",ikm,"HKDF",false,["deriveBits"]); return new Uint8Array(await crypto.subtle.deriveBits({name:"HKDF",hash:"SHA-256",salt,info:new Uint8Array()},k,256)); }
async function hkdfExpand(prk:Uint8Array, info:Uint8Array, len:number){ const k=await crypto.subtle.importKey("raw",prk,{name:"HMAC",hash:"SHA-256"},false,["sign"]); const out:number[]=[]; let prev=new Uint8Array(), counter=1; while(out.length<len){ const msg=new Uint8Array(prev.length+info.length+1); msg.set(prev); msg.set(info,prev.length); msg[msg.length-1]=counter++; prev=new Uint8Array(await crypto.subtle.sign("HMAC",k,msg)); out.push(...prev); } return new Uint8Array(out.slice(0,len)); }
function concat(...parts:Uint8Array[]){ const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0)); let o=0; for(const p of parts){out.set(p,o);o+=p.length;} return out; }
function u16(n:number){ const b=new Uint8Array(2); new DataView(b.buffer).setUint16(0,n,false); return b; }
function u32(n:number){ const b=new Uint8Array(4); new DataView(b.buffer).setUint32(0,n,false); return b; }
function derLen(n:number){ return n<128?new Uint8Array([n]):n<256?new Uint8Array([0x81,n]):new Uint8Array([0x82,(n>>8)&255,n&255]); }
function der(tag:number,body:Uint8Array){ return concat(new Uint8Array([tag]),derLen(body.length),body); }
function rawPrivateToPkcs8(raw:Uint8Array){
  const alg=der(0x30,concat(der(0x06,new Uint8Array([0x2a,0x86,0x48,0xce,0x3d,0x02,0x01])),der(0x06,new Uint8Array([0x2a,0x86,0x48,0xce,0x3d,0x03,0x01,0x07]))));
  return der(0x30,concat(new Uint8Array([0x02,0x01,0x00]),alg,der(0x04,raw)));
}
async function importVapidPrivate(){
  const raw=b64uToBytes(VAPID_PRIVATE_KEY);
  if(raw.length===32){ return crypto.subtle.importKey("pkcs8",rawPrivateToPkcs8(raw),{name:"ECDSA",namedCurve:"P-256"},false,["sign"]); }
  return crypto.subtle.importKey("pkcs8",raw,{name:"ECDSA",namedCurve:"P-256"},false,["sign"]);
}
async function vapidJwt(aud:string){
  const now=Math.floor(Date.now()/1000), header=bytesToB64u(enc.encode(JSON.stringify({typ:"JWT",alg:"ES256"}))), payload=bytesToB64u(enc.encode(JSON.stringify({aud,exp:now+43200,sub:VAPID_SUBJECT}))), input=`${header}.${payload}`;
  const key=await importVapidPrivate();
  const sig=new Uint8Array(await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},key,enc.encode(input)));
  return `${input}.${bytesToB64u(sig)}`;
}
async function encrypt(sub:{p256dh:string,auth:string},payload:string){
  const uaPub=b64uToBytes(sub.p256dh), authSecret=b64uToBytes(sub.auth);
  const eph=await crypto.subtle.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveBits"]);
  const serverPub=new Uint8Array(await crypto.subtle.exportKey("raw",eph.publicKey));
  const receiverPub=await crypto.subtle.importKey("raw",uaPub,{name:"ECDH",namedCurve:"P-256"},false,[]);
  const shared=new Uint8Array(await crypto.subtle.deriveBits({name:"ECDH",public:receiverPub},eph.privateKey,256));
  const prkKey=await hkdfExtract(authSecret,shared);
  const info=concat(enc.encode("WebPush: info\0"),uaPub,serverPub);
  const ikm=await hkdfExpand(prkKey,info,32);
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const prk=await hkdfExtract(salt,ikm);
  const cek=await hkdfExpand(prk,enc.encode("Content-Encoding: aes128gcm\0"),16);
  const nonce=await hkdfExpand(prk,enc.encode("Content-Encoding: nonce\0"),12);
  const aes=await crypto.subtle.importKey("raw",cek,"AES-GCM",false,["encrypt"]);
  const plain=enc.encode(payload), padded=concat(plain,new Uint8Array([2]));
  const cipher=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv:nonce},aes,padded));
  return concat(salt,u32(4096),new Uint8Array([serverPub.length]),serverPub,cipher);
}
async function pushOne(sub:{endpoint:string,p256dh:string,auth:string},payload:string){
  const u=new URL(sub.endpoint), jwt=await vapidJwt(`${u.protocol}//${u.host}`), body=await encrypt(sub,payload);
  const r=await fetch(sub.endpoint,{method:"POST",headers:{Authorization:`vapid t=${jwt},k=${VAPID_PUBLIC_KEY}`,"Content-Type":"application/octet-stream","Content-Encoding":"aes128gcm",TTL:"86400"},body});
  if(r.status===404||r.status===410) await supabase.from("push_subscriptions").delete().eq("endpoint",sub.endpoint);
  return r.ok||r.status===201;
}
async function sendPush(subs:any[],payload:any){ await Promise.allSettled(subs.map(s=>pushOne(s,JSON.stringify(payload)))); }
async function subscriptionsForUserIds(ids:string[]){ if(!ids.length)return []; const {data}=await supabase.from("push_subscriptions").select("endpoint,p256dh,auth,user_id").in("user_id",ids); return data||[]; }

serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST,OPTIONS","Access-Control-Allow-Headers":"content-type,authorization"}});
  try{
    const {type,record,old_record}=await req.json(); if(!record)return new Response("OK",{status:200});
    const order=record,id=order.id as string,status=order.status as string,oldStatus=old_record?.status as string|undefined,shortId=id.slice(0,8).toUpperCase();
    if(type==="INSERT"){
      const {data:admins}=await supabase.from("push_subscriptions").select("endpoint,p256dh,auth").eq("role","admin");
      if(admins?.length) await sendPush(admins,{title:"🔔 Nuevo Pedido - DeliciasExpress",body:`Pedido #${shortId} recibido`,icon:"/icon-192.png",badge:"/icon-192.png",tag:`new-order-${id}`,data:{url:"/admin.html",orderId:id}});
    }
    if(type==="UPDATE"&&status!==oldStatus){
      const payload={title:"DeliciasExpress 🍔",body:`Tu pedido #${shortId} está: ${STATUS_LABELS[status]||status}`,icon:"/icon-192.png",badge:"/icon-192.png",tag:`order-status-${id}`,renotify:true,data:{url:"/index.html",orderId:id}};
      const clientSubs:any[]=[];
      if(order.user_id){const {data}=await supabase.from("push_subscriptions").select("endpoint,p256dh,auth").eq("user_id",order.user_id);if(data)clientSubs.push(...data);}
      const {data:anon}=await supabase.from("push_subscriptions").select("endpoint,p256dh,auth").contains("order_ids",[id]);if(anon)clientSubs.push(...anon);
      const unique=Array.from(new Map(clientSubs.map(s=>[s.endpoint,s])).values()); if(unique.length)await sendPush(unique,payload);
      if(status==="buscando_domiciliario"){
        const {data:riders}=await supabase.from("riders").select("id").eq("is_available",true); const ids=(riders||[]).map(r=>r.id).filter(Boolean); const riderSubs=await subscriptionsForUserIds(ids);
        if(riderSubs.length)await sendPush(riderSubs,{title:"🛵 Nuevo pedido disponible",body:`Pedido #${shortId} listo para tomar`,icon:"/icon-192.png",badge:"/icon-192.png",tag:`rider-order-${id}`,renotify:true,data:{url:"/domiciliario.html",orderId:id}});
      }
    }
    return new Response(JSON.stringify({ok:true}),{status:200,headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":"*"}});
  }catch(e){console.error("[push-fn]",e);return new Response(JSON.stringify({ok:false,error:String(e)}),{status:500,headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":"*"}})}
});
