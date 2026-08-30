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

// ─── PROMPT SYSTÈME PARTAGÉ ───
const IEC_SYSTEM_PROMPT = `Tu es un expert en installation solaire pour Shemesh Energy (Netanya, Israël).
Analyse cette facture IEC (חברת החשמל לישראל) et retourne UNIQUEMENT un JSON valide, sans aucun texte avant ou après, sans backticks.

Le JSON doit avoir exactement cette structure :
{
  "client": "Nom du client",
  "adresse": "Adresse",
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
Le message WhatsApp doit être en hébreu, personnel, percutant, mentionner le montant de la facture et les économies estimées.`;

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
