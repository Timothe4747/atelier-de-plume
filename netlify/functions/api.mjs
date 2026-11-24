// L'Atelier de Plume — API des comptes et des histoires (Netlify Functions + Netlify Blobs)
import { getStore } from "@netlify/blobs";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

export const config = { path: "/api/*" };

const SESSION_DAYS = 30;          // une connexion reste valable 30 jours au maximum
const MAX_BODY = 5.5 * 1024 * 1024; // limite d'une requête Netlify : 6 Mo
const MAX_DATA = 40 * 1024 * 1024;  // place maximale par compte

const users = () => getStore({ name: "atelier-users", consistency: "strong" });
const sessions = () => getStore({ name: "atelier-sessions", consistency: "strong" });
const datas = () => getStore({ name: "atelier-data", consistency: "strong" });

const norm = (n) => String(n || "").normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const fail = (code, error, status = 400) => json({ code, error }, status);
const hash = (pw, salt) => scryptSync(String(pw), salt, 32).toString("hex");
function checkPw(pw, u) {
  const a = Buffer.from(hash(pw, u.salt), "hex"), b = Buffer.from(u.hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
const pub = (u) => ({ id: u.id, name: u.name, color: u.color });
const env = (k) => (globalThis.Netlify?.env?.get?.(k)) ?? process.env[k];

async function newSession(u) {
  const tok = randomBytes(32).toString("hex");
  await sessions().setJSON(tok, { id: u.id, gen: u.gen || 0, exp: Date.now() + SESSION_DAYS * 864e5 });
  return tok;
}
async function userById(id) {
  const ref = await users().get("id/" + id, { type: "json" });
  if (!ref) return null;
  const u = await users().get("u/" + ref.norm, { type: "json" });
  return u && u.id === id ? u : null;
}
async function auth(req) {
  const m = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.get("authorization") || "");
  if (!m) return null;
  const s = await sessions().get(m[1], { type: "json" });
  if (!s || s.exp < Date.now()) return null;
  const u = await userById(s.id);
  if (!u || (u.gen || 0) !== s.gen) return null;
  return { tok: m[1], u };
}
async function readData(id) {
  return (await datas().get(id, { type: "json" })) || { rev: 0, data: {} };
}
async function tooMany(key, limit, windowMs) {
  const st = users(), now = Date.now();
  const r = (await st.get(key, { type: "json" })) || { n: 0, t: now };
  if (now - r.t > windowMs) { r.n = 0; r.t = now; }
  r.n++;
  await st.setJSON(key, r);
  return r.n > limit;
}
const validName = (n) => typeof n === "string" && n.trim().length >= 1 && n.trim().length <= 30;
const validPw = (p) => typeof p === "string" && p.length >= 4 && p.length <= 200;
const validColor = (c) => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c);
const validKey = (k) => /^[A-Za-z0-9_]{1,40}$/.test(k);

export default async (req, context) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const method = req.method;
  let body = {};
  if (method === "POST" || method === "PUT") {
    const len = +(req.headers.get("content-length") || 0);
    if (len > MAX_BODY) return fail("toobig", "Trop de données d'un coup.", 413);
    const txt = await req.text();
    if (txt.length > MAX_BODY) return fail("toobig", "Trop de données d'un coup.", 413);
    try { body = txt ? JSON.parse(txt) : {}; } catch { return fail("badjson", "Requête illisible."); }
  }
  const ip = context?.ip || req.headers.get("x-nf-client-connection-ip") || "inconnu";

  try {
    if (route === "ping") return json({ ok: true, app: "atelier-de-plume" });

    /* ---- créer un compte ---- */
    if (route === "register" && method === "POST") {
      const { name, password, color, data } = body;
      if (!validName(name)) return fail("badname", "Écris ton prénom (30 lettres maximum).");
      if (!validPw(password)) return fail("badpw", "Le mot de passe doit avoir au moins 4 caractères.");
      if (await tooMany("reg/" + ip, 20, 3600e3)) return fail("slow", "Trop de comptes créés d'ici. Réessaie plus tard.", 429);
      const n = norm(name), st = users();
      if (await st.get("u/" + n, { type: "json" })) return fail("exists", "Ce prénom a déjà un compte.", 409);
      const salt = randomBytes(16).toString("hex");
      const u = { id: "p" + randomBytes(9).toString("hex"), name: name.trim(), color: validColor(color) ? color : "#ff6b4a", salt, hash: hash(password, salt), gen: 0, created: Date.now() };
      const r = await st.setJSON("u/" + n, u, { onlyIfNew: true });
      if (r && r.modified === false) return fail("exists", "Ce prénom a déjà un compte.", 409);
      await st.setJSON("id/" + u.id, { norm: n });
      const d = { rev: 1, data: {} };
      if (data && typeof data === "object") for (const [k, v] of Object.entries(data)) if (validKey(k)) d.data[k] = v;
      await datas().setJSON(u.id, d);
      return json({ token: await newSession(u), me: pub(u), rev: d.rev, data: d.data });
    }

    /* ---- se connecter ---- */
    if (route === "login" && method === "POST") {
      const n = norm(body.name), st = users();
      const lock = (await st.get("fail/" + n, { type: "json" })) || { n: 0, until: 0 };
      if (lock.until > Date.now()) return fail("locked", "Trop d'essais. Attends un petit moment.", 429);
      const u = n && (await st.get("u/" + n, { type: "json" }));
      if (!u) {
        if (await tooMany("unk/" + ip, 60, 600e3)) return fail("locked", "Trop d'essais. Attends un petit moment.", 429);
        return fail("unknown", "Je ne connais pas ce prénom.", 404);
      }
      if (!checkPw(body.password, u)) {
        lock.n++; if (lock.n >= 5) { lock.n = 0; lock.until = Date.now() + 30e3; }
        await st.setJSON("fail/" + n, lock);
        return fail("badpw", "Ce n'est pas le bon mot de passe.", 401);
      }
      if (lock.n) await st.delete("fail/" + n);
      const d = await readData(u.id);
      return json({ token: await newSession(u), me: pub(u), rev: d.rev, data: d.data });
    }

    /* ---- mot de passe oublié : un adulte utilise le code du site ---- */
    if (route === "reset" && method === "POST") {
      const code = env("ADMIN_CODE");
      if (!code) return fail("nocode", "Le code adulte n'est pas encore réglé sur ce site.", 403);
      const lock = (await users().get("fail/__admin", { type: "json" })) || { n: 0, until: 0 };
      if (lock.until > Date.now()) return fail("locked", "Trop d'essais. Attends un petit moment.", 429);
      const a = Buffer.from(String(body.code || "")), b = Buffer.from(code);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        lock.n++; if (lock.n >= 5) { lock.n = 0; lock.until = Date.now() + 60e3; }
        await users().setJSON("fail/__admin", lock);
        return fail("badcode", "Ce code adulte n'est pas bon.", 401);
      }
      if (!validPw(body.password)) return fail("badpw", "Le mot de passe doit avoir au moins 4 caractères.");
      const n = norm(body.name), u = await users().get("u/" + n, { type: "json" });
      if (!u) return fail("unknown", "Je ne connais pas ce prénom.", 404);
      u.salt = randomBytes(16).toString("hex"); u.hash = hash(body.password, u.salt); u.gen = (u.gen || 0) + 1;
      await users().setJSON("u/" + n, u);
      await users().delete("fail/" + n);
      return json({ ok: true });
    }

    /* ---- tout le reste demande d'être connecté ---- */
    const A = await auth(req);
    if (!A) return fail("auth", "Tu n'es plus connecté.", 401);
    const { u } = A;

    if (route === "me" && method === "GET") return json({ me: pub(u) });

    if (route === "data" && method === "GET") {
      const d = await readData(u.id), since = +(url.searchParams.get("since") || -1);
      return json(d.rev > since ? { rev: d.rev, data: d.data } : { rev: d.rev });
    }
    if (route === "data" && method === "PUT") {
      const set = body.set;
      if (!set || typeof set !== "object") return fail("badjson", "Rien à enregistrer.");
      const d = await readData(u.id);
      for (const [k, v] of Object.entries(set)) {
        if (!validKey(k)) continue;
        if (v === null) delete d.data[k]; else d.data[k] = v;
      }
      if (JSON.stringify(d.data).length > MAX_DATA) return fail("full", "Ton espace est plein. Supprime quelques images de couverture.", 413);
      d.rev++;
      await datas().setJSON(u.id, d);
      return json({ rev: d.rev });
    }
    if (route === "password" && method === "POST") {
      if (!checkPw(body.old, u)) return fail("badpw", "L'ancien mot de passe n'est pas bon.", 401);
      if (!validPw(body.password)) return fail("badpw2", "Le mot de passe doit avoir au moins 4 caractères.");
      u.salt = randomBytes(16).toString("hex"); u.hash = hash(body.password, u.salt); u.gen = (u.gen || 0) + 1;
      await users().setJSON("u/" + norm(u.name), u);
      await sessions().delete(A.tok);
      return json({ ok: true, token: await newSession(u) });
    }
    if (route === "rename" && method === "POST") {
      if (!validName(body.name)) return fail("badname", "Prénom invalide.");
      const oldN = norm(u.name), n = norm(body.name), st = users();
      if (n !== oldN) {
        const r = await st.setJSON("u/" + n, { ...u, name: body.name.trim() }, { onlyIfNew: true });
        if (r && r.modified === false) return fail("exists", "Ce prénom a déjà un compte.", 409);
        await st.setJSON("id/" + u.id, { norm: n });
        await st.delete("u/" + oldN);
      } else await st.setJSON("u/" + n, { ...u, name: body.name.trim() });
      if (validColor(body.color)) { const v = await st.get("u/" + n, { type: "json" }); v.color = body.color; await st.setJSON("u/" + n, v); }
      return json({ me: pub({ ...u, name: body.name.trim() }) });
    }
    if (route === "logout" && method === "POST") { await sessions().delete(A.tok); return json({ ok: true }); }
    if (route === "delete" && method === "POST") {
      if (!checkPw(body.password, u)) return fail("badpw", "Ce n'est pas le bon mot de passe.", 401);
      await datas().delete(u.id);
      await users().delete("u/" + norm(u.name));
      await users().delete("id/" + u.id);
      await sessions().delete(A.tok);
      return json({ ok: true });
    }
    return fail("notfound", "Chemin inconnu.", 404);
  } catch (e) {
    console.error(e);
    return fail("server", "Le serveur a eu un souci. Réessaie dans un instant.", 500);
  }
};
