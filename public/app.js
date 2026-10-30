// ========================================================
// STATE MANAGEMENT & CONFIG
// ========================================================
const state = {
  currentTab: 'dashboard',
  selectedInvestmentId: '',
  investments: [],
  analytics: null,
  records: [],
  movements: [],
  calendarEvents: [],
  ipcaRates: [],
  theme: localStorage.getItem('rendidiario_theme') || 'dark',
  privacyMode: localStorage.getItem('rendidiario_privacy') === 'true',
  pieMode: 'category',
  performanceRange: '30',
  walletRange: 'all',
  assetHistoryRange: 'all',
  selectedAssetId: null,
  assetDetailReturnTab: 'investments',
  assetDetailReturnScrollTop: 0,
  groupWalletByInstitution: localStorage.getItem('lastro_wallet_grouping') === 'institution',
  usdAmount: parseFloat(localStorage.getItem('lastro_usd_amount')) || 0,
  dollarRate: parseFloat(localStorage.getItem('lastro_dollar_rate')) || 5.70,
  dollarVariation: 0,
  includeUsdInPatrimony: localStorage.getItem('lastro_include_usd') === 'true',
  userName: localStorage.getItem('lastro_user_name') || '',
  parsedInterData: []
};

// Initialize Theme & Privacy
document.documentElement.setAttribute('data-theme', state.theme);
updateBrandLogo();
if (state.privacyMode) {
  document.body.classList.add('privacy-active');
}
updateThemeButtonUI();
updatePrivacyButtonUI();

// Palette for charts (sober, distinct tones)
const CHART_COLORS = [
  '#5b8def', '#78a0e8', '#96b3e8', '#b2c5e9',
  '#3e66a8', '#345282', '#7d96be', '#c4d0e4'
];

// ========================================================
// UTILITIES & FORMATTERS
// ========================================================
function formatCurrency(val) {
  if (val === null || val === undefined || isNaN(val)) return 'R$ 0,00';
  if (state.privacyMode) return 'R$ ••••••';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
}

function formatUSD(val) {
  if (val === null || val === undefined || isNaN(val)) return 'US$ 0,00';
  if (state.privacyMode) return 'US$ ••••••';
  return `US$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function setMoneyText(elementOrId, text) {
  const element = typeof elementOrId === 'string' ? document.getElementById(elementOrId) : elementOrId;
  if (!element) return;
  const html = escapeHtml(String(text)).replace(/,(\d{2})$/, ',<small class="currency-cents">$1</small>');
  if (element.innerHTML === html) return;
  element.innerHTML = html;
  element.classList.add('amount-value');
  if (typeof element.animate === 'function') {
    element.animate(
      [{ opacity: 0.65, transform: 'translateY(2px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: 180, easing: 'ease-out' }
    );
  }
}

function setMoneyValue(elementOrId, value, hasData = true) {
  setMoneyText(elementOrId, hasData ? formatCurrency(value || 0) : 'Sem dados ainda');
}

function setYieldValue(elementOrId, value, hasData = true) {
  const element = typeof elementOrId === 'string' ? document.getElementById(elementOrId) : elementOrId;
  if (!element) return;
  element.classList.toggle('yield-positive', hasData && Number(value) >= 0);
  element.classList.toggle('yield-negative', hasData && Number(value) < 0);
  setMoneyValue(element, value, hasData);
}

function updateDashboardDataVisibility(summary = state.analytics?.summary) {
  const hasRecords = Boolean(summary?.latest_date);
  const hasSnapshot = hasDashboardSnapshot(summary);
  const stats = document.getElementById('dashboardStats');
  const emptyState = document.getElementById('dashboardEmptyState');
  if (stats) stats.hidden = !hasRecords;
  if (emptyState) emptyState.hidden = hasSnapshot;
}
function formatRelativeDate(dateStr) {
  if (!dateStr) return 'Sem dados ainda';
  const date = new Date(`${dateStr}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.getTime() === today.getTime()) return 'hoje';
  if (date.getTime() === yesterday.getTime()) return 'ontem';
  return new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' }).format(date);
}

function formatPct(val) {
  if (val === null || val === undefined || isNaN(val)) return '0,00%';
  if (state.privacyMode) return '•••%';
  const sign = val > 0 ? '+' : '';
  return `${sign}${val.toFixed(2).replace('.', ',')}%`;
}

function formatDateBR(dateStr) {
  if (!dateStr) return '-';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

function getTodayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toastNotification');
  toast.textContent = message;
  toast.className = `toast toast-${type}`;
  toast.classList.remove('hidden');

  setTimeout(() => {
    toast.classList.add('hidden');
  }, 4000);
}

// ========================================================
// MODO PRIVACIDADE (OLHINHO PARA OCULTAR VALORES)
// ========================================================
function togglePrivacyMode() {
  state.privacyMode = !state.privacyMode;
  localStorage.setItem('rendidiario_privacy', state.privacyMode);

  if (state.privacyMode) {
    document.body.classList.add('privacy-active');
  } else {
    document.body.classList.remove('privacy-active');
  }

  updatePrivacyButtonUI();

  if (state.currentTab === 'dashboard') loadDashboardData();
  else if (state.currentTab === 'history') loadFullHistory();
  else if (state.currentTab === 'quick-entry') loadQuickEntryRows();
  else if (state.currentTab === 'investments') renderInvestmentsCards();
}

function updatePrivacyButtonUI() {
  const iconSpan = document.getElementById('privacyIcon');
  const textSpan = document.getElementById('privacyText');
  if (!iconSpan || !textSpan) return;

  if (state.privacyMode) {
    iconSpan.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
        <line x1="1" y1="1" x2="23" y2="23"></line>
      </svg>
    `;
    textSpan.textContent = 'Mostrar Valores';
  } else {
    iconSpan.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
        <circle cx="12" cy="12" r="3"></circle>
      </svg>
    `;
    textSpan.textContent = 'Ocultar Valores';
  }
}

// ========================================================
// NAVIGATION & TABS
// ========================================================
function switchTab(tabId, { skipLoad = false } = {}) {
  if (tabId !== 'investments' && state.selectedAssetId) {
    state.selectedAssetId = null;
    state.assetDetailReturnTab = 'investments';
    const walletList = document.getElementById('walletListView');
    const detailView = document.getElementById('assetDetailView');
    if (walletList) walletList.hidden = false;
    if (detailView) detailView.hidden = true;
  }
  state.currentTab = tabId;

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === `tab-${tabId}`);
  });

  const titles = {
    dashboard: ['Início', ''],
    'quick-entry': ['Registrar saldo', ''],
    'import-inter': ['Importar extrato', 'Leitura e importação de relatórios de investimentos'],
    history: ['Histórico de Saldos e Rendimentos', 'Extrato completo de lançamentos e variações diárias'],
    investments: ['Carteira', 'Seus investimentos em um só lugar'],
    backup: ['Backup e Configurações', 'Exporte ou importe seus dados com segurança']
  };

  titles.planning = ['Planejamento', ''];
  if (titles[tabId]) {
    document.getElementById('pageTitle').textContent = titles[tabId][0];
    document.getElementById('pageSubtitle').textContent = titles[tabId][1];
  }

  if (tabId === 'dashboard') {
    updateDashboardGreeting();
    loadDashboardGreeting();
  }
  if (tabId === 'backup') {
    const nameInput = document.getElementById('settingUserName');
    if (nameInput) nameInput.value = state.userName;
    loadRecoveryHistory();
  }

  if (tabId === 'dashboard') {
    loadDashboardData();
  } else if (tabId === 'quick-entry') {
    loadQuickEntryRows();
  } else if (tabId === 'history') {
    loadFullHistory();
  } else if (tabId === 'investments' && !skipLoad) {
    renderInvestmentsCards();
  } else if (tabId === 'planning') {
    loadCalendarEvents();
    renderScenario();
  }
}

// ========================================================
// API CALLS
// ========================================================
async function fetchInvestments() {
  try {
    const res = await fetch('/api/investments');
    state.investments = await res.json();
    populateInvestmentSelects();
    return state.investments;
  } catch (err) {
    console.error('Erro ao buscar ativos:', err);
    showToast('Erro ao carregar lista de ativos', 'error');
  }
}

async function fetchAnalytics(investmentId = '') {
  try {
    const url = investmentId ? `/api/analytics?investment_id=${investmentId}` : '/api/analytics';
    const res = await fetch(url);
    state.analytics = await res.json();
    return state.analytics;
  } catch (err) {
    console.error('Erro ao buscar analytics:', err);
  }
}

function hasDashboardSnapshot(summary = state.analytics?.summary) {
  return Boolean(summary?.latest_date)
    || (state.includeUsdInPatrimony && Number(state.usdAmount) > 0);
}

// ========================================================
// COTAÇÃO DO DÓLAR (USD / BRL) EM TEMPO REAL
// ========================================================
async function fetchDollarRate() {
  const rateDisplay = document.getElementById('dollarRateDisplay');
  const varBadge = document.getElementById('dollarVariationBadge');
  const lastUpdate = document.getElementById('dollarLastUpdate');

  try {
    // Timeout de 3 segundos para não travar a tela se a internet estiver lenta
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const res = await fetch('https://economia.awesomeapi.com.br/last/USD-BRL', { signal: controller.signal });
    clearTimeout(timeoutId);

    const data = await res.json();

    if (data && data.USDBRL) {
      state.dollarRate = parseFloat(data.USDBRL.bid) || 5.70;
      state.dollarVariation = parseFloat(data.USDBRL.pctChange) || 0;
      localStorage.setItem('lastro_dollar_rate', String(state.dollarRate));

      const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      if (lastUpdate) lastUpdate.textContent = `Atualizado às ${time}`;
    }
  } catch (err) {
    if (lastUpdate) lastUpdate.textContent = 'Modo offline (estimado)';
  }

  // Update UI de forma segura
  if (rateDisplay) rateDisplay.textContent = `R$ ${state.dollarRate.toFixed(2).replace('.', ',')}`;
  if (varBadge) {
    const varSign = state.dollarVariation >= 0 ? '+' : '';
    varBadge.textContent = `${varSign}${state.dollarVariation.toFixed(2).replace('.', ',')}%`;
    varBadge.className = `badge-tag ${state.dollarVariation >= 0 ? 'yield-positive' : 'yield-negative'}`;
  }

  updateDollarValuesUI();
}

function updateDollarValuesUI() {
  const usdAmountEl = document.getElementById('usdAmountDisplay');
  const brlEquivalentEl = document.getElementById('usdInBrlDisplay');
  const checkbox = document.getElementById('checkIncludeUsdInPatrimony');

  if (usdAmountEl) usdAmountEl.textContent = state.usdAmount > 0 ? formatUSD(state.usdAmount) : '';
  const reserveValues = document.querySelector('.reserve-values');
  if (reserveValues) reserveValues.hidden = !(state.usdAmount > 0);

  const brlEquivalent = (state.usdAmount || 0) * (state.dollarRate || 5.70);
  if (brlEquivalentEl) brlEquivalentEl.textContent = state.usdAmount > 0 ? formatCurrency(brlEquivalent) : '';
  if (checkbox) checkbox.checked = state.includeUsdInPatrimony;

  // Atualiza totais e a barra da meta somando o dólar se marcado
  if (state.analytics && state.analytics.summary) {
    const s = state.analytics.summary;
    const baseGross = parseFloat(s.total_gross) || 0;
    const baseNet = parseFloat(s.total_net) || 0;
    const goal = parseFloat(s.patrimony_goal) || 100000;

    const finalGross = state.includeUsdInPatrimony ? (baseGross + brlEquivalent) : baseGross;
    const finalNet = state.includeUsdInPatrimony ? (baseNet + brlEquivalent) : baseNet;

    const kpiGrossEl = document.getElementById('kpiGross');
    if (kpiGrossEl) setMoneyValue(kpiGrossEl, finalGross, hasDashboardSnapshot(s));

    const kpiNetEl = document.getElementById('kpiNet');
    if (kpiNetEl) setMoneyValue(kpiNetEl, finalNet, hasDashboardSnapshot(s));
    updatePortfolioExcludingUsd(s);

    // Atualiza Barra e Valores da Meta com a soma correta
    const progressPct = goal > 0 ? Math.min(100, (finalNet / goal) * 100) : 0;
    const remaining = Math.max(0, goal - finalNet);

    const goalCurrentEl = document.getElementById('goalCurrentDisplay');
    if (goalCurrentEl) setMoneyValue(goalCurrentEl, finalNet, hasDashboardSnapshot(s));

    const goalRemainingEl = document.getElementById('goalRemainingDisplay');
    if (goalRemainingEl) goalRemainingEl.textContent = hasDashboardSnapshot(s) ? (remaining > 0 ? `Faltam ${formatCurrency(remaining)}` : 'Meta atingida') : 'Sem dados ainda';

    const goalTargetEl = document.getElementById('goalTargetDisplay');
    if (goalTargetEl) setMoneyValue(goalTargetEl, goal);

    const goalPctEl = document.getElementById('goalPctDisplay');
    if (goalPctEl) goalPctEl.textContent = hasDashboardSnapshot(s) ? `${progressPct.toFixed(1).replace('.', ',')}% alcançado` : 'Sem dados';

    const goalBarEl = document.getElementById('goalProgressBar');
    if (goalBarEl) goalBarEl.style.width = `${progressPct}%`;
  }
}

function updatePortfolioExcludingUsd(summary = state.analytics?.summary) {
  const comparison = document.getElementById('portfolioExcludingUsd');
  const value = document.getElementById('kpiNetWithoutUsd');
  if (!comparison || !value) return;
  const showComparison = state.includeUsdInPatrimony && Number(state.usdAmount) > 0;
  comparison.hidden = !showComparison;
  if (showComparison && summary) setMoneyValue(value, Number(summary.total_net) || 0, hasDashboardSnapshot(summary));
}

function openUsdModal() {
  document.getElementById('inputUsdAmount').value = state.usdAmount || '';
  document.getElementById('modalUsd').classList.remove('hidden');
}

function closeUsdModal() {
  document.getElementById('modalUsd').classList.add('hidden');
}

async function handleUsdSubmit(e) {
  e.preventDefault();
  const val = parseFloat(document.getElementById('inputUsdAmount').value) || 0;
  state.usdAmount = val;
  localStorage.setItem('lastro_usd_amount', String(val));

  updateDollarValuesUI();
  closeUsdModal();
  showToast('Saldo em dólar salvo!');

  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usd_amount: state.usdAmount })
    });
  } catch (err) {
    // LocalStorage já salvou
  }
}

// ========================================================
// DASHBOARD RENDERING & KPIS
// ========================================================
async function loadDashboardData() {
  const dashboard = document.getElementById('tab-dashboard');
  const loadError = document.getElementById('dashboardLoadError');
  dashboard?.classList.add('is-loading');
  if (loadError) loadError.hidden = true;
  try {
    await fetchInvestments();
    renderDashboardFreshness();
    const analytics = await fetchAnalytics(state.selectedInvestmentId);
    if (!analytics || !analytics.summary) {
      console.warn('Analytics inválido.');
      if (loadError) loadError.hidden = false;
      return;
    }

    const s = analytics.summary || {};
    const hasRecords = Boolean(s.latest_date);

    // Carrega configurações de Dólar (com prioridade no que está salvo localmente)
    const localUsd = localStorage.getItem('lastro_usd_amount');
    if (localUsd !== null) {
      state.usdAmount = parseFloat(localUsd) || 0;
    } else if (s.usd_amount !== undefined) {
      state.usdAmount = parseFloat(s.usd_amount) || 0;
    }

    const localInclude = localStorage.getItem('lastro_include_usd');
    if (localInclude !== null) {
      state.includeUsdInPatrimony = localInclude === 'true';
    } else if (s.include_usd_in_patrimony !== undefined) {
      state.includeUsdInPatrimony = !!s.include_usd_in_patrimony;
    }

    // Meta de Patrimônio
    const goal = parseFloat(s.patrimony_goal) || 100000;
    const baseNet = parseFloat(s.total_net) || 0;
    const brlEquivalent = (state.usdAmount || 0) * (state.dollarRate || 5.70);
    const finalNet = state.includeUsdInPatrimony ? (baseNet + brlEquivalent) : baseNet;
    const goalRemaining = Math.max(0, goal - finalNet);
    const goalPct = goal > 0 ? (finalNet / goal) * 100 : 0;

    const goalCurrentEl = document.getElementById('goalCurrentDisplay');
    if (goalCurrentEl) setMoneyValue(goalCurrentEl, finalNet, hasDashboardSnapshot(s));

    const goalTargetEl = document.getElementById('goalTargetDisplay');
    if (goalTargetEl) setMoneyValue(goalTargetEl, goal);

    const goalRemainingEl = document.getElementById('goalRemainingDisplay');
    if (goalRemainingEl) goalRemainingEl.textContent = hasDashboardSnapshot(s) ? (goalRemaining > 0 ? `Faltam ${formatCurrency(goalRemaining)}` : 'Meta atingida') : 'Sem dados ainda';

    const goalPctEl = document.getElementById('goalPctDisplay');
    if (goalPctEl) goalPctEl.textContent = hasDashboardSnapshot(s) ? `${Math.min(100, goalPct).toFixed(1).replace('.', ',')}% alcançado` : 'Sem dados';

    const goalBarEl = document.getElementById('goalProgressBar');
    if (goalBarEl) goalBarEl.style.width = `${Math.min(100, Math.max(0, goalPct || 0))}%`;

    // Saldos Principais
    const kpiGrossEl = document.getElementById('kpiGross');
    if (kpiGrossEl) setMoneyValue(kpiGrossEl, state.includeUsdInPatrimony ? (Number(s.total_gross)||0)+brlEquivalent : Number(s.total_gross)||0, hasDashboardSnapshot(s));

    const kpiNetEl = document.getElementById('kpiNet');
    if (kpiNetEl) setMoneyValue(kpiNetEl, finalNet, hasDashboardSnapshot(s));
    updatePortfolioExcludingUsd(s);

    const kpiTaxEl = document.getElementById('kpiTax');
    if (kpiTaxEl) kpiTaxEl.textContent = hasRecords ? formatCurrency(s.total_tax || 0) : 'Sem dados ainda';

    // Capital Investido vs Lucro Real Total
    const kpiInvestedEl = document.getElementById('kpiInvested');
    if (kpiInvestedEl) kpiInvestedEl.textContent = hasRecords ? formatCurrency(s.net_invested_capital || 0) : 'Sem dados ainda';

    const kpiProfitEl = document.getElementById('kpiTotalProfit');
    if (kpiProfitEl) kpiProfitEl.textContent = hasRecords ? formatCurrency(s.accumulated_net_yield || 0) : 'Sem dados ainda';

    // Rendimento de Hoje
    const kpiTodayYieldEl = document.getElementById('kpiTodayYield');
    if (kpiTodayYieldEl) kpiTodayYieldEl.textContent = hasRecords ? formatCurrency(s.latest_daily_gross_yield || 0) : 'Sem dados ainda';

    const kpiTodayNetEl = document.getElementById('kpiTodayNet');
    if (kpiTodayNetEl) kpiTodayNetEl.textContent = hasRecords ? formatCurrency(s.latest_daily_net_yield || 0) : 'Sem dados ainda';
    
    const todayPctEl = document.getElementById('kpiTodayPct');
    if (todayPctEl) todayPctEl.textContent = hasRecords ? formatPct(s.latest_daily_gross_pct || 0) : 'Sem histórico';

    // Rendimentos por Período
    const kpiMonthNetEl = document.getElementById('kpiMonthNet');
    if (kpiMonthNetEl) kpiMonthNetEl.textContent = hasRecords ? formatCurrency(s.current_month_net_yield || 0) : 'Sem dados ainda';

    const kpiMonthGrossEl = document.getElementById('kpiMonthGross');
    if (kpiMonthGrossEl) kpiMonthGrossEl.textContent = hasRecords ? formatCurrency(s.current_month_gross_yield || 0) : 'Sem dados ainda';

    const kpiYearNetEl = document.getElementById('kpiYearNet');
    if (kpiYearNetEl) kpiYearNetEl.textContent = hasRecords ? formatCurrency(s.current_year_net_yield || 0) : 'Sem dados ainda';

    const kpiYearGrossEl = document.getElementById('kpiYearGross');
    if (kpiYearGrossEl) kpiYearGrossEl.textContent = hasRecords ? formatCurrency(s.current_year_gross_yield || 0) : 'Sem dados ainda';

    const kpi12MonthsNetEl = document.getElementById('kpi12MonthsNet');
    if (kpi12MonthsNetEl) kpi12MonthsNetEl.textContent = hasRecords ? formatCurrency(s.last_12_months_net_yield || 0) : 'Sem dados ainda';

    const kpi12MonthsGrossEl = document.getElementById('kpi12MonthsGross');
    if (kpi12MonthsGrossEl) kpi12MonthsGrossEl.textContent = hasRecords ? formatCurrency(s.last_12_months_gross_yield || 0) : 'Sem dados ainda';

    // Taxa CDI
    const cdiRateEl = document.getElementById('cdiRateBadge');
    if (cdiRateEl) {
      const cdiVal = parseFloat(s.annual_cdi_rate) || 10.75;
      cdiRateEl.textContent = `${cdiVal.toFixed(2).replace('.', ',')}% a.a.`;
    }

    const dateEl = document.getElementById('kpiLatestDate');
    if (dateEl) {
      if (s.latest_date) dateEl.textContent = `Último registro: ${formatDateBR(s.latest_date)}`;
      else dateEl.textContent = 'Sem dados ainda';
    }

    if (dateEl) dateEl.textContent = s.latest_date ? formatRelativeDate(s.latest_date) : 'Sem dados ainda';
    updateDashboardDataVisibility(s);

    // Banner de Alerta de Vencimentos (< 30 dias)
    const alertBanner = document.getElementById('maturityAlertBanner');
    const alertText = document.getElementById('maturityAlertText');
    if (alertBanner && alertText) {
      if (analytics.maturity_alerts && analytics.maturity_alerts.length > 0) {
        const listHtml = analytics.maturity_alerts.map(a => 
          `<strong>${escapeHtml(a.name)}</strong> vence em <strong>${a.days_left} dia(s)</strong> (${formatDateBR(a.maturity_date)})`
        ).join(' • ');
        alertText.innerHTML = `<strong>Aviso de vencimento:</strong> ${listHtml}`;
        alertBanner.classList.remove('hidden');
      } else {
        alertBanner.classList.add('hidden');
      }
    }

    // Tabela Comparativa CDI e Vencimentos (com fallback seguro)
    const assetsList = analytics.allocations ? (analytics.allocations.assets || []) : [];
    renderCdiComparisonTable(assetsList);

    // Tabela Recente
    renderRecentTable(analytics.recent_records || []);

    // Gráficos
    [
      ['kpiTax', s.total_tax], ['kpiInvested', s.net_invested_capital], ['kpiTotalProfit', s.accumulated_net_yield, true],
      ['kpiTodayYield', s.latest_daily_gross_yield], ['kpiTodayNet', s.latest_daily_net_yield, true],
      ['kpiMonthNet', s.current_month_net_yield, true], ['kpiMonthGross', s.current_month_gross_yield],
      ['kpiYearNet', s.current_year_net_yield, true], ['kpiYearGross', s.current_year_gross_yield],
      ['kpi12MonthsNet', s.last_12_months_net_yield, true], ['kpi12MonthsGross', s.last_12_months_gross_yield]
    ].forEach(([id, value, isYield]) => {
      const element = document.getElementById(id);
      if (element) isYield ? setYieldValue(element, value || 0, hasRecords) : setMoneyValue(element, value || 0, hasRecords);
    });
    const remainingEl = document.getElementById('goalRemainingDisplay');
    if (remainingEl && hasDashboardSnapshot(s)) setMoneyText(remainingEl, goalRemaining > 0 ? `Faltam ${formatCurrency(goalRemaining)}` : 'Meta atingida');

    renderDailyYieldChart(analytics.timeline || []);
    updatePeriodPerformance(analytics);
    renderScenario();
    loadCalendarEvents();
    renderDashboardFreshness();
    renderAllocationPieChart();

    // Atualiza Cotação do Dólar
    fetchDollarRate();
  } catch (error) {
    console.error('Erro ao renderizar dashboard:', error);
    if (loadError) loadError.hidden = false;
  } finally {
    dashboard?.classList.remove('is-loading');
  }
}

function updateDashboardGreeting() {
  const title = document.getElementById('pageTitle');
  if (state.currentTab === 'dashboard' && title) {
    title.textContent = state.userName ? `Olá, ${state.userName}` : 'Início';
  }
}

async function loadDashboardGreeting() {
  try {
    const response = await fetch('/api/settings');
    if (!response.ok) return;
    const settings = await response.json();
    const hasServerName = Object.prototype.hasOwnProperty.call(settings, 'user_name');
    const storedName = localStorage.getItem('lastro_user_name') || '';
    state.userName = hasServerName ? String(settings.user_name || '').trim() : storedName;
    if (state.userName) localStorage.setItem('lastro_user_name', state.userName);
    else localStorage.removeItem('lastro_user_name');
    updateDashboardGreeting();
  } catch (error) {}
}

function addDaysToDate(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addMonthsToDate(dateString, months) {
  const date = new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}

function businessDaysBetween(startDate, endDate) {
  if (!startDate || !endDate || endDate <= startDate) return 0;
  let count = 0;
  const date = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (date < end) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) count++;
  }
  return count;
}

function calendarDaysBetween(startDate, endDate) {
  if (!startDate || !endDate || endDate <= startDate) return 0;
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  return Math.round((end - start) / 86400000);
}

function updatePeriodPerformance(analytics = state.analytics) {
  const note = document.getElementById('performancePeriodNote');
  const yieldEl = document.getElementById('performanceYield');
  const returnEl = document.getElementById('performanceReturn');
  const cdiEl = document.getElementById('performanceCdi');
  const investments = analytics?.investments || [];
  const allRecords = investments.flatMap(investment => investment.records || []);
  const start = allRecords.map(record => record.date).sort()[0];
  const end = allRecords.map(record => record.date).sort().at(-1);

  let startDate = start;
  if (state.performanceRange === 'ytd') startDate = `${getTodayString().slice(0, 4)}-01-01`;
  else if (state.performanceRange !== 'all') startDate = addDaysToDate(getTodayString(), -Number(state.performanceRange));

  let periodYield = 0;
  let weightedCapital = 0;
  let recordCount = 0;
  const periodDays = Math.max(1, calendarDaysBetween(startDate, end));

  for (const investment of investments) {
    const records = investment.records || [];
    if (!records.length) continue;
    let anchorIndex = -1;
    records.forEach((record, index) => {
      if (record.date <= startDate) anchorIndex = index;
    });
    if (anchorIndex < 0) anchorIndex = 0;

    const anchor = records[anchorIndex];
    const inPeriod = records.slice(anchorIndex + 1).filter(record => record.date <= end);
    if (!inPeriod.length) continue;

    const reference = Math.max(0, Number(anchor.net_value) || 0);
    if (anchor.date <= startDate) {
      weightedCapital += reference;
    } else {
      const daysInvested = calendarDaysBetween(anchor.date, end);
      weightedCapital += reference * Math.max(0, daysInvested / periodDays);
    }

    for (const record of inPeriod) {
      periodYield += Number(record.daily_net_yield) || 0;
      const netFlow = (Number(record.contribution) || 0) - (Number(record.withdrawal) || 0);
      const daysInvested = calendarDaysBetween(record.date, end);
      weightedCapital += netFlow * Math.max(0, daysInvested / periodDays);
      recordCount++;
    }
  }

  const returnPct = weightedCapital > 0 ? (periodYield / weightedCapital) * 100 : 0;
  const summary = analytics?.summary || {};
  const cdiRate = Number(summary.annual_cdi_rate) || 10.75;
  const businessDays = businessDaysBetween(startDate, end);
  const benchmarkPct = (Math.pow(1 + cdiRate / 100, 1 / 252) ** businessDays - 1) * 100;
  const cdiDelivery = benchmarkPct > 0 ? (returnPct / benchmarkPct) * 100 : null;

  if (yieldEl) {
    yieldEl.textContent = recordCount ? formatCurrency(periodYield) : '—';
    yieldEl.classList.toggle('yield-positive', periodYield >= 0);
    yieldEl.classList.toggle('yield-negative', periodYield < 0);
  }
  if (returnEl) {
    returnEl.textContent = recordCount ? formatPct(returnPct) : '—';
    returnEl.classList.toggle('yield-positive', returnPct >= 0);
    returnEl.classList.toggle('yield-negative', returnPct < 0);
  }
  if (cdiEl) cdiEl.textContent = recordCount && cdiDelivery !== null ? `${cdiDelivery.toFixed(1).replace('.', ',')}% do CDI` : '—';

  if (note) {
    if (!start || !end) note.textContent = 'Registre saldos para acompanhar a rentabilidade.';
    else if (!recordCount) note.textContent = 'Ainda não há dois saldos no período selecionado.';
    else note.textContent = `Até ${formatDateBR(end)} · aportes e resgates não contam como rendimento`;
  }
  updateRealReturn(analytics, end);
  labelRealReturnEstimate();
}

function labelRealReturnEstimate() {
  const note = document.getElementById('performanceRealNote');
  if (note && note.textContent.includes('IPCA de') && !note.textContent.startsWith('Estimado')) {
    note.textContent = `Estimado | ${note.textContent}`;
  }
}

function updateRealReturn(analytics = state.analytics, latestSnapshot) {
  const valueEl = document.getElementById('performanceRealReturn');
  const noteEl = document.getElementById('performanceRealNote');
  if (!valueEl || !noteEl) return;
  const rates = state.ipcaRates || [];
  if (!rates.length) {
    valueEl.textContent = '—';
    noteEl.textContent = 'Atualize o IPCA para comparar';
    return;
  }

  const allRecords = (analytics?.investments || []).flatMap(item => item.records || []);
  const analyticsEnd = latestSnapshot || allRecords.map(row => row.date).sort().at(-1);
  const latestIpcaMonth = rates[rates.length - 1]?.reference_month;
  const firstRecord = allRecords.map(row => row.date).sort()[0];
  const realEnd = latestIpcaMonth ? addDaysToDate(addMonthsToDate(`${latestIpcaMonth}-01`, 1), -1) : null;
  const endDate = analyticsEnd && realEnd ? (analyticsEnd < realEnd ? analyticsEnd : realEnd) : null;
  const startDate = state.performanceRange === 'all'
    ? firstRecord
    : state.performanceRange === 'ytd'
      ? `${endDate.slice(0, 4)}-01-01`
      : addDaysToDate(endDate, -Number(state.performanceRange || 30));
  if (!startDate || !endDate || startDate > endDate) {
    valueEl.textContent = '—';
    noteEl.textContent = 'Período ainda sem IPCA publicado';
    return;
  }

  const monthRates = new Map(rates.map(row => [row.reference_month, Number(row.rate)]));
  const requiredMonths = [];
  for (let cursor = `${startDate.slice(0, 7)}-01`; cursor <= `${endDate.slice(0, 7)}-01`; cursor = addMonthsToDate(cursor, 1)) {
    requiredMonths.push(cursor.slice(0, 7));
  }
  const missingMonth = requiredMonths.find(month => !monthRates.has(month));
  if (missingMonth) {
    valueEl.textContent = '—';
    noteEl.textContent = `IPCA de ${missingMonth.slice(5, 7)}/${missingMonth.slice(0, 4)} ainda não disponível`;
    return;
  }

  let inflationFactor = 1;
  for (const month of requiredMonths) {
    const monthStart = `${month}-01`;
    const monthEnd = addDaysToDate(addMonthsToDate(monthStart, 1), -1);
    const overlapStart = startDate > monthStart ? startDate : monthStart;
    const overlapEnd = endDate < monthEnd ? endDate : monthEnd;
    const days = Math.max(0, calendarDaysBetween(addDaysToDate(overlapStart, -1), overlapEnd));
    const daysInMonth = Number(monthEnd.slice(8, 10));
    inflationFactor *= Math.pow(1 + monthRates.get(month) / 100, days / daysInMonth);
  }

  let nominalYield = 0;
  let weightedCapital = 0;
  for (const investment of analytics?.investments || []) {
    const records = investment.records || [];
    if (!records.length) continue;
    let anchorIndex = -1;
    records.forEach((record, index) => { if (record.date <= startDate) anchorIndex = index; });
    if (anchorIndex < 0) anchorIndex = records.findIndex(record => record.date >= startDate);
    if (anchorIndex < 0) continue;
    const anchor = records[anchorIndex];
    const actualStart = anchor.date > startDate ? anchor.date : startDate;
    const actualEnd = records.filter(record => record.date <= endDate).at(-1)?.date;
    if (!actualEnd || actualEnd < actualStart) continue;
    const periodDays = Math.max(1, calendarDaysBetween(actualStart, actualEnd));
    weightedCapital += Math.max(0, Number(anchor.net_value) || 0);
    for (const record of records.slice(anchorIndex + 1).filter(row => row.date <= endDate)) {
      nominalYield += Number(record.daily_net_yield) || 0;
      const flow = (Number(record.contribution) || 0) - (Number(record.withdrawal) || 0);
      weightedCapital += flow * Math.max(0, calendarDaysBetween(record.date, actualEnd) / periodDays);
    }
  }
  if (weightedCapital <= 0) {
    valueEl.textContent = '—';
    noteEl.textContent = 'Registre saldos no período para comparar';
    return;
  }
  const nominalPct = nominalYield / weightedCapital * 100;
  const inflationPct = (inflationFactor - 1) * 100;
  const realPct = ((1 + nominalPct / 100) / inflationFactor - 1) * 100;
  valueEl.textContent = formatPct(realPct);
  valueEl.classList.toggle('yield-positive', realPct >= 0);
  valueEl.classList.toggle('yield-negative', realPct < 0);
  noteEl.textContent = `Após IPCA de ${formatPct(inflationPct)} · até ${formatDateBR(endDate)}`;
}

async function loadInflationRates() {
  try {
    const response = await fetch('/api/inflation');
    if (!response.ok) throw new Error('Não foi possível carregar o IPCA.');
    state.ipcaRates = await response.json();
    updateRealReturn();
    labelRealReturnEstimate();
    const note = document.getElementById('ipcaSourceNote');
    if (note && state.ipcaRates.length) {
      const latest = state.ipcaRates.at(-1);
      note.textContent = `IPCA até ${latest.reference_month.slice(5, 7)}/${latest.reference_month.slice(0, 4)} · Banco Central`;
    }
  } catch (error) {
    console.warn('IPCA indisponível:', error);
  }
}

async function refreshInflationRates() {
  const button = document.getElementById('btnRefreshIpca');
  if (button) { button.disabled = true; button.textContent = 'Atualizando…'; }
  try {
    const response = await fetch('/api/inflation/sync', { method: 'POST' });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Não foi possível atualizar o IPCA.');
    await loadInflationRates();
    updatePeriodPerformance();
    showToast('IPCA atualizado.');
  } catch (error) {
    showToast(error.message || 'Não foi possível atualizar o IPCA.', 'error');
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Atualizar IPCA'; }
  }
}

function renderWalletConcentration() {
  const root = document.getElementById('walletConcentration');
  if (!root) return;
  const assets = state.investments.map(investment => {
    const details = (state.analytics?.investments || []).find(row => Number(row.id) === Number(investment.id));
    return { ...investment, net: Math.max(0, Number(details?.last_net) || 0) };
  }).filter(item => item.net > 0);
  if (!assets.length) {
    root.innerHTML = '<p class="concentration-empty">Registre o primeiro saldo para acompanhar a concentração e a liquidez.</p>';
    return;
  }
  const dimensions = [
    ['Instituição', item => item.institution?.trim() || 'Sem instituição'],
    ['Tipo de ativo', item => item.category?.trim() || 'Sem categoria'],
    ['Liquidez', item => item.liquidity?.trim() || 'Não informada']
  ];
  root.innerHTML = dimensions.map(([title, getGroup]) => {
    const totals = new Map();
    assets.forEach(item => {
      const key = getGroup(item);
      totals.set(key, (totals.get(key) || 0) + item.net);
    });
    const rows = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    const portfolioTotal = assets.reduce((sum, item) => sum + item.net, 0);
    return `<section class="concentration-column"><h4>${escapeHtml(title)}</h4><div class="concentration-rows">${rows.map(([label, amount]) => {
      const pct = portfolioTotal ? amount / portfolioTotal * 100 : 0;
      return `<div class="concentration-row"><div class="concentration-row-copy"><span>${escapeHtml(label)}</span><strong>${formatCurrency(amount)} <small>${pct.toFixed(1).replace('.', ',')}%</small></strong></div><div class="concentration-track"><span style="width:${Math.max(2, Math.min(100, pct))}%"></span></div></div>`;
    }).join('')}</div></section>`;
  }).join('');
}

const CALENDAR_TYPE_LABELS = { interest: 'Juros', dividend: 'Dividendos', maturity: 'Vencimento' };

async function loadCalendarEvents() {
  const root = document.getElementById('calendarEventsList');
  if (!root) return;
  try {
    const response = await fetch('/api/calendar');
    if (!response.ok) throw new Error('Não foi possível carregar a agenda.');
    state.calendarEvents = await response.json();
    renderCalendarEvents();
  } catch (error) {
    root.innerHTML = '<p class="empty-state">Não foi possível carregar a agenda.</p>';
  }
}

function renderCalendarEvents() {
  const root = document.getElementById('calendarEventsList');
  if (!root) return;
  const today = getTodayString();
  const items = [...(state.calendarEvents || [])].sort((a, b) => {
    const aUpcoming = a.event_date >= today;
    const bUpcoming = b.event_date >= today;
    if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
    return aUpcoming ? a.event_date.localeCompare(b.event_date) : b.event_date.localeCompare(a.event_date);
  }).slice(0, 10);
  if (!items.length) {
    root.innerHTML = '<p class="calendar-empty">Agende um rendimento ou informe a data de vencimento de um ativo para montar sua agenda.</p>';
    return;
  }
  root.innerHTML = items.map(event => {
    const received = event.status === 'received';
    const isMaturity = event.type === 'maturity';
    const overdue = event.status === 'expected' && event.event_date < getTodayString();
    const statusLabel = received ? 'Recebido' : event.status === 'past' ? 'Vencido' : overdue ? 'Pendente' : isMaturity ? 'Previsto' : 'Estimativa';
    const amount = received ? event.received_amount : event.estimated_amount;
    const title = event.title || CALENDAR_TYPE_LABELS[event.type] || 'Evento';
    return `<article class="calendar-event ${received ? 'is-received' : ''}" data-event-id="${event.id || ''}">
      <div class="calendar-event-date"><strong>${new Date(`${event.event_date}T00:00:00`).toLocaleDateString('pt-BR', { day: '2-digit' })}</strong><span>${new Date(`${event.event_date}T00:00:00`).toLocaleDateString('pt-BR', { month: 'short' })}</span></div>
      <div class="calendar-event-copy"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(event.investment_name || '')} · ${escapeHtml(event.institution || CALENDAR_TYPE_LABELS[event.type] || '')}</span></div>
      <div class="calendar-event-value"><strong>${amount === null || amount === undefined ? 'Valor não informado' : formatCurrency(amount)}</strong><span class="calendar-status ${received ? 'status-received' : overdue ? 'status-overdue' : ''}">${statusLabel}</span></div>
      <div class="calendar-receive-slot">${!isMaturity && !received && event.status === 'expected' ? `<button type="button" class="text-action" data-calendar-receive="${event.id}" aria-label="Registrar recebimento de ${escapeHtml(title)}">Marcar recebido</button>` : ''}</div>
    </article>`;
  }).join('');
}

async function handleCalendarSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = {
    investment_id: Number(document.getElementById('calendarInvestment').value),
    type: document.getElementById('calendarType').value,
    event_date: document.getElementById('calendarDate').value,
    estimated_amount: document.getElementById('calendarAmount').value,
    title: document.getElementById('calendarTitle').value.trim()
  };
  try {
    const response = await fetch('/api/calendar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível salvar o evento.');
    form.reset();
    document.getElementById('calendarDate').value = getTodayString();
    await loadCalendarEvents();
    showToast('Evento adicionado à agenda.');
  } catch (error) {
    showToast(error.message || 'Não foi possível salvar o evento.', 'error');
  }
}

async function submitCalendarReceipt(eventId, form) {
  const amount = Number(form.elements.amount.value);
  try {
    const response = await fetch(`/api/calendar/${eventId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'received', amount, received_date: form.elements.received_date.value })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível marcar como recebido.');
    await loadCalendarEvents();
    if (state.currentTab === 'dashboard') await loadDashboardData();
    else if (state.currentTab === 'history') await loadFullHistory();
    else { await fetchAnalytics(state.selectedInvestmentId); updatePeriodPerformance(); }
    showToast('Recebimento registrado no histórico.');
  } catch (error) {
    showToast(error.message || 'Não foi possível registrar o recebimento.', 'error');
  }
}

async function loadMovements() {
  const tbody = document.getElementById('tableMovements');
  if (!tbody) return;
  const investmentId = document.getElementById('historyFilterInv')?.value || '';
  try {
    const response = await fetch(`/api/movements${investmentId ? `?investment_id=${encodeURIComponent(investmentId)}` : ''}`);
    if (!response.ok) throw new Error('Não foi possível carregar as movimentações.');
    state.movements = await response.json();
    renderMovements();
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Não foi possível carregar as movimentações.</td></tr>';
  }
}

function renderMovements() {
  const tbody = document.getElementById('tableMovements');
  if (!tbody) return;
  const labels = { application: 'Aplicação', contribution: 'Aporte', withdrawal: 'Resgate', interest: 'Juros', dividend: 'Dividendos', fee: 'Taxa', tax: 'Imposto' };
  if (!state.movements.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhuma movimentação registrada.</td></tr>';
    return;
  }
  tbody.innerHTML = state.movements.map(item => `<tr class="movement-row"><td>${formatDateBR(item.date)}</td><td>${escapeHtml(item.investment_name)}<small class="movement-institution">${escapeHtml(item.institution || '')}</small></td><td>${labels[item.type] || escapeHtml(item.type)}<small class="movement-institution">${item.balance_includes ? 'Refletido no saldo' : 'Contabilizado à parte'}</small></td><td class="mono-num">${formatCurrency(item.amount)}</td><td>${escapeHtml(item.notes || '—')}</td><td><button type="button" class="btn-danger-sm" data-delete-movement="${item.id}" aria-label="Excluir movimentação">Excluir</button></td></tr>`).join('');
}

async function handleMovementSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = {
    investment_id: Number(document.getElementById('movementInvestment').value),
    type: document.getElementById('movementType').value,
    date: document.getElementById('movementDate').value,
    amount: Number(document.getElementById('movementAmount').value),
    notes: document.getElementById('movementNotes').value.trim(),
    balance_includes: document.getElementById('movementBalanceIncludes').checked
  };
  try {
    const response = await fetch('/api/movements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível registrar a movimentação.');
    form.reset();
    document.getElementById('movementDate').value = getTodayString();
    document.getElementById('movementBalanceIncludes').checked = true;
    await loadMovements();
    if (state.currentTab === 'history') await loadFullHistory();
    else if (state.currentTab === 'dashboard') await loadDashboardData();
    else { await fetchAnalytics(state.selectedInvestmentId); updatePeriodPerformance(); }
    showToast('Movimentação registrada.');
  } catch (error) {
    showToast(error.message || 'Não foi possível registrar a movimentação.', 'error');
  }
}

async function deleteMovement(id) {
  if (!confirm('Excluir esta movimentação? Ela poderá ser recuperada em Configurações.')) return;
  try {
    const response = await fetch(`/api/movements/${id}`, { method: 'DELETE' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível excluir a movimentação.');
    await loadMovements();
    if (state.currentTab === 'history') await loadFullHistory();
    else if (state.currentTab === 'dashboard') await loadDashboardData();
    else { await fetchAnalytics(state.selectedInvestmentId); updatePeriodPerformance(); }
    showToast('Movimentação enviada para Itens excluídos.');
  } catch (error) {
    showToast(error.message || 'Não foi possível excluir a movimentação.', 'error');
  }
}

function renderScenario() {
  const form = document.getElementById('formScenario');
  const results = document.getElementById('scenarioResults');
  if (!form || !results) return;
  const inputs = ['scenarioMonthlyContribution', 'scenarioYears', 'scenarioConservativeRate', 'scenarioBaseRate', 'scenarioOptimisticRate'];
  for (const id of inputs) {
    const saved = localStorage.getItem(`lastro_${id}`);
    const input = document.getElementById(id);
    if (saved !== null && input) input.value = saved;
  }
  const portfolioTotal = state.investments.reduce((sum, item) => sum + Math.max(0, Number(item.last_net) || 0), 0);
  const principal = Math.max(0, portfolioTotal || Number(state.analytics?.summary?.total_net) || 0)
    + (state.includeUsdInPatrimony ? (Number(state.usdAmount) || 0) * (Number(state.dollarRate) || 0) : 0);
  const principalEl = document.getElementById('scenarioStartingCapital');
  if (principalEl) principalEl.textContent = hasDashboardSnapshot() ? formatCurrency(principal) : 'Sem dados ainda';
  calculateScenarioResults();
}

function calculateScenarioResults() {
  const resultRoot = document.getElementById('scenarioResults');
  if (!resultRoot) return;
  const portfolioTotal = state.investments.reduce((sum, item) => sum + Math.max(0, Number(item.last_net) || 0), 0);
  const principal = Math.max(0, portfolioTotal || Number(state.analytics?.summary?.total_net) || 0)
    + (state.includeUsdInPatrimony ? (Number(state.usdAmount) || 0) * (Number(state.dollarRate) || 0) : 0);
  const monthly = Math.max(0, Number(document.getElementById('scenarioMonthlyContribution')?.value) || 0);
  const years = Math.max(1, Math.min(50, Number(document.getElementById('scenarioYears')?.value) || 1));
  const scenarios = [
    ['Conservador', Math.min(100, Math.max(0, Number(document.getElementById('scenarioConservativeRate')?.value) || 0))],
    ['Base', Math.min(100, Math.max(0, Number(document.getElementById('scenarioBaseRate')?.value) || 0))],
    ['Otimista', Math.min(100, Math.max(0, Number(document.getElementById('scenarioOptimisticRate')?.value) || 0))]
  ];
  const months = years * 12;
  const projections = scenarios.map(([label, annualRate]) => {
    const monthlyRate = Math.pow(1 + annualRate / 100, 1 / 12) - 1;
    const growth = Math.pow(1 + monthlyRate, months);
    const futureValue = principal * growth + (monthlyRate === 0 ? monthly * months : monthly * ((growth - 1) / monthlyRate));
    return { label, annualRate, value: futureValue };
  });
  const maxValue = Math.max(1, ...projections.map(row => row.value));
  resultRoot.innerHTML = projections.map((row, index) => `<div class="scenario-result ${index === 1 ? 'scenario-result-base' : ''}"><div><span>${row.label} · ${row.annualRate.toFixed(1).replace('.', ',')}% a.a.</span><strong>${formatCurrency(row.value)}</strong></div><div class="scenario-track"><span style="width:${Math.max(3, row.value / maxValue * 100)}%"></span></div></div>`).join('');
}

const DELETED_TYPE_LABELS = { investment: 'Ativo', record: 'Saldo', movement: 'Movimentação' };
const ACTIVITY_LABELS = { created: 'Criado', updated: 'Alterado', deleted: 'Excluído', restored: 'Restaurado', purged: 'Removido definitivamente', scheduled: 'Agendado', received: 'Recebido', cancelled: 'Cancelado', synced: 'Atualizado' };

async function loadRecoveryHistory() {
  const deletedRoot = document.getElementById('deletedItemsList');
  const activityRoot = document.getElementById('activityLogList');
  try {
    const [deletedResponse, activityResponse] = await Promise.all([fetch('/api/deleted'), fetch('/api/activity')]);
    if (!deletedResponse.ok || !activityResponse.ok) throw new Error('Não foi possível carregar o histórico.');
    const [deleted, activity] = await Promise.all([deletedResponse.json(), activityResponse.json()]);
    if (deletedRoot) deletedRoot.innerHTML = deleted.length ? deleted.map(item => `<div class="recovery-row"><div><strong>${escapeHtml(item.label)}</strong><span>${DELETED_TYPE_LABELS[item.entity_type] || 'Item'} · ${new Date(item.deleted_at.replace(' ', 'T') + 'Z').toLocaleString('pt-BR')}${item.details ? ` · ${escapeHtml(item.details)}` : ''}</span></div><div class="recovery-actions"><button type="button" class="text-action" data-restore-item="${item.id}">Restaurar</button><button type="button" class="text-action text-danger" data-purge-item="${item.id}">Apagar</button></div></div>`).join('') : '<p class="recovery-empty">Nenhum item na lixeira.</p>';
    if (activityRoot) activityRoot.innerHTML = activity.length ? activity.map(item => `<div class="activity-row"><span class="activity-dot"></span><div><strong>${escapeHtml(item.label)}</strong><span>${ACTIVITY_LABELS[item.action] || escapeHtml(item.action)} · ${new Date(item.created_at.replace(' ', 'T') + 'Z').toLocaleString('pt-BR')}${item.details ? ` · ${escapeHtml(item.details)}` : ''}</span></div></div>`).join('') : '<p class="recovery-empty">As alterações aparecerão aqui.</p>';
  } catch (error) {
    if (deletedRoot) deletedRoot.innerHTML = '<p class="recovery-empty">Não foi possível carregar os itens.</p>';
    if (activityRoot) activityRoot.innerHTML = '<p class="recovery-empty">Não foi possível carregar a atividade.</p>';
  }
}

async function restoreDeletedItem(id) {
  try {
    const response = await fetch(`/api/deleted/${id}`, { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível restaurar o item.');
    await loadRecoveryHistory();
    if (state.currentTab === 'investments') await renderInvestmentsCards();
    else if (state.currentTab === 'dashboard') await loadDashboardData();
    else await fetchInvestments();
    showToast('Item restaurado.');
  } catch (error) {
    showToast(error.message || 'Não foi possível restaurar o item.', 'error');
  }
}

async function permanentlyDeleteItem(id) {
  if (!confirm('Apagar este item definitivamente?')) return;
  try {
    const response = await fetch(`/api/deleted/${id}`, { method: 'DELETE' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível apagar o item.');
    await loadRecoveryHistory();
    showToast('Item apagado definitivamente.');
  } catch (error) {
    showToast(error.message || 'Não foi possível apagar o item.', 'error');
  }
}

function getBalanceFreshness(dateString) {
  if (!dateString) return { label: 'Sem saldo registrado', stale: true, missing: true };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const updated = new Date(`${dateString}T00:00:00`);
  updated.setHours(0, 0, 0, 0);
  let businessDays = 0;
  while (updated < today) {
    updated.setDate(updated.getDate() + 1);
    const weekday = updated.getDay();
    if (weekday !== 0 && weekday !== 6) businessDays++;
  }
  if (!businessDays) return { label: 'Saldo registrado hoje', stale: false, missing: false };
  const label = businessDays === 1 ? 'Saldo registrado há 1 dia útil' : `Saldo registrado há ${businessDays} dias úteis`;
  return { label, stale: businessDays >= 3, missing: false, businessDays };
}

function renderDashboardFreshness() {
  const container = document.getElementById('dashboardFreshness');
  const text = document.getElementById('dashboardFreshnessText');
  if (!container || !text) return;
  const old = state.investments.map(investment => ({ investment, freshness: getBalanceFreshness(investment.last_date) }))
    .filter(item => item.freshness.stale);
  container.hidden = old.length === 0;
  if (!old.length) return;

  const missing = old.filter(item => item.freshness.missing).length;
  const delayed = old.length - missing;
  const parts = [];
  if (missing) parts.push(`${missing} ${missing === 1 ? 'ativo sem saldo registrado' : 'ativos sem saldo registrado'}`);
  if (delayed) parts.push(`${delayed} ${delayed === 1 ? 'ativo sem atualização há pelo menos 3 dias úteis' : 'ativos sem atualização há pelo menos 3 dias úteis'}`);
  text.textContent = `${parts.join(' · ')}.`;
}

function renderMaturitySchedule() {
  const list = document.getElementById('maturityScheduleList');
  if (!list) return;
  const todayString = getTodayString();
  const upcoming = state.investments.filter(item => item.maturity_date)
    .map(item => {
      const date = new Date(`${item.maturity_date}T00:00:00Z`);
      const today = new Date(`${todayString}T00:00:00Z`);
      const days = Math.round((date - today) / 86400000);
      return { ...item, days };
    })
    .filter(item => item.days >= 0)
    .sort((a, b) => a.days - b.days)
    .slice(0, 5);

  if (!upcoming.length) {
    list.innerHTML = '<p class="maturity-empty">Nenhum vencimento futuro cadastrado.</p>';
    return;
  }

  list.innerHTML = upcoming.map(item => `
    <div class="maturity-item ${item.days <= 30 ? 'maturity-item-near' : ''}">
      <div class="maturity-item-name"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.institution || 'Sem instituição')}</span></div>
      <div class="maturity-item-date"><strong>${formatDateBR(item.maturity_date)}</strong><span>${item.days === 0 ? 'vence hoje' : item.days === 1 ? 'amanhã' : `em ${item.days} dias`}</span></div>
    </div>
  `).join('');
}

function renderWalletPortfolio() {
  const totalEl = document.getElementById('walletTotal');
  if (!totalEl) return;
  const balances = state.investments.filter(item => item.last_net !== null && item.last_net !== undefined);
  const total = balances.reduce((sum, item) => sum + (Number(item.last_net) || 0), 0);
  setMoneyValue(totalEl, total, balances.length > 0);

  const countEl = document.getElementById('walletAssetCount');
  const listCount = document.getElementById('walletListCount');
  if (countEl) countEl.textContent = `${state.investments.length} ${state.investments.length === 1 ? 'ativo' : 'ativos'} · ${balances.length} com saldo`;
  if (listCount) listCount.textContent = String(state.investments.length);

  const summary = state.analytics?.summary || {};
  const profit = Number(summary.accumulated_net_yield) || 0;
  const invested = total - profit;
  const profitPct = invested > 0 ? profit / invested * 100 : 0;
  const profitEl = document.getElementById('walletProfit');
  const profitPctEl = document.getElementById('walletProfitPct');
  if (profitEl) {
    profitEl.textContent = balances.length ? formatCurrency(profit) : '—';
    profitEl.classList.toggle('yield-positive', profit >= 0);
    profitEl.classList.toggle('yield-negative', profit < 0);
  }
  if (profitPctEl) {
    profitPctEl.textContent = balances.length ? `${formatPct(profitPct)} de rendimento acumulado` : 'Rendimento acumulado';
    profitPctEl.classList.toggle('yield-positive', profit >= 0);
    profitPctEl.classList.toggle('yield-negative', profit < 0);
  }
  renderWalletValueChart();
}

function buildWalletValueTimeline(analytics = state.analytics) {
  const investments = (analytics?.investments || []).filter(item => item.records?.length);
  const dates = [...new Set(investments.flatMap(item => item.records.map(record => record.date)))].sort();
  const cursors = new Map(investments.map(item => [Number(item.id), 0]));
  const balances = new Map();

  return dates.map(date => {
    for (const investment of investments) {
      let index = cursors.get(Number(investment.id)) || 0;
      while (index < investment.records.length && investment.records[index].date <= date) {
        balances.set(Number(investment.id), Number(investment.records[index].net_value) || 0);
        index++;
      }
      cursors.set(Number(investment.id), index);
    }
    return { date, total: [...balances.values()].reduce((sum, value) => sum + value, 0) };
  });
}

function renderWalletValueChart() {
  const canvas = document.getElementById('chartPortfolioValue');
  if (!canvas) return;
  const { ctx, width, height } = setupCanvas(canvas);
  ctx.clearRect(0, 0, width, height);

  const allPoints = buildWalletValueTimeline().filter(point => point.date <= getTodayString());
  let points = allPoints;
  if (state.walletRange !== 'all' && allPoints.length) {
    const cutoff = state.walletRange === '6m'
      ? addMonthsToDate(getTodayString(), -6)
      : state.walletRange === '1y'
        ? addMonthsToDate(getTodayString(), -12)
        : addDaysToDate(getTodayString(), -Number(state.walletRange));
    const anchor = allPoints.filter(point => point.date < cutoff).at(-1);
    points = [...(anchor ? [anchor] : []), ...allPoints.filter(point => point.date >= cutoff)];
  }

  const note = document.getElementById('walletChartNote');
  if (!points.length) {
    drawEmptyChartText(ctx, width, height, 'Registre o primeiro saldo para ver sua carteira.');
    if (note) note.textContent = 'A linha mostra os saldos registrados; aportes e resgates alteram o patrimônio.';
    return;
  }
  if (points.length > 42) {
    points = Array.from({ length: 42 }, (_, index) => points[Math.round(index * (points.length - 1) / 41)]);
  }

  const padding = { top: 12, right: 12, bottom: 24, left: 58 };
  const chartW = Math.max(1, width - padding.left - padding.right);
  const chartH = Math.max(1, height - padding.top - padding.bottom);
  const values = points.map(point => point.total);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const spread = rawMax - rawMin || rawMax || 1;
  const min = Math.max(0, rawMin - spread * .12);
  const max = rawMax + spread * .12;
  const range = Math.max(1, max - min);
  const xAt = index => points.length === 1 ? padding.left + chartW / 2 : padding.left + index / (points.length - 1) * chartW;
  const yAt = value => padding.top + (max - value) / range * chartH;

  ctx.font = '10px Manrope, sans-serif';
  ctx.textAlign = 'right';
  for (let tick = 0; tick < 3; tick++) {
    const value = max - range * tick / 2;
    const y = padding.top + chartH * tick / 2;
    ctx.strokeStyle = state.theme === 'dark' ? 'rgba(138,151,173,.12)' : 'rgba(71,85,105,.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.fillStyle = state.theme === 'dark' ? '#8a97ad' : '#64748b';
    const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
    ctx.fillText(`R$ ${compact}`, padding.left - 7, y + 3);
  }

  const baseline = padding.top + chartH;
  ctx.beginPath();
  points.forEach((point, index) => index ? ctx.lineTo(xAt(index), yAt(point.total)) : ctx.moveTo(xAt(index), yAt(point.total)));
  ctx.lineTo(xAt(points.length - 1), baseline);
  ctx.lineTo(xAt(0), baseline);
  ctx.closePath();
  const gradient = ctx.createLinearGradient(0, padding.top, 0, baseline);
  gradient.addColorStop(0, 'rgba(91,141,239,.24)');
  gradient.addColorStop(1, 'rgba(91,141,239,.015)');
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  points.forEach((point, index) => index ? ctx.lineTo(xAt(index), yAt(point.total)) : ctx.moveTo(xAt(index), yAt(point.total)));
  ctx.strokeStyle = '#5b8def';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(xAt(points.length - 1), yAt(points[points.length - 1].total), 3, 0, Math.PI * 2);
  ctx.fillStyle = '#82a8f4';
  ctx.fill();

  ctx.fillStyle = state.theme === 'dark' ? '#8a97ad' : '#64748b';
  ctx.textAlign = 'left';
  ctx.fillText(points[0].date.slice(5).replace('-', '/'), padding.left, height - 5);
  ctx.textAlign = 'right';
  ctx.fillText(points[points.length - 1].date.slice(5).replace('-', '/'), width - padding.right, height - 5);

  const tooltip = document.getElementById('portfolioValueTooltip');
  const wrapper = canvas.parentElement;
  canvas.onpointermove = event => {
    if (!tooltip || !points.length) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const index = points.length === 1 ? 0 : Math.round(Math.max(0, Math.min(points.length - 1, (x - padding.left) / chartW * (points.length - 1))));
    const item = points[index];
    tooltip.innerHTML = `<strong>${formatDateBR(item.date)}</strong><span>Carteira ${escapeHtml(formatCurrency(item.total))}</span>`;
    tooltip.hidden = false;
    const wrapRect = wrapper.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(event.clientX - wrapRect.left + 10, wrapRect.width - 150))}px`;
    tooltip.style.top = `${Math.max(4, event.clientY - wrapRect.top - 52)}px`;
  };
  canvas.onpointerleave = () => { if (tooltip) tooltip.hidden = true; };
  if (note) note.textContent = points.length < 2
    ? 'Registre novos saldos para acompanhar a evolução ao longo do tempo.'
    : `Saldos registrados até ${formatDateBR(points[points.length - 1].date)} · aportes e resgates alteram o patrimônio.`;
}

function openAssetDetail(investmentId, returnTab = 'investments', returnScrollTop = document.querySelector('.main-content')?.scrollTop || 0) {
  const investment = state.investments.find(item => Number(item.id) === Number(investmentId));
  if (!investment) return;
  state.selectedAssetId = Number(investmentId);
  state.assetDetailReturnTab = returnTab;
  state.assetDetailReturnScrollTop = returnScrollTop;
  document.getElementById('walletListView').hidden = true;
  document.getElementById('assetDetailView').hidden = false;
  document.getElementById('pageTitle').textContent = investment.name;
  document.getElementById('pageSubtitle').textContent = `${investment.institution || 'Geral'} · ${investment.category}`;
  renderAssetDetail();
  const main = document.querySelector('.main-content');
  main?.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

async function openAssetFromDashboard(investmentId) {
  const returnScrollTop = document.querySelector('.main-content')?.scrollTop || 0;
  switchTab('investments', { skipLoad: true });
  await renderInvestmentsCards();
  openAssetDetail(investmentId, 'dashboard', returnScrollTop);
}

function closeAssetDetail() {
  const returnTab = state.assetDetailReturnTab;
  const returnScrollTop = state.assetDetailReturnScrollTop;
  state.selectedAssetId = null;
  state.assetDetailReturnTab = 'investments';
  document.getElementById('assetDetailView').hidden = true;
  document.getElementById('walletListView').hidden = false;
  const main = document.querySelector('.main-content');
  if (returnTab === 'dashboard') {
    switchTab('dashboard');
    main?.scrollTo({ top: returnScrollTop, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    return;
  }
  main?.scrollTo({ top: returnScrollTop, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  document.getElementById('pageTitle').textContent = 'Carteira';
  document.getElementById('pageSubtitle').textContent = 'Seus investimentos em um só lugar';
}

function renderAssetDetail() {
  const investment = state.investments.find(item => Number(item.id) === Number(state.selectedAssetId));
  const details = state.analytics?.investments?.find(item => Number(item.id) === Number(state.selectedAssetId));
  if (!investment) return closeAssetDetail();

  const records = details?.records || [];
  const balanceEl = document.getElementById('assetDetailBalance');
  if (balanceEl) setMoneyValue(balanceEl, Number(investment.last_net) || 0, investment.last_net !== null && investment.last_net !== undefined);
  const balanceDate = document.getElementById('assetDetailBalanceDate');
  if (balanceDate) balanceDate.textContent = investment.last_date ? `Saldo de ${formatDateBR(investment.last_date)}` : 'Sem saldo registrado';

  const profit = Number(details?.accumulated_net_yield) || 0;
  const invested = (Number(investment.last_net) || 0) - profit;
  const profitEl = document.getElementById('assetDetailProfit');
  if (profitEl) {
    if (records.length > 1) setMoneyValue(profitEl, profit);
    else profitEl.textContent = '—';
    profitEl.classList.toggle('yield-positive', profit >= 0);
    profitEl.classList.toggle('yield-negative', profit < 0);
  }
  const profitPctEl = document.getElementById('assetDetailProfitPct');
  if (profitPctEl) {
    profitPctEl.textContent = records.length > 1 && invested > 0 ? `${formatPct(profit / invested * 100)} acumulado` : 'Aguardando histórico';
    profitPctEl.classList.toggle('yield-positive', profit >= 0);
    profitPctEl.classList.toggle('yield-negative', profit < 0);
  }

  const delivered = Number(details?.delivered_cdi_pct);
  const hasCdi = records.length > 1 && Number.isFinite(delivered);
  const cdiEl = document.getElementById('assetDetailCdi');
  if (cdiEl) cdiEl.textContent = hasCdi ? `${delivered.toFixed(1).replace('.', ',')}% do CDI` : '—';
  const target = Number(investment.target_cdi_pct) || 100;
  const targetEl = document.getElementById('assetDetailCdiTarget');
  if (targetEl) targetEl.textContent = `Meta contratada: ${target}% do CDI`;
  const cdiProgress = document.getElementById('assetDetailCdiProgress');
  if (cdiProgress) cdiProgress.style.width = `${hasCdi ? Math.min(100, Math.max(0, delivered / target * 100)) : 0}%`;

  document.getElementById('assetDetailName').textContent = investment.name;
  document.getElementById('assetDetailSubtitle').textContent = `${investment.institution || 'Geral'} · ${investment.category}`;
  document.getElementById('assetDetailTax').textContent = investment.tax_exempt ? 'Isento de IR' : 'Tributável';
  document.getElementById('assetDetailLiquidity').textContent = investment.liquidity || 'Não informada';
  document.getElementById('assetDetailTarget').textContent = `${target}% do CDI`;
  document.getElementById('assetDetailInstitution').textContent = investment.institution || 'Geral';
  document.getElementById('assetDetailCategory').textContent = investment.category || 'Outros';

  const maturityEl = document.getElementById('assetDetailMaturity');
  if (maturityEl) {
    if (!investment.maturity_date) maturityEl.textContent = 'Sem vencimento';
    else {
      const days = Math.round((new Date(`${investment.maturity_date}T00:00:00Z`) - new Date(`${getTodayString()}T00:00:00Z`)) / 86400000);
      maturityEl.textContent = `${formatDateBR(investment.maturity_date)} · ${days < 0 ? 'vencido' : days === 0 ? 'vence hoje' : days === 1 ? 'amanhã' : `em ${days} dias`}`;
    }
  }

  renderAssetBalanceChart(records);
  const historyList = document.getElementById('assetHistoryRecords');
  if (!records.length) {
    historyList.innerHTML = '<p class="asset-history-empty">Ainda não há saldos registrados para este ativo.</p>';
  } else {
    historyList.innerHTML = records.slice(-10).reverse().map(record => {
      const yieldText = record.has_prev ? formatCurrency(record.daily_net_yield) : 'Saldo inicial';
      const yieldClass = record.has_prev ? (record.daily_net_yield >= 0 ? 'yield-positive' : 'yield-negative') : '';
      const flow = Number(record.contribution) > 0 ? `Aporte ${formatCurrency(record.contribution)}` : Number(record.withdrawal) > 0 ? `Resgate ${formatCurrency(record.withdrawal)}` : 'Sem movimentação';
      return `<div class="asset-history-record"><div><strong>${formatDateBR(record.date)}</strong><small>${flow}</small></div><div><span>Rendimento</span><strong class="${yieldClass}">${yieldText}</strong></div><div><span>Saldo líquido</span><strong>${formatCurrency(record.net_value)}</strong></div></div>`;
    }).join('');
  }
}

function renderAssetBalanceChart(records = []) {
  const canvas = document.getElementById('chartAssetBalance');
  if (!canvas) return;
  const { ctx, width, height } = setupCanvas(canvas);
  ctx.clearRect(0, 0, width, height);
  let points = records;
  if (state.assetHistoryRange !== 'all' && records.length) {
    const cutoff = state.assetHistoryRange === '6m'
      ? addMonthsToDate(getTodayString(), -6)
      : state.assetHistoryRange === '1y'
        ? addMonthsToDate(getTodayString(), -12)
        : addDaysToDate(getTodayString(), -Number(state.assetHistoryRange));
    const anchor = records.filter(record => record.date < cutoff).at(-1);
    points = [...(anchor ? [anchor] : []), ...records.filter(record => record.date >= cutoff)];
  }
  const note = document.getElementById('assetHistoryNote');
  if (!points.length) {
    drawEmptyChartText(ctx, width, height, 'Registre o primeiro saldo para ver o histórico.');
    if (note) note.textContent = 'Saldos líquidos registrados';
    return;
  }
  if (points.length > 42) points = Array.from({ length: 42 }, (_, index) => points[Math.round(index * (points.length - 1) / 41)]);

  const padding = { top: 12, right: 12, bottom: 24, left: 58 };
  const chartW = Math.max(1, width - padding.left - padding.right);
  const chartH = Math.max(1, height - padding.top - padding.bottom);
  const values = points.map(record => Number(record.net_value) || 0);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const spread = rawMax - rawMin || rawMax || 1;
  const min = Math.max(0, rawMin - spread * .12);
  const max = rawMax + spread * .12;
  const range = Math.max(1, max - min);
  const xAt = index => points.length === 1 ? padding.left + chartW / 2 : padding.left + index / (points.length - 1) * chartW;
  const yAt = value => padding.top + (max - value) / range * chartH;
  ctx.font = '10px Manrope, sans-serif';
  ctx.textAlign = 'right';
  for (let tick = 0; tick < 3; tick++) {
    const value = max - range * tick / 2;
    const y = padding.top + chartH * tick / 2;
    ctx.strokeStyle = state.theme === 'dark' ? 'rgba(138,151,173,.12)' : 'rgba(71,85,105,.12)';
    ctx.beginPath(); ctx.moveTo(padding.left, y); ctx.lineTo(width - padding.right, y); ctx.stroke();
    ctx.fillStyle = state.theme === 'dark' ? '#8a97ad' : '#64748b';
    ctx.fillText(`R$ ${new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}`, padding.left - 7, y + 3);
  }
  const baseline = padding.top + chartH;
  ctx.beginPath();
  points.forEach((point, index) => index ? ctx.lineTo(xAt(index), yAt(Number(point.net_value) || 0)) : ctx.moveTo(xAt(index), yAt(Number(point.net_value) || 0)));
  ctx.lineTo(xAt(points.length - 1), baseline); ctx.lineTo(xAt(0), baseline); ctx.closePath();
  const gradient = ctx.createLinearGradient(0, padding.top, 0, baseline);
  gradient.addColorStop(0, 'rgba(91,141,239,.22)'); gradient.addColorStop(1, 'rgba(91,141,239,.01)');
  ctx.fillStyle = gradient; ctx.fill();
  ctx.beginPath();
  points.forEach((point, index) => index ? ctx.lineTo(xAt(index), yAt(Number(point.net_value) || 0)) : ctx.moveTo(xAt(index), yAt(Number(point.net_value) || 0)));
  ctx.strokeStyle = '#5b8def'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
  ctx.beginPath(); ctx.arc(xAt(points.length - 1), yAt(Number(points[points.length - 1].net_value) || 0), 3, 0, Math.PI * 2); ctx.fillStyle = '#82a8f4'; ctx.fill();
  ctx.fillStyle = state.theme === 'dark' ? '#8a97ad' : '#64748b';
  ctx.textAlign = 'left'; ctx.fillText(points[0].date.slice(5).replace('-', '/'), padding.left, height - 5);
  ctx.textAlign = 'right'; ctx.fillText(points[points.length - 1].date.slice(5).replace('-', '/'), width - padding.right, height - 5);

  const tooltip = document.getElementById('assetBalanceTooltip');
  const wrapper = canvas.parentElement;
  canvas.onpointermove = event => {
    if (!tooltip || !points.length) return;
    const rect = canvas.getBoundingClientRect();
    const index = points.length === 1 ? 0 : Math.round(Math.max(0, Math.min(points.length - 1, (event.clientX - rect.left - padding.left) / chartW * (points.length - 1))));
    const point = points[index];
    tooltip.innerHTML = `<strong>${formatDateBR(point.date)}</strong><span>Saldo ${escapeHtml(formatCurrency(point.net_value))}</span>`;
    tooltip.hidden = false;
    const wrapRect = wrapper.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(event.clientX - wrapRect.left + 10, wrapRect.width - 150))}px`;
    tooltip.style.top = `${Math.max(4, event.clientY - wrapRect.top - 52)}px`;
  };
  canvas.onpointerleave = () => { if (tooltip) tooltip.hidden = true; };
  if (note) note.textContent = points.length < 2 ? 'Registre mais saldos para acompanhar a evolução.' : `${points.length} saldos · atualizado em ${formatDateBR(points[points.length - 1].date)}`;
}

function renderCdiComparisonTable(assets) {
  const tbody = document.getElementById('tableCdiComparison');
  if (!assets || assets.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center empty-state">Nenhum ativo com saldo positivo encontrado.</td></tr>`;
    return;
  }

  tbody.innerHTML = assets.map(a => {
    // CDI delivery badge
    const isOk = a.delivered_cdi_pct >= (a.target_cdi_pct || 100);
    const badgeClass = isOk ? 'badge-cdi-ok' : 'badge-cdi-warning';
    const statusText = isOk ? 'Entregando Meta ✅' : 'Abaixo da Meta ⚠️';

    // Maturity badge
    let maturityHtml = '-';
    let prazoHtml = '-';
    if (a.maturity_date) {
      maturityHtml = formatDateBR(a.maturity_date);
      if (a.days_to_maturity < 0) {
        prazoHtml = `<span class="badge-maturity-expired">Vencido</span>`;
      } else if (a.days_to_maturity <= 30) {
        prazoHtml = `<span class="badge-maturity-near">${a.days_to_maturity} dia(s)</span>`;
      } else {
        prazoHtml = `<span class="badge-maturity-ok">${a.days_to_maturity} dias</span>`;
      }
    }

    return `
      <tr data-investment-id="${Number(a.id)}">
        <td><button type="button" class="asset-detail-link" onclick="openAssetFromDashboard(${Number(a.id)})" aria-label="Abrir detalhes de ${escapeHtml(a.name)} na Carteira">${escapeHtml(a.name)}</button></td>
        <td><span class="badge-tag">${escapeHtml(a.institution || 'Geral')}</span></td>
        <td class="mono-num">${formatCurrency(a.net_value)}</td>
        <td class="mono-num">${a.target_cdi_pct || 100}% CDI</td>
        <td class="mono-num font-bold">
          <span class="${badgeClass}">${a.delivered_cdi_pct.toFixed(1).replace('.', ',')}% do CDI</span>
        </td>
        <td><small class="${isOk ? 'yield-positive' : 'yield-negative'}">${statusText}</small></td>
        <td><span class="badge-tag">${escapeHtml(a.liquidity || 'Diária')}</span></td>
        <td>${maturityHtml}</td>
        <td>${prazoHtml}</td>
      </tr>
    `;
  }).join('');
}

function renderRecentTable(records) {
  const tbody = document.getElementById('tableRecentRecords');
  if (!records || records.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="text-center empty-state">
          Nenhum registro cadastrado ainda.<br><br>
          <button class="btn btn-primary btn-sm" onclick="switchTab('quick-entry')">
            Fazer Primeiro Lançamento
          </button>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = records.slice(0, 15).map(r => {
    const grossYieldClass = r.daily_gross_yield > 0 ? 'yield-positive' : (r.daily_gross_yield < 0 ? 'yield-negative' : 'yield-neutral');
    const netYieldClass = r.daily_net_yield > 0 ? 'yield-positive' : (r.daily_net_yield < 0 ? 'yield-negative' : 'yield-neutral');
    const daysLabel = r.days_diff > 1 ? ` (${r.days_diff}d)` : '';

    let movementText = '-';
    if (r.contribution > 0) movementText = `<span style="color:var(--emerald);">+${formatCurrency(r.contribution)}</span>`;
    if (r.withdrawal > 0) movementText = `<span style="color:var(--rose);">-${formatCurrency(r.withdrawal)}</span>`;

    return `
      <tr>
        <td><strong>${formatDateBR(r.date)}</strong>${daysLabel}</td>
        <td><span class="badge-tag">${escapeHtml(r.investment_name)}</span></td>
        <td class="mono-num">${formatCurrency(r.gross_value)}</td>
        <td class="mono-num">${formatCurrency(r.net_value)}</td>
        <td class="mono-num ${grossYieldClass}">${r.has_prev ? formatCurrency(r.daily_gross_yield) : '<span class="text-muted">Início</span>'}</td>
        <td class="mono-num ${netYieldClass}">${r.has_prev ? formatCurrency(r.daily_net_yield) : '<span class="text-muted">Início</span>'}</td>
        <td class="mono-num ${netYieldClass}">${r.has_prev ? formatPct(r.daily_net_pct) : '-'}</td>
        <td class="mono-num">${movementText}</td>
        <td class="mono-num text-muted">${formatCurrency(r.tax_amount)}</td>
        <td>
          <button class="btn-danger-sm" onclick="deleteRecord(${r.id})" title="Excluir">Excluir</button>
        </td>
      </tr>
    `;
  }).join('');
}

// ========================================================
// GRÁFICOS NATIVOS EM CANVAS (ZERO DEPENDÊNCIAS)
// ========================================================
function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return { ctx, width: rect.width, height: rect.height };
}

function renderDailyYieldChart(timeline) {
  const canvas = document.getElementById('chartDailyYield');
  if (!canvas) return;
  const { ctx, width, height } = setupCanvas(canvas);

  ctx.clearRect(0, 0, width, height);

  if (!timeline || timeline.length === 0) {
    drawEmptyChartText(ctx, width, height, 'Registre o primeiro saldo pra ver o gráfico.');
    return;
  }

  const data = timeline.slice(-15);
  const padding = { top: 20, right: 20, bottom: 30, left: 60 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  let maxVal = 0;
  let minVal = 0;
  data.forEach(d => {
    if (d.daily_gross_yield > maxVal) maxVal = d.daily_gross_yield;
    if (d.daily_gross_yield < minVal) minVal = d.daily_gross_yield;
    if (d.daily_net_yield > maxVal) maxVal = d.daily_net_yield;
    if (d.daily_net_yield < minVal) minVal = d.daily_net_yield;
  });

  if (maxVal === 0 && minVal === 0) maxVal = 10;
  maxVal = maxVal * 1.2;
  const range = (maxVal - minVal) || 1;
  const zeroY = padding.top + chartH - ((0 - minVal) / range) * chartH;

  ctx.strokeStyle = state.theme === 'dark' ? '#1f2937' : '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, zeroY);
  ctx.lineTo(width - padding.right, zeroY);
  ctx.stroke();

  const barGroupWidth = chartW / data.length;
  const barWidth = Math.min(20, (barGroupWidth - 8) / 2);

  data.forEach((d, i) => {
    const xCenter = padding.left + i * barGroupWidth + barGroupWidth / 2;

    // Gross Bar (Blue)
    const grossH = (d.daily_gross_yield / range) * chartH;
    const grossY = zeroY - (grossH >= 0 ? grossH : 0);
    ctx.fillStyle = '#5b8def';
    ctx.fillRect(xCenter - barWidth - 1, grossH >= 0 ? grossY : zeroY, barWidth, Math.max(1, Math.abs(grossH)));

    // Net Bar (Emerald)
    const netH = (d.daily_net_yield / range) * chartH;
    const netY = zeroY - (netH >= 0 ? netH : 0);
    ctx.fillStyle = d.daily_net_yield >= 0 ? '#96b3e8' : '#d47782';
    ctx.fillRect(xCenter + 1, netH >= 0 ? netY : zeroY, barWidth, Math.max(1, Math.abs(netH)));

    ctx.fillStyle = state.theme === 'dark' ? '#6b7280' : '#9ca3af';
    ctx.font = '10px Manrope, sans-serif';
    ctx.textAlign = 'center';
    const dayMonth = d.date.slice(5).replace('-', '/');
    ctx.fillText(dayMonth, xCenter, height - 10);
  });

  ctx.fillStyle = state.theme === 'dark' ? '#6b7280' : '#9ca3af';
  ctx.font = '10px Manrope, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(formatCurrency(maxVal), padding.left - 8, padding.top + 8);
  ctx.fillText(formatCurrency(0), padding.left - 8, zeroY + 3);

  const tooltip = document.getElementById('chartDailyTooltip');
  const chartWrap = canvas.parentElement;
  canvas.onpointermove = (event) => {
    if (!tooltip || !data.length) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const index = Math.max(0, Math.min(data.length - 1, Math.floor((x - padding.left) / barGroupWidth)));
    const item = data[index];
    tooltip.innerHTML = `<strong>${escapeHtml(formatRelativeDate(item.date))}</strong><span>Bruto ${escapeHtml(formatCurrency(item.daily_gross_yield))}</span><span>Líquido ${escapeHtml(formatCurrency(item.daily_net_yield))}</span>`;
    tooltip.hidden = false;
    const wrapRect = chartWrap.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(event.clientX - wrapRect.left + 10, wrapRect.width - 150))}px`;
    tooltip.style.top = `${Math.max(4, event.clientY - wrapRect.top - 58)}px`;
  };
  canvas.onpointerleave = () => { if (tooltip) tooltip.hidden = true; };
}

// Donut / Pie Chart for Asset & Category Allocation
function renderAllocationPieChart() {
  const bar = document.getElementById('chartAllocationBar');
  const legendEl = document.getElementById('pieLegendList');
  if (!bar || !legendEl) return;
  const allocs = state.analytics?.allocations || { categories: [], assets: [] };
  const items = state.pieMode === 'category' ? (allocs.categories || []) : (allocs.assets || []);
  bar.innerHTML = '';
  if (!items.length) {
    legendEl.innerHTML = '<span class="text-muted">Registre o primeiro saldo pra ver a carteira.</span>';
    return;
  }
  let legendHtml = '';
  items.forEach((item, i) => {
    const color = CHART_COLORS[i % CHART_COLORS.length];
    const pct = Math.max(0, Math.min(100, Number(item.pct_of_total) || 0));
    const segment = document.createElement('span');
    segment.className = 'allocation-segment';
    segment.style.width = `${pct}%`;
    segment.style.backgroundColor = color;
    segment.title = `${item.name}: ${pct.toFixed(1).replace('.', ',')}%`;
    segment.setAttribute('aria-label', segment.title);
    bar.appendChild(segment);
    const valDisplay = formatCurrency(item.value || item.net_value);
    legendHtml += `
      <div class="pie-legend-item">
        <div class="pie-legend-left">
          <span class="pie-legend-color" style="background-color: ${color};"></span>
          <span title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
        </div>
        <div class="pie-legend-right">
          <span>${pct.toFixed(1).replace('.', ',')}%</span>
          <small class="currency-sensitive">(${valDisplay})</small>
        </div>
      </div>`;
  });
  legendEl.innerHTML = legendHtml;
}
function drawEmptyChartText(ctx, width, height, text) {
  ctx.fillStyle = state.theme === 'dark' ? '#6b7280' : '#9ca3af';
  ctx.font = '12px Manrope, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, width / 2, height / 2);
}

// ========================================================
// QUICK ENTRY (LANÇAMENTO RÁPIDO DO DIA)
// ========================================================
async function loadQuickEntryRows() {
  await fetchInvestments();
  const dateInput = document.getElementById('quickEntryDate');
  if (!dateInput.value) {
    dateInput.value = getTodayString();
  }

  const container = document.getElementById('quickEntryContainer');

  if (state.investments.length === 0) {
    container.innerHTML = `
      <div class="empty-state text-center">
        <p>Você ainda não tem ativos cadastrados.</p>
        <button class="btn btn-primary" style="margin-top: 1rem;" onclick="openInvestmentModal()">
          + Cadastrar Primeiro Ativo
        </button>
      </div>
    `;
    return;
  }

  const targetDate = dateInput.value;
  const existingRecordsRes = await fetch(`/api/records`);
  const allRecords = await existingRecordsRes.json();
  const recordsOnDate = {};
  for (const r of allRecords) {
    if (r.date === targetDate) {
      recordsOnDate[r.investment_id] = r;
    }
  }

  container.innerHTML = state.investments.map(inv => {
    const existing = recordsOnDate[inv.id];
    const prevGross = inv.last_gross !== null ? inv.last_gross : null;
    const prevNet = inv.last_net !== null ? inv.last_net : null;
    const taxExempt = Boolean(inv.tax_exempt);
    const lastDate = inv.last_date ? formatDateBR(inv.last_date) : 'Novo';

    const defaultGross = existing ? (taxExempt ? existing.net_value : existing.gross_value) : '';
    const defaultNet = existing ? existing.net_value : '';
    const defaultCont = existing ? (existing.contribution || '') : '';
    const previousValue = taxExempt ? prevNet : prevGross;

    return `
      <div class="quick-row" data-inv-id="${inv.id}" data-prev-gross="${previousValue || 0}" data-prev-net="${prevNet || 0}" data-tax-exempt="${taxExempt}">
        <div class="quick-inv-info">
          <h4>${escapeHtml(inv.name)}</h4>
          <span>${escapeHtml(inv.institution || 'Geral')} • ${escapeHtml(inv.category)} • ${taxExempt ? 'Isento de IR' : `Meta: ${inv.target_cdi_pct || 100}% CDI`}</span>
          <div class="quick-inv-prev">
            Anterior: <strong>${previousValue !== null ? formatCurrency(previousValue) : 'Sem registro'}</strong> (${lastDate})
          </div>
        </div>

        ${taxExempt ? `
          <div class="quick-input-col exempt-value-col">
            <label>Saldo líquido = bruto (R$)</label>
            <input type="number" step="0.01" class="form-control input-net" placeholder="${prevNet !== null ? prevNet.toFixed(2) : '0.00'}" value="${defaultNet}" oninput="calcQuickRowYield(this)" />
            <input type="hidden" class="input-gross" value="${defaultGross}" />
          </div>
        ` : `
          <div class="quick-input-col">
            <label>Valor Bruto (R$)</label>
            <input type="number" step="0.01" class="form-control input-gross" placeholder="${prevGross !== null ? prevGross.toFixed(2) : '0.00'}" value="${defaultGross}" oninput="calcQuickRowYield(this)" />
          </div>
          <div class="quick-input-col">
            <label>Valor Líquido (R$)</label>
            <input type="number" step="0.01" class="form-control input-net" placeholder="${prevNet !== null ? prevNet.toFixed(2) : '0.00'}" value="${defaultNet}" oninput="calcQuickRowYield(this)" />
          </div>
        `}

        <div class="quick-input-col">
          <label>Aporte Extra (R$)</label>
          <input type="number" step="0.01" class="form-control input-contrib" placeholder="0.00" value="${defaultCont}" oninput="calcQuickRowYield(this)" title="Não é contado como lucro" />
        </div>

        <div class="quick-calculated-col">
          <span class="form-help">Rend. Real</span>
          <div class="quick-yield-display">-</div>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.input-gross').forEach(input => {
    if (input.value) calcQuickRowYield(input);
  });
}

function calcQuickRowYield(el) {
  const row = el.closest('.quick-row');
  const prevGross = parseFloat(row.dataset.prevGross) || 0;
  const prevNet = parseFloat(row.dataset.prevNet) || 0;

  const currentNet = parseFloat(row.querySelector('.input-net').value);
  const grossInput = row.querySelector('.input-gross');
  const currentGross = row.dataset.taxExempt === 'true' ? currentNet : parseFloat(grossInput.value);
  if (row.dataset.taxExempt === 'true' && !isNaN(currentNet)) grossInput.value = currentNet;
  const contrib = parseFloat(row.querySelector('.input-contrib').value) || 0;
  const display = row.querySelector('.quick-yield-display');

  if (isNaN(currentGross) || isNaN(currentNet) || prevGross === 0) {
    display.innerHTML = `<span class="text-muted">-</span>`;
    return;
  }

  // Desconta aporte para não contar depósito como lucro
  const netYield = currentNet - prevNet - contrib;
  const pct = (prevGross + contrib) > 0 ? (netYield / (prevGross + contrib)) * 100 : 0;

  const colorClass = netYield >= 0 ? 'yield-positive' : 'yield-negative';
  display.innerHTML = `
    <span class="${colorClass}">${formatCurrency(netYield)}</span>
    <br><small class="${colorClass}">${formatPct(pct)}</small>
  `;
}

async function saveQuickBatch() {
  const dateInput = document.getElementById('quickEntryDate');
  const date = dateInput.value;
  if (!date) {
    showToast('Selecione uma data para o lançamento.', 'error');
    return;
  }

  const rows = document.querySelectorAll('.quick-row');
  const entries = [];

  rows.forEach(row => {
    const invId = parseInt(row.dataset.invId, 10);
    const netVal = row.querySelector('.input-net').value;
    const grossVal = row.dataset.taxExempt === 'true' ? netVal : row.querySelector('.input-gross').value;
    const contribVal = row.querySelector('.input-contrib').value;

    if (grossVal !== '' && netVal !== '') {
      entries.push({
        investment_id: invId,
        gross_value: parseFloat(grossVal),
        net_value: parseFloat(netVal),
        contribution: parseFloat(contribVal) || 0,
        withdrawal: 0
      });
    }
  });

  if (entries.length === 0) {
    showToast('Preencha o valor Bruto e Líquido de pelo menos um ativo.', 'error');
    return;
  }

  try {
    const res = await fetch('/api/records/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, entries })
    });
    const result = await res.json();

    if (result.success) {
      showToast(`${result.count} lançamentos salvos com sucesso!`);
      switchTab('dashboard');
    } else {
      showToast(result.error || 'Erro ao salvar.', 'error');
    }
  } catch (err) {
    showToast('Erro de conexão ao salvar.', 'error');
  }
}

// ========================================================
// IMPORTAÇÃO BANCO INTER
// ========================================================
function parseInterText(rawText) {
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const items = [];
  const today = getTodayString();

  for (const line of lines) {
    const parts = line.split(/[;\t]/).map(p => p.trim());

    if (parts.length >= 3) {
      const name = parts[0];
      const grossStr = parts[1].replace(/R\$\s?/g, '').replace(/\./g, '').replace(',', '.').trim();
      const netStr = parts[2].replace(/R\$\s?/g, '').replace(/\./g, '').replace(',', '.').trim();

      const gross = parseFloat(grossStr);
      const net = parseFloat(netStr);

      if (!isNaN(gross) && !isNaN(net)) {
        let category = 'Renda Fixa';
        let targetCdi = 100;
        const upper = name.toUpperCase();
        if (upper.includes('102%')) targetCdi = 102;
        if (upper.includes('100%')) targetCdi = 100;
        if (upper.includes('CDB')) category = 'CDB / RDB';
        else if (upper.includes('LCI') || upper.includes('LCA')) category = 'LCI / LCA';
        else if (upper.includes('TESOURO')) category = 'Tesouro Direto';

        items.push({
          name: name,
          institution: 'Banco Inter',
          category: category,
          target_cdi_pct: targetCdi,
          gross_value: gross,
          net_value: net,
          date: today
        });
      }
    }
  }
  return items;
}

function displayInterPreview(items) {
  state.parsedInterData = items;
  const container = document.getElementById('interPreviewContainer');
  const tbody = document.getElementById('interPreviewTableBody');

  if (items.length === 0) {
    showToast('Nenhum ativo reconhecido no formato esperado.', 'error');
    container.classList.add('hidden');
    return;
  }

  tbody.innerHTML = items.map(item => `
    <tr>
      <td><strong>${escapeHtml(item.name)}</strong></td>
      <td><span class="badge-tag">${escapeHtml(item.institution)}</span></td>
      <td>${escapeHtml(item.category)}</td>
      <td class="mono-num">${formatCurrency(item.gross_value)}</td>
      <td class="mono-num">${formatCurrency(item.net_value)}</td>
      <td>${formatDateBR(item.date)}</td>
    </tr>
  `).join('');

  container.classList.remove('hidden');
  showToast(`${items.length} ativo(s) identificado(s)!`);
}

async function confirmInterImport() {
  if (state.parsedInterData.length === 0) return;

  try {
    await fetchInvestments();
    const existingMap = {};
    state.investments.forEach(inv => {
      existingMap[inv.name.trim().toLowerCase()] = inv.id;
    });

    const entriesToBatch = [];
    const today = getTodayString();

    for (const item of state.parsedInterData) {
      let invId = existingMap[item.name.trim().toLowerCase()];

      if (!invId) {
        const res = await fetch('/api/investments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: item.name,
            institution: item.institution || 'Banco Inter',
            category: item.category || 'Renda Fixa',
            target_cdi_pct: item.target_cdi_pct || 100
          })
        });
        const created = await res.json();
        invId = created.id;
        existingMap[item.name.trim().toLowerCase()] = invId;
      }

      entriesToBatch.push({
        investment_id: invId,
        gross_value: item.gross_value,
        net_value: item.net_value,
        contribution: 0,
        withdrawal: 0
      });
    }

    const batchRes = await fetch('/api/records/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: today, entries: entriesToBatch })
    });
    const batchData = await batchRes.json();

    if (batchData.success) {
      showToast(`${batchData.count} ativos do Inter atualizados com sucesso!`);
      document.getElementById('interPreviewContainer').classList.add('hidden');
      document.getElementById('interPasteText').value = '';
      switchTab('dashboard');
    }
  } catch (err) {
    showToast('Erro ao importar informe do Inter.', 'error');
  }
}

// ========================================================
// DETAILED HISTORY
// ========================================================
async function loadFullHistory() {
  loadMovements();
  const invSelect = document.getElementById('historyFilterInv');
  const invId = invSelect.value;
  const analytics = await fetchAnalytics(invId);

  const tbody = document.getElementById('tableFullHistory');
  if (!analytics || !analytics.recent_records || analytics.recent_records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="text-center empty-state">Nenhum lançamento encontrado.</td></tr>`;
    return;
  }

  tbody.innerHTML = analytics.recent_records.map(r => {
    const grossYieldClass = r.daily_gross_yield > 0 ? 'yield-positive' : (r.daily_gross_yield < 0 ? 'yield-negative' : 'yield-neutral');
    const netYieldClass = r.daily_net_yield > 0 ? 'yield-positive' : (r.daily_net_yield < 0 ? 'yield-negative' : 'yield-neutral');

    let movementText = '-';
    if (r.contribution > 0) movementText = `<span style="color:var(--emerald);">+${formatCurrency(r.contribution)}</span>`;
    if (r.withdrawal > 0) movementText = `<span style="color:var(--rose);">-${formatCurrency(r.withdrawal)}</span>`;

    return `
      <tr>
        <td><strong>${formatDateBR(r.date)}</strong></td>
        <td><span class="badge-tag">${escapeHtml(r.investment_name)}</span></td>
        <td class="mono-num">${formatCurrency(r.gross_value)}</td>
        <td class="mono-num">${formatCurrency(r.net_value)}</td>
        <td class="mono-num ${grossYieldClass}">${r.has_prev ? formatCurrency(r.daily_gross_yield) : '<span class="text-muted">Início</span>'}</td>
        <td class="mono-num ${netYieldClass}">${r.has_prev ? formatCurrency(r.daily_net_yield) : '<span class="text-muted">Início</span>'}</td>
        <td class="mono-num ${netYieldClass}">${r.has_prev ? formatPct(r.daily_net_pct) : '-'}</td>
        <td class="mono-num">${movementText}</td>
        <td class="mono-num text-muted">${formatCurrency(r.tax_amount)}</td>
        <td style="max-width: 150px; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(r.notes || '-')}</td>
        <td>
          <button class="btn-danger-sm" onclick="deleteRecord(${r.id})">Excluir</button>
        </td>
      </tr>
    `;
  }).join('');
}

async function deleteRecord(id) {
  if (!confirm('Deseja realmente excluir este lançamento?')) return;

  try {
    const res = await fetch(`/api/records/${id}`, { method: 'DELETE' });
    const result = await res.json();
    if (result.success) {
      showToast('Lançamento excluído com sucesso.');
      if (state.currentTab === 'dashboard') loadDashboardData();
      else if (state.currentTab === 'history') loadFullHistory();
    }
  } catch (err) {
    showToast('Erro ao excluir lançamento.', 'error');
  }
}

// ========================================================
// ATIVOS E VENCIMENTOS
// ========================================================
async function renderInvestmentsCards() {
  await fetchInvestments();
  await fetchAnalytics('');
  renderWalletPortfolio();
  renderWalletConcentration();
  renderMaturitySchedule();
  renderDashboardFreshness();
  const container = document.getElementById('investmentsCardsContainer');

  if (state.investments.length === 0) {
    container.innerHTML = `
      <div class="empty-state text-center" style="grid-column: 1 / -1;">
        <p>Nenhum ativo cadastrado ainda.</p>
        <button class="btn btn-primary" style="margin-top: 1rem;" onclick="openInvestmentModal()">
          + Cadastrar Primeiro Ativo
        </button>
      </div>
    `;
    return;
  }

  const detailsById = new Map((state.analytics?.investments || []).map(item => [Number(item.id), item]));
  const listCount = document.getElementById('walletListCount');
  if (listCount) listCount.textContent = `${state.investments.length} ${state.investments.length === 1 ? 'ativo' : 'ativos'}`;

  const renderAssetCard = inv => {
    const details = detailsById.get(Number(inv.id));
    const freshness = getBalanceFreshness(inv.last_date);
    const freshnessLabel = inv.last_date
      ? `Saldo de ${formatDateBR(inv.last_date)} · ${freshness.label.replace('Saldo registrado ', '')}`
      : freshness.label;
    const accumulatedYield = Number(details?.accumulated_net_yield) || 0;
    const investedBase = Number(inv.last_net) - accumulatedYield;
    const returnPct = investedBase > 0 ? accumulatedYield / investedBase * 100 : 0;
    const returnClass = accumulatedYield >= 0 ? 'yield-positive' : 'yield-negative';
    const hasReturn = (details?.records?.length || 0) > 1;
    let maturityText = 'Sem vencimento';
    let maturitySubtext = escapeHtml(inv.liquidity || 'Liquidez não informada');
    if (inv.maturity_date) {
      const days = Math.round((new Date(`${inv.maturity_date}T00:00:00Z`) - new Date(`${getTodayString()}T00:00:00Z`)) / 86400000);
      maturityText = formatDateBR(inv.maturity_date);
      maturitySubtext = days < 0 ? 'Vencido' : days === 0 ? 'Vence hoje' : days === 1 ? 'Vence amanhã' : `Vence em ${days} dias`;
    }

    return `
      <article class="inv-card wallet-asset-row">
        <button type="button" class="wallet-asset-identity" onclick="openAssetDetail(${inv.id})" aria-label="Ver detalhes de ${escapeHtml(inv.name)}">
          <span class="wallet-asset-mark"><img src="/brand/svg/lastro-symbol-color.svg" alt=""></span>
          <div class="wallet-asset-copy">
            <h3>${escapeHtml(inv.name)}</h3>
            <span>${escapeHtml(inv.institution || 'Geral')} · ${escapeHtml(inv.category)}</span>
            <div class="wallet-asset-tags">
              <span>${inv.target_cdi_pct || 100}% CDI</span>
              ${inv.tax_exempt ? '<span>Isento de IR</span>' : ''}
              <span>${escapeHtml(inv.liquidity || 'Liquidez não informada')}</span>
            </div>
          </div>
          <svg class="wallet-asset-chevron" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>
        </button>
        <div class="wallet-asset-value">
          <span>Saldo líquido</span>
          <strong class="currency-sensitive">${inv.last_net !== null ? formatCurrency(inv.last_net) : 'Sem saldo'}</strong>
          ${hasReturn ? `<small class="${returnClass}">${formatCurrency(accumulatedYield)} · ${formatPct(returnPct)}</small>` : '<small class="text-muted">Sem variação registrada</small>'}
        </div>
        <div class="wallet-asset-maturity">
          <span>Vencimento</span>
          <strong>${maturityText}</strong>
          <small>${maturitySubtext}</small>
        </div>
        <div class="wallet-asset-actions">
          <button class="btn btn-secondary btn-sm" onclick="openAssetDetail(${inv.id})" aria-label="Detalhes de ${escapeHtml(inv.name)}">Detalhes</button>
          <button class="btn btn-secondary btn-sm" onclick="editInvestment(${JSON.stringify(inv).replace(/"/g, '&quot;')})" aria-label="Editar ${escapeHtml(inv.name)}">Editar</button>
          <button class="btn-danger-sm" onclick="deleteInvestment(${inv.id})" title="Excluir ativo" aria-label="Excluir ${escapeHtml(inv.name)}">
            <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M5 7l1 14h12l1-14M9 7V4h6v3"></path></svg>
          </button>
        </div>
        <div class="inv-card-freshness ${freshness.stale ? 'is-stale' : ''}">
          <span class="freshness-dot" aria-hidden="true"></span>${escapeHtml(freshnessLabel)}
          <span class="wallet-record-count">${inv.records_count || 0} ${inv.records_count === 1 ? 'registro' : 'registros'}</span>
        </div>
      </article>
    `;
  };

  if (!state.groupWalletByInstitution) {
    container.innerHTML = state.investments.map(renderAssetCard).join('');
  } else {
    const groups = new Map();
    state.investments.forEach(investment => {
      const institution = String(investment.institution || '').trim() || 'Sem instituição';
      const key = institution.toLocaleLowerCase('pt-BR');
      if (!groups.has(key)) groups.set(key, { name: institution, investments: [] });
      groups.get(key).investments.push(investment);
    });
    container.innerHTML = [...groups.values()]
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      .map(group => {
        const total = group.investments.reduce((sum, investment) => sum + (Number(investment.last_net) || 0), 0);
        const count = group.investments.length;
        return `<section class="wallet-institution-group" aria-label="Ativos em ${escapeHtml(group.name)}">
          <header class="wallet-institution-heading">
            <div><h4>${escapeHtml(group.name)}</h4><span>${count} ${count === 1 ? 'ativo' : 'ativos'}</span></div>
            <div><small>Total na instituição</small><strong class="currency-sensitive">${formatCurrency(total)}</strong></div>
          </header>
          ${group.investments.map(renderAssetCard).join('')}
        </section>`;
      }).join('');
  }
  if (state.selectedAssetId) renderAssetDetail();
}

function openInvestmentModal() {
  document.getElementById('modalInvTitle').textContent = 'Novo Ativo';
  document.getElementById('invId').value = '';
  document.getElementById('invName').value = '';
  document.getElementById('invInstitution').value = '';
  document.getElementById('invCategory').value = 'CDB / RDB';
  document.getElementById('invTargetCdi').value = '100';
  document.getElementById('invLiquidity').value = 'Diária';
  document.getElementById('invMaturityDate').value = '';
  document.getElementById('invNotes').value = '';
  document.getElementById('invTaxExempt').checked = false;
  document.getElementById('modalInvestment').classList.remove('hidden');
}

function editInvestment(inv) {
  document.getElementById('modalInvTitle').textContent = 'Editar Ativo';
  document.getElementById('invId').value = inv.id;
  document.getElementById('invName').value = inv.name;
  document.getElementById('invInstitution').value = inv.institution || '';
  document.getElementById('invCategory').value = inv.category || 'CDB / RDB';
  document.getElementById('invTargetCdi').value = inv.target_cdi_pct || 100;
  document.getElementById('invLiquidity').value = inv.liquidity || 'Diária';
  document.getElementById('invMaturityDate').value = inv.maturity_date || '';
  document.getElementById('invNotes').value = inv.notes || '';
  document.getElementById('invTaxExempt').checked = Boolean(inv.tax_exempt);
  document.getElementById('modalInvestment').classList.remove('hidden');
}

function closeInvestmentModal() {
  document.getElementById('modalInvestment').classList.add('hidden');
}

async function handleInvestmentSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('invId').value;
  const name = document.getElementById('invName').value.trim();
  const institution = document.getElementById('invInstitution').value.trim();
  const category = document.getElementById('invCategory').value;
  const target_cdi_pct = parseFloat(document.getElementById('invTargetCdi').value) || 100;
  const liquidity = document.getElementById('invLiquidity').value;
  const maturity_date = document.getElementById('invMaturityDate').value;
  const notes = document.getElementById('invNotes').value.trim();
  const tax_exempt = document.getElementById('invTaxExempt').checked;

  if (!name) return;

  try {
    const res = await fetch('/api/investments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: id ? parseInt(id, 10) : undefined,
        name,
        institution,
        category,
        target_cdi_pct,
        liquidity,
        tax_exempt,
        maturity_date,
        notes
      })
    });
    const result = await res.json();
    if (result.success) {
      showToast('Ativo salvo com sucesso!');
      closeInvestmentModal();
      await fetchInvestments();
      if (state.currentTab === 'investments') renderInvestmentsCards();
      else if (state.currentTab === 'dashboard') loadDashboardData();
    } else {
      showToast(result.error || 'Erro ao salvar.', 'error');
    }
  } catch (err) {
    showToast('Erro ao salvar ativo.', 'error');
  }
}

async function deleteInvestment(id) {
  if (!confirm('Tem certeza? Isso apagará este investimento e todos os seus lançamentos diários!')) return;

  try {
    const res = await fetch(`/api/investments/${id}`, { method: 'DELETE' });
    const result = await res.json();
    if (result.success) {
      showToast('Ativo excluído.');
      renderInvestmentsCards();
      fetchInvestments();
    }
  } catch (err) {
    showToast('Erro ao excluir ativo.', 'error');
  }
}

// Single Entry Modal
function openSingleEntryModal() {
  populateInvestmentSelects();
  document.getElementById('singleEntryDate').value = getTodayString();
  document.getElementById('singleEntryGross').value = '';
  document.getElementById('singleEntryNet').value = '';
  document.getElementById('singleEntryContribution').value = '';
  document.getElementById('singleEntryWithdrawal').value = '';
  document.getElementById('singleEntryNotes').value = '';
  updateSingleEntryTaxMode();
  document.getElementById('modalSingleEntry').classList.remove('hidden');
}

function updateSingleEntryTaxMode() {
  const investmentId = Number(document.getElementById('singleEntryInv').value);
  const investment = state.investments.find(item => Number(item.id) === investmentId);
  const exempt = Boolean(investment?.tax_exempt);
  const grossGroup = document.getElementById('singleEntryGrossGroup');
  const grossInput = document.getElementById('singleEntryGross');
  const netLabel = document.querySelector('label[for="singleEntryNet"]');
  if (!grossGroup || !grossInput || !netLabel) return;
  grossGroup.hidden = exempt;
  grossInput.required = !exempt;
  netLabel.textContent = exempt ? 'Valor Líquido = Bruto (R$) *' : 'Valor Líquido (R$) *';
  if (exempt) grossInput.value = document.getElementById('singleEntryNet').value;
}

function closeSingleEntryModal() {
  document.getElementById('modalSingleEntry').classList.add('hidden');
}

async function handleSingleEntrySubmit(e) {
  e.preventDefault();
  const investment_id = parseInt(document.getElementById('singleEntryInv').value, 10);
  const date = document.getElementById('singleEntryDate').value;
  const net_value = parseFloat(document.getElementById('singleEntryNet').value);
  const selectedInvestment = state.investments.find(item => Number(item.id) === investment_id);
  const gross_value = selectedInvestment?.tax_exempt ? net_value : parseFloat(document.getElementById('singleEntryGross').value);
  const contribution = parseFloat(document.getElementById('singleEntryContribution').value) || 0;
  const withdrawal = parseFloat(document.getElementById('singleEntryWithdrawal').value) || 0;
  const notes = document.getElementById('singleEntryNotes').value.trim();

  try {
    const res = await fetch('/api/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ investment_id, date, gross_value, net_value, contribution, withdrawal, notes })
    });
    const result = await res.json();
    if (result.success) {
      showToast('Lançamento salvo!');
      closeSingleEntryModal();
      if (state.currentTab === 'history') loadFullHistory();
      else loadDashboardData();
    } else {
      showToast(result.error || 'Erro ao salvar.', 'error');
    }
  } catch (err) {
    showToast('Erro ao salvar lançamento.', 'error');
  }
}

// Settings Modal
async function openSettingsModal() {
  let goal = 100000;
  let cdi = 10.75;

  if (state.analytics && state.analytics.summary) {
    goal = state.analytics.summary.patrimony_goal || goal;
    cdi = state.analytics.summary.annual_cdi_rate || cdi;
  }

  const goalInput = document.getElementById('settingPatrimonyGoal');
  const cdiInput = document.getElementById('settingCdiRate');
  if (goalInput) goalInput.value = goal;
  if (cdiInput) cdiInput.value = cdi;

  const modal = document.getElementById('modalSettings');
  if (modal) modal.classList.remove('hidden');

  try {
    const res = await fetch('/api/settings');
    const settings = await res.json();
    if (settings.patrimony_goal && goalInput) goalInput.value = settings.patrimony_goal;
    if (settings.annual_cdi_rate && cdiInput) cdiInput.value = settings.annual_cdi_rate;
  } catch (err) {}
}

function closeSettingsModal() {
  document.getElementById('modalSettings').classList.add('hidden');
}

async function handleSettingsSubmit(e) {
  e.preventDefault();
  const patrimony_goal = parseFloat(document.getElementById('settingPatrimonyGoal').value);
  const annual_cdi_rate = parseFloat(document.getElementById('settingCdiRate').value);

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patrimony_goal, annual_cdi_rate })
    });
    const result = await res.json();
    if (result.success) {
      showToast('Configurações salvas!');
      closeSettingsModal();
      loadDashboardData();
    }
  } catch (err) {
    showToast('Erro ao salvar configurações.', 'error');
  }
}

function populateInvestmentSelects() {
  const selects = [
    document.getElementById('filterInvestment'),
    document.getElementById('historyFilterInv'),
    document.getElementById('singleEntryInv'),
    document.getElementById('movementInvestment'),
    document.getElementById('calendarInvestment')
  ];

  selects.forEach(sel => {
    if (!sel) return;
    const isFilter = sel.id.startsWith('filter') || sel.id.startsWith('history');
    const currentVal = sel.value;

    let html = isFilter ? '<option value="">Todos os ativos</option>' : '';
    html += state.investments.map(i => `<option value="${i.id}">${escapeHtml(i.name)} (${escapeHtml(i.institution || 'Geral')})</option>`).join('');

    sel.innerHTML = html;
    if (currentVal) sel.value = currentVal;
  });
}

// Demo data
async function loadDemoData() {
  if (!confirm('Deseja carregar dados de exemplo com CDB Inter 102%, Tesouro Selic e LCI IPCA?')) return;

  const demoInvestments = [
    { name: 'CDB Inter 102% CDI', institution: 'Banco Inter', category: 'CDB / RDB', target_cdi_pct: 102, liquidity: 'Diária', maturity_date: '2027-10-15' },
    { name: 'Tesouro Selic 2029', institution: 'Tesouro Direto', category: 'Tesouro Direto', target_cdi_pct: 100, liquidity: 'D+1', maturity_date: '2029-03-01' },
    { name: 'LCI IPCA 2 Anos', institution: 'Banco Inter', category: 'LCI / LCA', target_cdi_pct: 95, liquidity: 'No Vencimento', maturity_date: '2026-11-25' }
  ];

  for (const inv of demoInvestments) {
    const res = await fetch('/api/investments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inv)
    });
    const data = await res.json();
    inv.id = data.id;
  }

  const now = new Date();
  const demoRecords = [];

  for (let i = 4; i >= 0; i--) {
    const d = new Date();
    d.setDate(now.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const dayFactor = (4 - i);

    demoRecords.push({
      date: dateStr,
      entries: [
        { investment_id: demoInvestments[0].id, gross_value: 25000 + dayFactor * 12.50, net_value: 25000 + dayFactor * 9.70, contribution: i === 4 ? 25000 : 0 },
        { investment_id: demoInvestments[1].id, gross_value: 30000 + dayFactor * 14.80, net_value: 30000 + dayFactor * 11.50, contribution: i === 4 ? 30000 : 0 },
        { investment_id: demoInvestments[2].id, gross_value: 15000 + dayFactor * 7.90, net_value: 15000 + dayFactor * 7.90, contribution: i === 4 ? 15000 : 0 }
      ]
    });
  }

  for (const rec of demoRecords) {
    await fetch('/api/records/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rec)
    });
  }

  showToast('Dados de demonstração inseridos!');
  switchTab('dashboard');
}

// Theme
function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', state.theme);
  updateBrandLogo();
  localStorage.setItem('rendidiario_theme', state.theme);
  updateThemeButtonUI();
  if (state.analytics) {
    renderDailyYieldChart(state.analytics.timeline || []);
    renderAllocationPieChart();
    if (state.currentTab === 'investments') {
      if (state.selectedAssetId) renderAssetDetail();
      else renderWalletValueChart();
    }
  }
}

function updateBrandLogo() {
  const logo = document.querySelector('.brand-logo');
  if (logo) {
    logo.src = state.theme === 'dark'
      ? '/brand/svg/lastro-horizontal-escuro.svg'
      : '/brand/svg/lastro-horizontal-claro.svg';
  }
}

function updateThemeButtonUI() {
  const btn = document.getElementById('themeToggleBtn');
  if (!btn) return;
  const isDark = state.theme === 'dark';
  btn.querySelector('.theme-icon').innerHTML = isDark ? '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"></path></svg>' : '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"></path></svg>';
  btn.querySelector('.theme-label').textContent = isDark ? 'Tema escuro' : 'Tema claro';
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function handleBackupFileSelection(event) {
  const input = event.target;
  const file = input.files?.[0];
  if (!file) return;

  try {
    const backup = JSON.parse(await file.text());
    if (!backup || !Array.isArray(backup.investments) || (backup.records !== undefined && !Array.isArray(backup.records))) {
      throw new Error('Este arquivo não parece ser um backup válido do Lastro.');
    }

    const recordCount = backup.records?.length || 0;
    const confirmed = confirm(`Restaurar ${backup.investments.length} ativo(s) e ${recordCount} lançamento(s)? Dados com o mesmo ativo e data serão atualizados.`);
    if (!confirmed) return;

    const response = await fetch('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backup)
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Não foi possível restaurar o backup.');

    const settings = Object.fromEntries((backup.settings || []).filter(setting => setting?.key).map(setting => [setting.key, setting.value]));
    if (settings.usd_amount !== undefined) {
      state.usdAmount = Number(settings.usd_amount) || 0;
      localStorage.setItem('lastro_usd_amount', String(state.usdAmount));
    }
    if (settings.include_usd_in_patrimony !== undefined) {
      state.includeUsdInPatrimony = settings.include_usd_in_patrimony === true || settings.include_usd_in_patrimony === 'true';
      localStorage.setItem('lastro_include_usd', String(state.includeUsdInPatrimony));
    }
    if (settings.user_name !== undefined) {
      state.userName = String(settings.user_name || '').trim();
      if (state.userName) localStorage.setItem('lastro_user_name', state.userName);
      else localStorage.removeItem('lastro_user_name');
      updateDashboardGreeting();
    }

    await fetchInvestments();
    if (state.currentTab === 'history') await loadFullHistory();
    else if (state.currentTab === 'investments') renderInvestmentsCards();
    await loadDashboardData();
    showToast('Backup restaurado com sucesso!');
  } catch (error) {
    showToast(error.message || 'Não foi possível ler o arquivo de backup.', 'error');
  } finally {
    input.value = '';
  }
}

// Setup Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  const planningPane = document.getElementById('tab-planning');
  const planningModules = document.querySelector('.dashboard-followups');
  if (planningPane && planningModules) planningPane.appendChild(planningModules);

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme);
  document.getElementById('btnTogglePrivacy').addEventListener('click', togglePrivacyMode);

  document.getElementById('btnRefreshData').addEventListener('click', () => {
    if (state.currentTab === 'dashboard') loadDashboardData();
    else if (state.currentTab === 'quick-entry') loadQuickEntryRows();
    else if (state.currentTab === 'history') loadFullHistory();
    else if (state.currentTab === 'investments') renderInvestmentsCards();
    showToast('Dados atualizados!');
  });

  // Dólar
  document.getElementById('btnEditUsdAmount').addEventListener('click', openUsdModal);
  document.getElementById('btnRefreshDollarRate').addEventListener('click', () => {
    fetchDollarRate();
    showToast('Cotação do dólar atualizada!');
  });
  document.getElementById('formUsd').addEventListener('submit', handleUsdSubmit);
  document.getElementById('checkIncludeUsdInPatrimony').addEventListener('change', async (e) => {
    state.includeUsdInPatrimony = e.target.checked;
    localStorage.setItem('lastro_include_usd', String(state.includeUsdInPatrimony));
    updateDollarValuesUI();
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ include_usd_in_patrimony: state.includeUsdInPatrimony })
      });
    } catch (err) {}
  });

  // Evento do botao Alterar Meta
  const btnEditGoal = document.getElementById('btnEditGoalDirect');
  if (btnEditGoal) {
    btnEditGoal.addEventListener('click', (e) => {
      e.preventDefault();
      openSettingsModal();
    });
  }
  document.getElementById('formSettings').addEventListener('submit', handleSettingsSubmit);

  // New investment
  document.getElementById('btnOpenNewInvestment').addEventListener('click', openInvestmentModal);
  document.getElementById('formInvestment').addEventListener('submit', handleInvestmentSubmit);

  // Quick entry batch
  document.getElementById('btnSaveQuickBatch').addEventListener('click', saveQuickBatch);
  document.getElementById('quickEntryDate').addEventListener('change', loadQuickEntryRows);

  // Single entry modal
  document.getElementById('btnOpenSingleEntryModal').addEventListener('click', openSingleEntryModal);
  document.getElementById('formSingleEntry').addEventListener('submit', handleSingleEntrySubmit);
  document.getElementById('singleEntryInv').addEventListener('change', updateSingleEntryTaxMode);

  // Filters
  document.getElementById('filterInvestment').addEventListener('change', (e) => {
    state.selectedInvestmentId = e.target.value;
    loadDashboardData();
  });
  document.getElementById('historyFilterInv').addEventListener('change', loadFullHistory);

  document.getElementById('tableCdiComparison').addEventListener('click', event => {
    if (event.target.closest('button, a, input, select, textarea')) return;
    const row = event.target.closest('tr[data-investment-id]');
    if (row) openAssetFromDashboard(row.dataset.investmentId);
  });

  document.querySelectorAll('[data-performance-range]').forEach(button => {
    button.addEventListener('click', () => {
      state.performanceRange = button.dataset.performanceRange;
      document.querySelectorAll('[data-performance-range]').forEach(option => option.classList.toggle('active', option === button));
      updatePeriodPerformance();
    });
  });
  document.querySelectorAll('[data-wallet-range]').forEach(button => {
    button.addEventListener('click', () => {
      state.walletRange = button.dataset.walletRange;
      document.querySelectorAll('[data-wallet-range]').forEach(option => option.classList.toggle('active', option === button));
      renderWalletValueChart();
    });
  });
  document.querySelectorAll('[data-wallet-group]').forEach(button => {
    const isActive = (button.dataset.walletGroup === 'institution') === state.groupWalletByInstitution;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
    button.addEventListener('click', () => {
      state.groupWalletByInstitution = button.dataset.walletGroup === 'institution';
      localStorage.setItem('lastro_wallet_grouping', state.groupWalletByInstitution ? 'institution' : 'all');
      document.querySelectorAll('[data-wallet-group]').forEach(option => {
        const isActive = option === button;
        option.classList.toggle('active', isActive);
        option.setAttribute('aria-pressed', String(isActive));
      });
      if (state.currentTab === 'investments' && !state.selectedAssetId) renderInvestmentsCards();
    });
  });
  document.getElementById('btnBackToWallet').addEventListener('click', closeAssetDetail);
  document.querySelectorAll('[data-asset-range]').forEach(button => {
    button.addEventListener('click', () => {
      state.assetHistoryRange = button.dataset.assetRange;
      document.querySelectorAll('[data-asset-range]').forEach(option => option.classList.toggle('active', option === button));
      renderAssetDetail();
    });
  });

  // Pie toggle (Category vs Asset)
  const btnCat = document.getElementById('btnTogglePieCategory');
  const btnAsset = document.getElementById('btnTogglePieAsset');
  btnCat.addEventListener('click', () => {
    state.pieMode = 'category';
    btnCat.classList.add('active');
    btnAsset.classList.remove('active');
    renderAllocationPieChart();
  });
  btnAsset.addEventListener('click', () => {
    state.pieMode = 'asset';
    btnAsset.classList.add('active');
    btnCat.classList.remove('active');
    renderAllocationPieChart();
  });

  // Inter Import
  const dropzone = document.getElementById('dropzoneInter');
  const fileInput = document.getElementById('interFileInput');

  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) handleInterFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleInterFile(e.target.files[0]);
  });

  function handleInterFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const items = parseInterText(e.target.result);
      displayInterPreview(items);
    };
    reader.readAsText(file, 'UTF-8');
  }

  document.getElementById('btnProcessInterText').addEventListener('click', () => {
    const text = document.getElementById('interPasteText').value.trim();
    if (!text) {
      showToast('Cole o conteúdo do extrato antes de analisar.', 'error');
      return;
    }
    const items = parseInterText(text);
    displayInterPreview(items);
  });

  document.getElementById('btnConfirmInterImport').addEventListener('click', confirmInterImport);
  document.getElementById('btnLoadDemoData').addEventListener('click', loadDemoData);
  document.getElementById('fileImportInput').addEventListener('change', handleBackupFileSelection);
  document.getElementById('formProfileName').addEventListener('submit', async (event) => {
    event.preventDefault();
    const user_name = document.getElementById('settingUserName').value.trim().slice(0, 40);
    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_name })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Não foi possível salvar seu nome.');
      state.userName = user_name;
      if (user_name) localStorage.setItem('lastro_user_name', user_name);
      else localStorage.removeItem('lastro_user_name');
      updateDashboardGreeting();
      showToast(user_name ? `Saudação atualizada para ${user_name}.` : 'Saudação personalizada removida.');
    } catch (error) {
      showToast(error.message || 'Não foi possível salvar seu nome.', 'error');
    }
  });

  document.getElementById('formMovement').addEventListener('submit', handleMovementSubmit);
  document.getElementById('formCalendarEvent').addEventListener('submit', handleCalendarSubmit);
  document.getElementById('formScenario').addEventListener('submit', event => {
    event.preventDefault();
    calculateScenarioResults();
  });
  ['scenarioMonthlyContribution', 'scenarioYears', 'scenarioConservativeRate', 'scenarioBaseRate', 'scenarioOptimisticRate'].forEach(id => {
    document.getElementById(id).addEventListener('input', event => {
      localStorage.setItem(`lastro_${id}`, event.target.value);
      calculateScenarioResults();
    });
  });
  document.getElementById('btnRefreshIpca').addEventListener('click', refreshInflationRates);
  document.getElementById('btnRefreshDeleted').addEventListener('click', loadRecoveryHistory);
  document.getElementById('btnRefreshActivity').addEventListener('click', loadRecoveryHistory);
  document.getElementById('tableMovements').addEventListener('click', event => {
    const button = event.target.closest('[data-delete-movement]');
    if (button) deleteMovement(button.dataset.deleteMovement);
  });
  document.getElementById('calendarEventsList').addEventListener('click', event => {
    const button = event.target.closest('[data-calendar-receive]');
    if (!button) return;
    const item = state.calendarEvents.find(row => Number(row.id) === Number(button.dataset.calendarReceive));
    if (!item) return;
    const slot = button.closest('.calendar-receive-slot');
    slot.innerHTML = `<form class="calendar-receipt-form" data-calendar-receipt-form="${item.id}"><label>Recebido em <input type="date" name="received_date" value="${getTodayString()}" required></label><label>Valor real <input type="number" name="amount" min="0.01" step="0.01" value="${Number(item.estimated_amount) > 0 ? Number(item.estimated_amount).toFixed(2) : ''}" required></label><button type="submit" class="btn btn-primary btn-sm">Confirmar</button><button type="button" class="text-action" data-cancel-receipt>Cancelar</button></form>`;
    slot.querySelector('input[name="amount"]').focus();
  });
  document.getElementById('calendarEventsList').addEventListener('click', event => {
    if (event.target.closest('[data-cancel-receipt]')) renderCalendarEvents();
  });
  document.getElementById('calendarEventsList').addEventListener('submit', event => {
    const form = event.target.closest('[data-calendar-receipt-form]');
    if (!form) return;
    event.preventDefault();
    submitCalendarReceipt(form.dataset.calendarReceiptForm, form);
  });
  document.getElementById('deletedItemsList').addEventListener('click', event => {
    const restore = event.target.closest('[data-restore-item]');
    const purge = event.target.closest('[data-purge-item]');
    if (restore) restoreDeletedItem(restore.dataset.restoreItem);
    if (purge) permanentlyDeleteItem(purge.dataset.purgeItem);
  });
  document.getElementById('btnOpenCompactView').addEventListener('click', () => {
    if (window.lastroDesktop?.openCompactWindow) window.lastroDesktop.openCompactWindow();
    else window.open('/compact.html', 'lastro-compact', 'popup,width=420,height=620,resizable=yes');
  });

  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    if (event.target.closest('input, textarea, select, [contenteditable=true]')) return;
    const key = event.key.toLowerCase();
    if (key === 'n') openInvestmentModal();
    if (key === 'r') switchTab('quick-entry');
  });
  document.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || button.disabled || matchMedia('(prefers-reduced-motion: reduce)').matches || typeof button.animate !== 'function') return;
    button.animate(
      [{ scale: '1' }, { scale: '.96', offset: .38 }, { scale: '1' }],
      { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' }
    );
  }, true);
  document.getElementById('calendarDate').value = getTodayString();
  document.getElementById('movementDate').value = getTodayString();
  loadInflationRates();
  switchTab('dashboard');

  window.addEventListener('resize', () => {
    if (state.currentTab === 'dashboard' && state.analytics) {
      renderDailyYieldChart(state.analytics.timeline || []);
      renderAllocationPieChart();
    }
    if (state.currentTab === 'investments' && state.analytics) {
      if (state.selectedAssetId) renderAssetDetail();
      else renderWalletValueChart();
    }
  });
});
