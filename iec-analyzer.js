// ═══════════════════════════════════════════════════════
// IEC-ANALYZER.JS — Logique partagée d'analyse de facture IEC
// Utilisé par index.html (Coûts & Marges) ET prospection.html (Netanya)
// Contient : gestion clé API, appel Claude, parsing JSON, historique partagé
// ═══════════════════════════════════════════════════════

const LS_KEY = 'shemesh_anthropic_key';
const LS_SETTINGS = 'shemesh_settings';
const HISTORY_KEY = 'shemesh_iec_history';

const OLD_MODELS = {'claude-sonnet-4-6':'claude-sonnet-5','claude-opus-4-6':'claude-opus-5'};

// ─── CLÉ API & MODÈLE ───
function getApiKey(){
  return (localStorage.getItem(LS_KEY)||'').trim();
}

function saveApiKeyRaw(val){
  localStorage.setItem(LS_KEY, val);
}

function getModel(){
  try{
    const s=JSON.parse(localStorage.getItem(LS_SETTINGS)||'{}');
    const m=s.model||'claude-sonnet-5';
    return OLD_MODELS[m]||m;
  }catch(e){return 'claude-sonnet-5';}
}

// ─── SPÉCIFICATIONS PANNEAUX (réglées dans Coûts & Marges, utilisées par Prospection) ───
const PANEL_WATT_DEFAULT = 400;
const PANEL_AREA_DEFAULT = 1.71;   // m² par panneau

function getPanelWatt(){
  try{
    const s=JSON.parse(localStorage.getItem(LS_SETTINGS)||'{}');
    const v=parseFloat(s.watt);
    return (v && v>0) ? v : PANEL_WATT_DEFAULT;
  }catch(e){ return PANEL_WATT_DEFAULT; }
}

function getPanelArea(){
  try{
    const s=JSON.parse(localStorage.getItem(LS_SETTINGS)||'{}');
    const v=parseFloat(s.surfpan);
    return (v && v>0) ? v : PANEL_AREA_DEFAULT;
  }catch(e){ return PANEL_AREA_DEFAULT; }
}

// Les réglages diffèrent-ils des valeurs d'origine des estimations ?
function panelSpecsChanged(){
  return getPanelWatt()!==PANEL_WATT_DEFAULT || getPanelArea()!==PANEL_AREA_DEFAULT;
}

// ─── PROMPT SYSTÈME PARTAGÉ ───
const IEC_SYSTEM_PROMPT = `Tu es un expert en installation solaire pour Shemesh Energy (Netanya, Israël).
Analyse cette facture IEC (חברת החשמל לישראל) et retourne UNIQUEMENT un JSON valide, sans aucun texte avant ou après, sans backticks.

Le JSON doit avoir exactement cette structure :
{
  "client": "Nom du client",
  "adresse": "Adresse",
  "telephone": "",
  "email": "",
  "numero_client": "",
  "numero_compteur": "",
  "consomation_annuelle_kwh": 30000,
  "consomation_mensuelle_kwh": 2500,
  "montant_facture": "6 125 ₪",
  "periode_jours": 59,
  "connexion_kva": "17.32 KVA",
  "amperage": "3×25A",
  "phase": "triphasé",
  "tarif": "Marom",
  "pack_recommande_kwc": 20,
  "pack_nom": "Gold 20 kWc",
  "pack_prix_ttc": 79900,
  "production_annuelle_kwh": 35000,
  "economie_annuelle_nis": 14350,
  "roi_ans": 5.6,
  "score_lead": 88,
  "justification": "Consommation très élevée, connexion triphasée, tarif Marom",
  "whatsapp_hebrew": "שלום [שם], ראינו את החשבון שלכם..."
}

Packs disponibles : 5 kWc (18 900₪), 10 kWc (35 900₪), 15 kWc (54 900₪), 20 kWc (79 900₪), 25 kWc (99 900₪), 30 kWc (119 900₪).
Irradiation Netanya : 1 750 kWh/kWc/an. TVA israélienne : 17%.
Choisir le pack qui offre le meilleur ROI sans sur-dimensionner (max 85% autoconsommation).
Le message WhatsApp doit être en hébreu, personnel, percutant, mentionner le montant de la facture et les économies estimées.
Pour "telephone", "email", "numero_client", "numero_compteur" : recopie la valeur exactement si elle figure sur la facture, sinon laisse une chaîne vide "". N'invente jamais ces informations.
Pour "adresse" : recopie l'adresse de fourniture telle qu'écrite sur la facture (rue et numéro).`;

const IEC_LOADER_STEPS = [
  'Lecture de la facture…',
  'Extraction des données de consommation…',
  'Identification du type de connexion…',
  'Calcul du pack optimal…',
  'Génération du message WhatsApp…',
  'Finalisation du rapport…'
];

// ─── APPEL API + PARSING (cœur partagé) ───
// base64: contenu du fichier en base64 (sans le préfixe data:...)
// mimeType: ex 'image/jpeg' ou 'application/pdf'
// Retourne l'objet résultat parsé, ou lève une Error (avec .status si dispo)
async function analyserFactureIEC(base64, mimeType){
  const cleanKey = getApiKey();
  if(!cleanKey){
    const e = new Error('Clé API non configurée');
    e.code = 'NO_API_KEY';
    throw e;
  }

  const isImage = mimeType.startsWith('image/');
  const contentBlock = isImage
    ? {type:'image', source:{type:'base64', media_type:mimeType, data:base64}}
    : {type:'document', source:{type:'base64', media_type:'application/pdf', data:base64}};

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'x-api-key': cleanKey,
      'anthropic-version':'2023-06-01',
      'anthropic-dangerous-direct-browser-access':'true'
    },
    body: JSON.stringify({
      model: getModel(),
      max_tokens: 4096,
      system: IEC_SYSTEM_PROMPT,
      messages:[{
        role:'user',
        content:[
          contentBlock,
          {type:'text', text:'Analyse cette facture IEC et retourne le JSON demandé.'}
        ]
      }]
    })
  });

  if(!response.ok){
    const err = await response.json().catch(()=>({}));
    const e = new Error(err.error?.message || ('Erreur '+response.status));
    e.status = response.status;
    throw e;
  }

  const data = await response.json();
  const rawText = data.content.filter(b=>b.type==='text').map(b=>b.text).join('');

  let cleaned = rawText.replace(/```json|```/g,'').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if(firstBrace!==-1 && lastBrace!==-1 && lastBrace>firstBrace){
    cleaned = cleaned.substring(firstBrace, lastBrace+1);
  }

  let result;
  try{
    result = JSON.parse(cleaned);
  }catch(e2){
    console.error('JSON parse error:', e2, '\nRaw text:', rawText);
    throw new Error('Format de réponse invalide — réessaye (voir console pour détails)');
  }
  return result;
}

// ─── HISTORIQUE PARTAGÉ (localStorage commun aux deux pages) ───
// Chaque entrée peut porter un maisonId pour la relier à une fiche de prospection.
function loadHistory(){
  try{ return JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]'); }
  catch(e){ return []; }
}

function saveHistoryArr(arr){
  try{ localStorage.setItem(HISTORY_KEY, JSON.stringify(arr)); }catch(e){}
}

function addToHistory(result, filename, maisonId){
  const arr = loadHistory();
  const entry = {
    id: Date.now().toString(36)+Math.random().toString(36).slice(2,7),
    date: new Date().toISOString(),
    filename: filename||'',
    maisonId: maisonId||null,
    result: result
  };
  arr.unshift(entry);
  if(arr.length>200) arr.length=200;
  saveHistoryArr(arr);
  return entry;
}

function deleteHistoryItem(id){
  const arr = loadHistory().filter(i=>i.id!==id);
  saveHistoryArr(arr);
}

// Retrouve la dernière analyse réelle liée à une maison (par son identifiant gush_helka ou adresse)
function getHistoryForMaison(maisonId){
  return loadHistory().find(i=>i.maisonId===maisonId) || null;
}

function formatHistDate(iso){
  try{
    const d=new Date(iso);
    return d.toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'})+' à '+d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
  }catch(e){ return iso; }
}

function escHtmlIEC(s){
  return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ═══════════════════════════════════════════════════════
// FICHES CLIENTS — dédoublonnées par adresse
// Une même adresse = un seul client, mis à jour à chaque nouvelle facture
// ═══════════════════════════════════════════════════════
const CLIENTS_KEY='shemesh_clients';

// Normalise une adresse pour la comparaison : minuscules, sans ponctuation,
// sans préfixe de rue (רח' / rehov / rue), espaces réduits
function normalizeAddr(a){
  if(!a) return '';
  return String(a)
    .replace(/["'`׳״]/g,'')
    .replace(/\b(רח|רחוב|rehov|rue|street|st)\b\.?/gi,'')
    .replace(/[.,\-–—/\\]/g,' ')
    .replace(/\s+/g,' ')
    .trim()
    .toLowerCase();
}

// Deux adresses désignent-elles le même logement ?
function sameAddress(a,b){
  const na=normalizeAddr(a), nb=normalizeAddr(b);
  if(!na||!nb) return false;
  return na===nb;
}

function loadClients(){
  try{ return JSON.parse(localStorage.getItem(CLIENTS_KEY)||'[]'); }
  catch(e){ return []; }
}

function saveClients(arr){
  try{ localStorage.setItem(CLIENTS_KEY, JSON.stringify(arr)); }catch(e){}
}

function findClientByAddress(adresse){
  return loadClients().find(c=>sameAddress(c.adresse, adresse)) || null;
}

function getClientById(id){
  return loadClients().find(c=>c.id===id) || null;
}

// Crée le client si l'adresse est nouvelle, sinon met à jour l'existant.
// Les champs saisis à la main (téléphone, email, notes) ne sont jamais écrasés
// par une valeur vide venant d'une nouvelle facture.
function upsertClientFromResult(result, extra){
  extra = extra || {};
  const adresse = extra.adresse || result.adresse || '';
  const arr = loadClients();
  const idx = arr.findIndex(c=>sameAddress(c.adresse, adresse));
  const now = new Date().toISOString();

  const fromBill = {
    nom: result.client||'',
    adresse: adresse,
    telephone: result.telephone||'',
    email: result.email||'',
    numero_client: result.numero_client||'',
    numero_compteur: result.numero_compteur||''
  };

  if(idx === -1){
    const client = Object.assign({
      id: Date.now().toString(36)+Math.random().toString(36).slice(2,7),
      cree_le: now,
      maj_le: now,
      notes: '',
      maisonId: extra.maisonId||null,
      derniereAnalyse: result
    }, fromBill, extra.champs||{});
    arr.unshift(client);
    saveClients(arr);
    return {client, cree:true};
  }

  const existant = arr[idx];
  // on ne remplace un champ que si la nouvelle valeur est renseignée
  Object.keys(fromBill).forEach(k=>{
    if(fromBill[k]) existant[k]=fromBill[k];
  });
  Object.assign(existant, extra.champs||{});
  if(extra.maisonId) existant.maisonId = extra.maisonId;
  existant.derniereAnalyse = result;
  existant.maj_le = now;
  arr[idx]=existant;
  saveClients(arr);
  return {client: existant, cree:false};
}

function updateClientFields(id, champs){
  const arr=loadClients();
  const idx=arr.findIndex(c=>c.id===id);
  if(idx===-1) return null;
  Object.assign(arr[idx], champs, {maj_le:new Date().toISOString()});
  saveClients(arr);
  return arr[idx];
}

function deleteClient(id){
  saveClients(loadClients().filter(c=>c.id!==id));
}

