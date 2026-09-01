// ═══════════════════════════════════════════════════════
// FINANCEMENT.JS — Module de financement solaire Shemesh
// Partagé par index.html (Coûts & Marges) et prospection.html (fiches clients)
// Aucune valeur en dur : tout vient des paramètres ou des arguments.
// ═══════════════════════════════════════════════════════

const FIN_SETTINGS_KEY = 'shemesh_settings';      // mutualisé avec le reste de l'app
const FIN_SIMS_KEY     = 'shemesh_fin_simulations';

// ─── Valeurs par défaut (surchargeables dans Paramètres → Tarifs) ───
const FIN_DEFAULTS = {
  taux_banque:      6.37,     // % annuel variable
  marge_prime:      1.2,      // Prime + x %
  tarif_cl_bas:     0.48,     // ₪/kWh — classique 0-15 kW
  tarif_haut:       0.3731,   // ₪/kWh — au-delà de 15 kW (les deux offres)
  tarif_acc_bas:    0.60,     // ₪/kWh — accélérée 0-15 kW
  seuil_kw:         15,       // kW — limite de tranche
  duree_min:        6,        // ans
  duree_max:        20,       // ans
  duree_defaut:     6,        // ans

  // ─── Valeur du kWh AUTOCONSOMMÉ (économie sur facture réseau) ───
  // ATTENTION : grandeur distincte du tarif de rachat ci-dessus.
  // Sert aux estimations de prospection (économie évitée), PAS au revenu de vente IEC.
  autoconso_kwh:    0.65,     // ₪/kWh économisé sur la facture
  cout_kwc:         4500,     // ₪/kWc — coût indicatif d'installation (estimations prospection)

  // ─── Repli simulation libre (aucun pack ni client sélectionné) ───
  demo_kwc:         20,       // kWc
  demo_prix:        90000     // ₪ TTC
};

// ─── Production annuelle par orientation (kWh/kWc/an) ───
const FIN_EXPO = {
  sud:   {rendement:1750, label:'Sud (1 750 kWh/kWc/an)'},
  est:   {rendement:1550, label:'Est (1 550 kWh/kWc/an)'},
  ouest: {rendement:1550, label:'Ouest (1 550 kWh/kWc/an)'},
  nord:  {rendement:1150, label:'Nord (1 150 kWh/kWc/an)'},
  defaut:{rendement:1500, label:'Non précisée (1 500 kWh/kWc/an)'}
};

function finSettings(){
  let s = {};
  try { s = JSON.parse(localStorage.getItem(FIN_SETTINGS_KEY) || '{}'); } catch(e) { s = {}; }
  const out = {};
  Object.keys(FIN_DEFAULTS).forEach(k => {
    const v = parseFloat(s['fin_' + k]);
    out[k] = (isFinite(v) && v > 0) ? v : FIN_DEFAULTS[k];
  });
  return out;
}

// ═══════════════════════════════════════════════════════
// CALCULS
// ═══════════════════════════════════════════════════════

// Tarif moyen pondéré par tranches de puissance.
// Ex. 20 kW classique : (15×0,48 + 5×0,3731) / 20 = 0,4533 ₪/kWh
function tarifPondere(kwc, tarifBas, tarifHaut, seuil){
  if(!kwc || kwc <= 0) return 0;
  const bas  = Math.min(kwc, seuil);
  const haut = Math.max(0, kwc - seuil);
  return (bas * tarifBas + haut * tarifHaut) / kwc;
}

function tarifClassique(kwc, st){
  st = st || finSettings();
  return tarifPondere(kwc, st.tarif_cl_bas, st.tarif_haut, st.seuil_kw);
}

function tarifAccelere(kwc, st){
  st = st || finSettings();
  return tarifPondere(kwc, st.tarif_acc_bas, st.tarif_haut, st.seuil_kw);
}

// ═══════════════════════════════════════════════════════
// API COMMUNE — source de vérité unique
// ROI, Financement et fiche client appellent CES fonctions, pas d'autres.
// ═══════════════════════════════════════════════════════

// ─── 1. TARIF DE RACHAT SOLAIRE (₪/kWh) ───
// Vente de l'électricité injectée au réseau. Pondéré par tranches de puissance.
// offre : 'classique' | 'acceleree'
function getSolarTariff(kwc, offre){
  const st = finSettings();
  return (offre === 'acceleree')
    ? tarifPondere(kwc, st.tarif_acc_bas, st.tarif_haut, st.seuil_kw)
    : tarifPondere(kwc, st.tarif_cl_bas,  st.tarif_haut, st.seuil_kw);
}

// ─── 1bis. VALEUR DU kWh AUTOCONSOMMÉ (₪/kWh) ───
// Économie réalisée sur la facture réseau. GRANDEUR DISTINCTE du tarif de rachat :
// ne jamais additionner ni substituer l'une à l'autre dans une même formule.
function getSelfConsumptionValue(){
  return finSettings().autoconso_kwh;
}

// ─── 2. PRODUCTION ANNUELLE (kWh/an) ───
// Priorité absolue à une production réelle ou déjà estimée ailleurs.
// Sinon estimation depuis puissance + orientation.
function getSolarProduction(opts){
  opts = opts || {};
  const reelle = parseFloat(opts.production);
  if(isFinite(reelle) && reelle > 0) return reelle;      // valeur existante : on la garde
  const kwc = parseFloat(opts.kwc) || 0;
  const key = String(opts.orientation || 'defaut').toLowerCase();
  const expo = FIN_EXPO[key] || FIN_EXPO.defaut;
  return Math.round(kwc * expo.rendement);
}

// ─── 3. REVENU SOLAIRE ANNUEL (₪/an) ───
// Revenu de VENTE au réseau. Pour une économie d'autoconsommation,
// utiliser getSelfConsumptionValue() et non cette fonction.
function getAnnualSolarRevenue(opts){
  opts = opts || {};
  const kwc  = parseFloat(opts.kwc) || 0;
  const prod = getSolarProduction(opts);
  return prod * getSolarTariff(kwc, opts.offre);
}

// ─── 4. MENSUALITÉ DE PRÊT (₪/mois) ───
function getLoanPayment(capital, tauxAnnuel, annees){
  const st = finSettings();
  const taux = (tauxAnnuel !== undefined && tauxAnnuel !== null && tauxAnnuel !== '')
                 ? parseFloat(tauxAnnuel) : st.taux_banque;
  const dur  = (annees !== undefined && annees !== null && annees !== '')
                 ? parseFloat(annees) : st.duree_defaut;
  return mensualitePret(capital, taux, dur);
}

// ─── 5. CASH-FLOW MENSUEL (₪/mois) ───
function getSolarCashFlow(opts){
  opts = opts || {};
  const revenuMois = getAnnualSolarRevenue(opts) / 12;
  const mens = getLoanPayment(parseFloat(opts.prix) || 0, opts.taux, opts.duree);
  return revenuMois - mens;
}

// Prêt amortissable à mensualités constantes : P × r / (1 − (1+r)^−n)
function mensualitePret(capital, tauxAnnuel, annees){
  if(!capital || capital <= 0 || !annees || annees <= 0) return 0;
  const r = (tauxAnnuel / 100) / 12;
  const n = Math.round(annees * 12);
  if(r === 0) return capital / n;
  return capital * r / (1 - Math.pow(1 + r, -n));
}

// Simulation complète pour une offre donnée ('classique' | 'acceleree')
function simulerFinancement(params){
  const st = finSettings();
  const kwc     = parseFloat(params.kwc) || 0;
  const prix    = parseFloat(params.prix) || 0;
  const prod    = parseFloat(params.production) || 0;
  const annees  = parseFloat(params.duree) || st.duree_defaut;
  const taux    = (params.taux !== undefined && params.taux !== null && params.taux !== '')
                    ? parseFloat(params.taux) : st.taux_banque;
  const offre   = params.offre === 'acceleree' ? 'acceleree' : 'classique';

  const tarif   = getSolarTariff(kwc, offre);
  const revenuAn   = prod * tarif;
  const revenuMois = revenuAn / 12;

  const mensualite = getLoanPayment(prix, taux, annees);
  const nbMois     = Math.round(annees * 12);
  const totalPaye  = mensualite * nbMois;
  const interets   = totalPaye - prix;
  const cashflow   = revenuMois - mensualite;

  return {
    kwc, prix, production: prod, duree: annees, taux, offre,
    tarif,                       // ₪/kWh
    tarif_ag: tarif * 100,       // agorot/kWh
    revenu_annuel: revenuAn,
    revenu_mensuel: revenuMois,
    mensualite, nb_mois: nbMois,
    total_paye: totalPaye,
    interets,
    cashflow
  };
}

// Les deux offres d'un coup, pour le tableau comparatif
function simulerLesDeux(params){
  return {
    classique: simulerFinancement(Object.assign({}, params, {offre:'classique'})),
    acceleree: simulerFinancement(Object.assign({}, params, {offre:'acceleree'}))
  };
}

// ═══════════════════════════════════════════════════════
// FORMATAGE
// ═══════════════════════════════════════════════════════
function finNum(n){
  return Math.round(n || 0).toLocaleString('fr-FR').replace(/\u202f/g,' ');
}
function finShekel(n){
  return finNum(n) + ' ₪';
}

// Puissance : on conserve la précision de la source (23,3 kWc reste 23,3).
// Pas d'arrondi — la valeur affichée doit être celle utilisée dans les calculs.
function finKwc(n){
  const v = parseFloat(n) || 0;
  const s = (Math.round(v * 10) / 10).toFixed(1);        // une décimale
  return s.replace(/\.0$/, '').replace('.', ',');        // 20,0 -> 20 ; 23,3 -> 23,3
}
function finSigned(n){
  const v = Math.round(n || 0);
  return (v > 0 ? '+' : '') + v.toLocaleString('fr-FR').replace(/\u202f/g,' ') + ' ₪';
}

// ═══════════════════════════════════════════════════════
// SIMULATIONS ENREGISTRÉES (rattachées à un client)
// ═══════════════════════════════════════════════════════
function loadSimulations(){
  try { return JSON.parse(localStorage.getItem(FIN_SIMS_KEY) || '[]'); }
  catch(e){ return []; }
}

function saveSimulations(arr){
  try { localStorage.setItem(FIN_SIMS_KEY, JSON.stringify(arr)); } catch(e){}
}

// Une simulation par client : on remplace la précédente au lieu d'empiler
function enregistrerSimulation(clientId, sim){
  if(!clientId) return null;
  const arr = loadSimulations();
  const entry = {
    clientId: clientId,
    date: new Date().toISOString(),
    kwc: sim.kwc, prix: sim.prix, production: sim.production,
    offre: sim.offre, duree: sim.duree, taux: sim.taux,
    mensualite: Math.round(sim.mensualite),
    revenu_mensuel: Math.round(sim.revenu_mensuel),
    cashflow: Math.round(sim.cashflow)
  };
  const i = arr.findIndex(s => s.clientId === clientId);
  if(i === -1) arr.unshift(entry); else arr[i] = entry;
  saveSimulations(arr);
  return entry;
}

function simulationDuClient(clientId){
  if(!clientId) return null;
  return loadSimulations().find(s => s.clientId === clientId) || null;
}

function supprimerSimulation(clientId){
  saveSimulations(loadSimulations().filter(s => s.clientId !== clientId));
}

// Un prospect devient client : la simulation faite depuis la maison le suit.
// La clé passe de l'identifiant maison à l'identifiant client.
function migrerSimulation(ancienId, nouvelId){
  if(!ancienId || !nouvelId || ancienId === nouvelId) return null;
  const arr = loadSimulations();
  const i = arr.findIndex(s => s.clientId === ancienId);
  if(i === -1) return null;
  // ne pas écraser une simulation déjà rattachée au client
  if(arr.some(s => s.clientId === nouvelId)){
    arr.splice(i, 1);
    saveSimulations(arr);
    return null;
  }
  arr[i].clientId = nouvelId;
  saveSimulations(arr);
  return arr[i];
}

// ═══════════════════════════════════════════════════════
// RENDU HTML DU MODULE
// finRenderModule(hostId, params, options)
//   hostId  : id du conteneur
//   params  : {kwc, prix, production, duree, taux, offre, orientation, pack_nom, clientId}
//   options : {compact:bool, editable:bool, onSave:function|null}
// ═══════════════════════════════════════════════════════

const FIN_STATE = {};   // état par conteneur

function finRenderModule(hostId, params, options){
  options = options || {};
  const host = document.getElementById(hostId);
  if(!host) return;
  const st = finSettings();

  // Les clés à undefined ne doivent PAS écraser les valeurs par défaut
  // (les appelants passent souvent duree/offre/taux à undefined).
  const clean = {};
  Object.keys(params || {}).forEach(k => {
    if(params[k] !== undefined && params[k] !== null && params[k] !== '') clean[k] = params[k];
  });

  // Repli si le module est appelé sans données (simulation totalement libre).
  // Dès qu'un pack, un client ou une maison est fourni, ces valeurs sont écrasées.
  FIN_STATE[hostId] = Object.assign({
    kwc: FIN_DEFAULTS.demo_kwc,
    prix: FIN_DEFAULTS.demo_prix,
    production: getSolarProduction({kwc: FIN_DEFAULTS.demo_kwc, orientation:'sud'}),
    duree: st.duree_defaut, taux: st.taux_banque,
    offre: 'classique', orientation: '', pack_nom: '', clientId: null,
    editable: !!options.editable, compact: !!options.compact,
    onSave: options.onSave || null
  }, clean);

  finPaint(hostId);
}

function finPaint(hostId){
  const s = FIN_STATE[hostId];
  if(!s) return;
  const host = document.getElementById(hostId);
  if(!host) return;
  const st = finSettings();
  const both = simulerLesDeux(s);
  const sim  = s.offre === 'acceleree' ? both.acceleree : both.classique;
  const cfCls = sim.cashflow >= 0 ? 'fin-pos' : 'fin-neg';

  const sousTitre = [
    finNum(s.production) + ' kWh/an',
    s.orientation || '',
    s.pack_nom || ''
  ].filter(Boolean).join(' · ');

  const champs = s.editable ? `
    <div class="fin-inputs">
      <label>Puissance (kWc)
        <input type="number" step="0.1" min="1" value="${s.kwc}"
          oninput="finSet('${hostId}','kwc',this.value)">
      </label>
      <label>Prix TTC (₪)
        <input type="number" step="100" min="0" value="${s.prix}"
          oninput="finSet('${hostId}','prix',this.value)">
      </label>
      <label>Production (kWh/an)
        <input type="number" step="100" min="0" value="${s.production}"
          oninput="finSet('${hostId}','production',this.value)">
      </label>
      <label>Taux bancaire (%)
        <input type="number" step="0.01" min="0" value="${s.taux}"
          oninput="finSet('${hostId}','taux',this.value)">
      </label>
    </div>` : '';

  host.innerHTML = `
  <div class="fin-wrap">

    <div class="fin-head">
      <div>
        <div class="fin-title">${finKwc(s.kwc)} kWc — ${finShekel(s.prix)}</div>
        ${sousTitre ? `<div class="fin-sub">${sousTitre}</div>` : ''}
      </div>
      <div class="fin-bank">
        <span class="fin-bank-name">Bank Hapoalim</span>
        <span class="fin-bank-rate">${String(s.taux).replace('.',',')} %</span>
        <span class="fin-bank-formula">Prime + ${String(st.marge_prime).replace('.',',')} %</span>
      </div>
    </div>

    ${champs}

    <div class="fin-switch">
      <button class="fin-sw ${s.offre==='classique'?'on':''}"
        onclick="finSet('${hostId}','offre','classique')">Offre classique</button>
      <button class="fin-sw ${s.offre==='acceleree'?'on':''}"
        onclick="finSet('${hostId}','offre','acceleree')">Offre accélérée</button>
    </div>

    <div class="fin-cards">
      <div class="fin-card">
        <div class="fin-card-lbl">Tarif solaire moyen</div>
        <div class="fin-card-val">${sim.tarif_ag.toFixed(2).replace('.',',')}<small> ag/kWh</small></div>
        <div class="fin-card-note">${finKwc(Math.min(s.kwc,st.seuil_kw))} kW à ${String(s.offre==='acceleree'?st.tarif_acc_bas:st.tarif_cl_bas).replace('.',',')} ₪${s.kwc>st.seuil_kw?` · ${finKwc(s.kwc-st.seuil_kw)} kW à ${String(st.tarif_haut).replace('.',',')} ₪`:''}</div>
      </div>
      <div class="fin-card">
        <div class="fin-card-lbl">Revenu solaire</div>
        <div class="fin-card-val">${finNum(sim.revenu_mensuel)}<small> ₪/mois</small></div>
        <div class="fin-card-note">${finShekel(sim.revenu_annuel)} par an</div>
      </div>
    </div>

    <div class="fin-loan">
      <div class="fin-loan-head">
        <span>Durée du financement</span>
        <span class="fin-loan-years">${s.duree} ans</span>
      </div>
      <input type="range" class="fin-range" min="${st.duree_min}" max="${st.duree_max}" step="1"
        value="${s.duree}" oninput="finSet('${hostId}','duree',this.value)">
      <div class="fin-range-ends"><span>${st.duree_min} ans</span><span>${st.duree_max} ans</span></div>

      <div class="fin-grid">
        <div><span>Mensualité</span><strong>${finShekel(sim.mensualite)}</strong></div>
        <div><span>Intérêts totaux</span><strong>${finShekel(sim.interets)}</strong></div>
        <div><span>Total remboursé</span><strong>${finShekel(sim.total_paye)}</strong></div>
      </div>
    </div>

    <div class="fin-cash ${cfCls}">
      <div class="fin-cash-lbl">Cash-flow mensuel</div>
      <div class="fin-cash-val">${finSigned(sim.cashflow)}<small> /mois</small></div>
      <div class="fin-cash-note">${finNum(sim.revenu_mensuel)} ₪ de revenu − ${finNum(sim.mensualite)} ₪ de mensualité</div>
    </div>

    <table class="fin-table">
      <thead><tr>
        <th>Offre</th><th>Tarif moyen</th><th>Revenu annuel</th><th>Revenu mensuel</th><th>Cash-flow</th>
      </tr></thead>
      <tbody>
        <tr class="${s.offre==='classique'?'sel':''}">
          <td>Classique</td>
          <td>${both.classique.tarif_ag.toFixed(2).replace('.',',')} ag</td>
          <td>${finShekel(both.classique.revenu_annuel)}</td>
          <td>${finShekel(both.classique.revenu_mensuel)}</td>
          <td class="${both.classique.cashflow>=0?'fin-pos-t':'fin-neg-t'}">${finSigned(both.classique.cashflow)}</td>
        </tr>
        <tr class="${s.offre==='acceleree'?'sel':''}">
          <td>Accélérée</td>
          <td>${both.acceleree.tarif_ag.toFixed(2).replace('.',',')} ag</td>
          <td>${finShekel(both.acceleree.revenu_annuel)}</td>
          <td>${finShekel(both.acceleree.revenu_mensuel)}</td>
          <td class="${both.acceleree.cashflow>=0?'fin-pos-t':'fin-neg-t'}">${finSigned(both.acceleree.cashflow)}</td>
        </tr>
      </tbody>
    </table>

    ${s.clientId ? `<button class="fin-save" onclick="finSave('${hostId}')">💾 Enregistrer la simulation</button>
      <div class="fin-saved" id="${hostId}-saved"></div>` : ''}
  </div>`;
}

function finSet(hostId, key, val){
  const s = FIN_STATE[hostId];
  if(!s) return;
  if(key === 'offre') s.offre = val;
  else {
    const v = parseFloat(val);
    s[key] = isFinite(v) ? v : 0;
  }
  finPaint(hostId);
}

function finSave(hostId){
  const s = FIN_STATE[hostId];
  if(!s || !s.clientId) return;
  const sim = simulerFinancement(s);
  enregistrerSimulation(s.clientId, sim);
  const el = document.getElementById(hostId + '-saved');
  if(el){
    el.textContent = '✓ Simulation enregistrée dans la fiche client';
    setTimeout(()=>{ el.textContent=''; }, 3000);
  }
  if(typeof s.onSave === 'function') s.onSave(sim);
}
