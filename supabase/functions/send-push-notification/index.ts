// supabase/functions/send-push-notification/index.ts
// Edge Function que envía Web Push cuando cambia el estado de un pedido.
// Disparada por el Database Webhook de Supabase sobre la tabla `orders`.
// ─────────────────────────────────────────────────────────────────────────────
// CORRECCIONES APLICADAS (2026-09-08):
// 1. Cifrado actualizado de aesgcm (obsoleto) a aes128gcm (RFC 8291)
//    — Chrome 124+, Firefox 128+, Samsung Internet 26+ requieren aes128gcm
// 2. Campo rider_id corregido a assigned_rider_id (nombre real en tabla orders)
// 3. verify_jwt desactivado via API de Supabase (necesario para webhooks)
// ─────────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── VAPID ──────────────────────────────────────────────────────────────────
const VAPID_PUBLIC_KEY  = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT     = Deno.env.get("VAPID_SUBJECT")!;

// ── Supabase (service role para bypasear RLS) ──────────────────────────────
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ── Labels de estado ───────────────────────────────────────────────────────
const STATUS_LABELS: Record<string, string> = {
  recibido:              "Recibido ✅",
  preparando:            "Preparando 👨‍🍳",
  buscando_domiciliario: "Buscando domiciliario 🔍",
  en_camino:             "En camino 🛵",
  entregado:             "Entregado 🏠",
  cancelado:             "Cancelado ❌",
};

// ── Helpers base64url ──────────────────────────────────────────────────────
function base64urlToUint8Array(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function uint8ArrayToBase64url(arr: Uint8Array): string {
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

// ── VAPID JWT ──────────────────────────────────────────────────────────────
async function createVapidJwt(audience: string): Promise<string> {
  const header  = { typ: "JWT", alg: "ES256" };
  const now     = Math.floor(Date.now() / 1000);
  const payload = { aud: audience, exp: now + 12 * 3600, sub: VAPID_SUBJECT };

  const enc = new TextEncoder();
  const b64Header  = uint8ArrayToBase64url(enc.encode(JSON.stringify(header)));
  const b64Payload = uint8ArrayToBase64url(enc.encode(JSON.stringify(payload)));
  const sigInput   = `${b64Header}.${b64Payload}`;

  const rawKey = base64urlToUint8Array(VAPID_PRIVATE_KEY);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    rawKey,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  ).catch(async () => {
    return await crypto.subtle.importKey(
      "raw",
      rawKey,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"]
    );
  });

  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    cryptoKey,
    enc.encode(sigInput)
  );

  return `${sigInput}.${uint8ArrayToBase64url(new Uint8Array(sig))}`;
}

// ── HKDF helper ───────────────────────────────────────────────────────────
async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    length * 8
  );
  return new Uint8Array(bits);
}

// ── Cifrado Web Push RFC 8291 — aes128gcm (CORRECCIÓN del aesgcm obsoleto) ─
// Implementación correcta de la Sección 4 del RFC 8291.
// Los navegadores modernos (Chrome 124+) rechazan el esquema "aesgcm" anterior.
async function encryptPayload(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string
): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const plaintext = enc.encode(payload);

  const receiverPublicKey = base64urlToUint8Array(subscription.keys.p256dh);
  const authSecret        = base64urlToUint8Array(subscription.keys.auth);

  // Par de claves efímeras del servidor
  const serverKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey", "deriveBits"]
  );

  const serverPublicKeyRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", serverKeyPair.publicKey)
  );

  const receiverKey = await crypto.subtle.importKey(
    "raw",
    receiverPublicKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: receiverKey },
      serverKeyPair.privateKey,
      256
    )
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));

  // RFC 8291: PRK usando HKDF(sharedSecret, authSecret, "Content-Encoding: auth\0", 32)
  const prk = await hkdf(
    sharedSecret,
    authSecret,
    enc.encode("Content-Encoding: auth\0"),
    32
  );

  // Construir context info para aes128gcm
  function buildInfo(label: string): Uint8Array {
    const labelBytes = enc.encode(label + "\0");
    const buf = new Uint8Array(labelBytes.length + 2 + receiverPublicKey.length + 2 + serverPublicKeyRaw.length);
    let o = 0;
    buf.set(labelBytes, o); o += labelBytes.length;
    new DataView(buf.buffer).setUint16(o, receiverPublicKey.length, false); o += 2;
    buf.set(receiverPublicKey, o); o += receiverPublicKey.length;
    new DataView(buf.buffer).setUint16(o, serverPublicKeyRaw.length, false); o += 2;
    buf.set(serverPublicKeyRaw, o);
    return buf;
  }

  const contentEncKey = await hkdf(prk, salt, buildInfo("Content-Encoding: aes128gcm"), 16);
  const nonce         = await hkdf(prk, salt, buildInfo("Content-Encoding: nonce"),     12);

  const contentKey = await crypto.subtle.importKey(
    "raw", contentEncKey, "AES-GCM", false, ["encrypt"]
  );

  // Padding: agregar byte 0x02 (delimitador RFC 8291) después del plaintext
  const padded = new Uint8Array(plaintext.length + 1);
  padded.set(plaintext);
  padded[plaintext.length] = 0x02;

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      contentKey,
      padded
    )
  );

  // RFC 8291 Sección 4: cuerpo = salt(16) + rs(4) + keyid_len(1) + keyid(65) + ciphertext
  const rs = 4096;
  const keyidLen = serverPublicKeyRaw.length; // 65 bytes (punto sin comprimir P-256)
  const body = new Uint8Array(16 + 4 + 1 + keyidLen + ciphertext.length);
  let o = 0;
  body.set(salt, o);                                           o += 16;
  new DataView(body.buffer).setUint32(o, rs, false);           o += 4;
  body[o++] = keyidLen;
  body.set(serverPublicKeyRaw, o);                             o += keyidLen;
  body.set(ciphertext, o);

  return body;
}

// ── Enviar notificación push a un suscriptor ───────────────────────────────
async function pushToOne(
  sub: { endpoint: string; p256dh: string; auth: string },
  payloadStr: string
): Promise<boolean> {
  const endpointUrl = new URL(sub.endpoint);
  const audience = `${endpointUrl.protocol}//${endpointUrl.host}`;
  const jwt = await createVapidJwt(audience);

  const body = await encryptPayload(
    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    payloadStr
  );

  // CORRECCIÓN: Content-Encoding es "aes128gcm" (RFC 8291), no "aesgcm"
  const response = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Authorization":    `vapid t=${jwt},k=${VAPID_PUBLIC_KEY}`,
      "Content-Type":     "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      "TTL":              "86400",
    },
    body,
  });

  if (response.status === 410 || response.status === 404) {
    await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    return false;
  }

  return response.ok || response.status === 201;
}

// ── Enviar a múltiples suscriptores ───────────────────────────────────────
async function sendPush(
  subs: { endpoint: string; p256dh: string; auth: string }[],
  payloadStr: string
) {
  await Promise.allSettled(subs.map((s) => pushToOne(s, payloadStr)));
}

// ── Handler principal ──────────────────────────────────────────────────────
serve(async (req) => {
  // Preflight CORS
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST" },
    });
  }

  try {
    const body = await req.json();
    const { type, record, old_record } = body;

    if (!record) return new Response("OK", { status: 200 });

    const order     = record;
    const orderId   = order.id as string;
    const newStatus = order.status as string;
    const oldStatus = old_record?.status as string | undefined;
    const isInsert  = type === "INSERT";

    // ── 1. NUEVO PEDIDO → notificar a todos los admins ──
    if (isInsert) {
      const { data: adminSubs } = await supabase
        .from("push_subscriptions")
        .select("endpoint, p256dh, auth")
        .eq("role", "admin");

      if (adminSubs?.length) {
        await sendPush(
          adminSubs,
          JSON.stringify({
            title: "🔔 Nuevo Pedido - DeliciasExpress",
            body:  `Pedido #${orderId.slice(0, 8).toUpperCase()} recibido`,
            icon:  "/icon-192.png",
            badge: "/badge-72.png",
            tag:   `new-order-${orderId}`,
            data:  { url: "/admin.html", orderId },
          })
        );
      }
    }

    // ── 2. CAMBIO DE ESTADO → notificar al cliente ──
    if (type === "UPDATE" && newStatus && newStatus !== oldStatus) {
      const statusLabel = STATUS_LABELS[newStatus] || newStatus;
      const shortId = orderId.slice(0, 8).toUpperCase();
      let clientSubs: { endpoint: string; p256dh: string; auth: string }[] = [];

      // Por user_id (cliente registrado)
      if (order.customer_user_id) {
        const { data } = await supabase
          .from("push_subscriptions")
          .select("endpoint, p256dh, auth")
          .eq("user_id", order.customer_user_id);
        if (data) clientSubs = data;
      }

      // Por order_id en suscripciones anónimas
      const { data: anonSubs } = await supabase
        .from("push_subscriptions")
        .select("endpoint, p256dh, auth")
        .contains("order_ids", [orderId]);
      if (anonSubs) clientSubs = [...clientSubs, ...anonSubs];

      // Deduplicar por endpoint
      const uniqueSubs = Array.from(new Map(clientSubs.map((s) => [s.endpoint, s])).values());

      if (uniqueSubs.length) {
        await sendPush(
          uniqueSubs,
          JSON.stringify({
            title:    "DeliciasExpress 🍔",
            body:     `Tu pedido #${shortId} está: ${statusLabel}`,
            icon:     "/icon-192.png",
            badge:    "/badge-72.png",
            tag:      `order-status-${orderId}`,
            renotify: true,
            data:     { url: "/index.html", orderId },
          })
        );
      }

      // ── 3. PEDIDO ASIGNADO → notificar al domiciliario ──
      // CORRECCIÓN BUG #2: campo correcto es assigned_rider_id (no rider_id)
      const riderId = order.assigned_rider_id as string | undefined;
      if (riderId && (newStatus === "buscando_domiciliario" || newStatus === "en_camino")) {
        const { data: riderSubs } = await supabase
          .from("push_subscriptions")
          .select("endpoint, p256dh, auth")
          .eq("user_id", riderId);

        if (riderSubs?.length) {
          await sendPush(
            riderSubs,
            JSON.stringify({
              title: "🛵 Pedido disponible - DeliciasExpress",
              body:  `Pedido #${shortId} listo para entrega`,
              icon:  "/icon-192.png",
              badge: "/badge-72.png",
              tag:   `rider-order-${orderId}`,
              data:  { url: "/domiciliario.html", orderId },
            })
          );
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[push-fn] Error:", message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }
});
