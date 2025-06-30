// =================================================================
// BOT DE REVERSÃO EMA - VERSÃO COM BANDAS ASSIMÉTRICAS
// =================================================================

const { RestClientV5 } = require('bybit-api');
const TA = require('technicalindicators');

// --- Configurações ---
const API_KEY = process.env.API_KEY;
const API_SECRET = process.env.API_SECRET;
const SYMBOL = 'BTCPERP';
const CATEGORY = 'linear';
const LEVERAGE_LONG = 20;
const LEVERAGE_SHORT = 20;
const EMA_PERIOD = 3;
const UPPER_BAND_PERCENT = 0.0028; // 0.28% para entrar em Short
const LOWER_BAND_PERCENT = 0.0025; // 0.25% para entrar em Long
const KLINE_INTERVAL = '60';
const MIN_ORDER_QTY = 0.001;
const QTY_PRECISION = 3;
const BALANCE_USAGE_PERCENT = 0.95;

let isOperating = false;

const client = new RestClientV5({ key: API_KEY, secret: API_SECRET, testnet: false });

async function getKlineData() {
  try {
    const kline = await client.getKline({ category: CATEGORY, symbol: SYMBOL, interval: KLINE_INTERVAL, limit: EMA_PERIOD + 10 });
    if (kline.retCode !== 0) { console.error("Erro API (getKline):", JSON.stringify(kline)); return []; }
    return kline.result.list.map(k => parseFloat(k[4])).reverse();
  } catch (error) { console.error("Erro Crítico (getKline):", error.message); return []; }
}
async function getCurrentPrice() {
  try {
    const ticker = await client.getTickers({ category: CATEGORY, symbol: SYMBOL });
    if (ticker.retCode !== 0) { console.error("Erro API (getTickers):", JSON.stringify(ticker)); return null; }
    return parseFloat(ticker.result.list[0].lastPrice);
  } catch (error) { console.error("Erro Crítico (getCurrentPrice):", error.message); return null; }
}
async function getAvailableBalance() {
  try {
    const response = await client.getWalletBalance({ accountType: 'UNIFIED' });
    if (response.retCode !== 0) { console.error("Erro API (getWalletBalance):", JSON.stringify(response)); return 0; }
    if (response.result.list && response.result.list.length > 0) {
      const usdcBalance = response.result.list[0].coin.find(c => c.coin === 'USDC');
      if (usdcBalance && usdcBalance.walletBalance) { return parseFloat(usdcBalance.walletBalance); }
    } return 0;
  } catch (error) { console.error("Erro Crítico (getAvailableBalance):", error.message); return 0; }
}
async function getCurrentPositionSide() {
  try {
    const positions = await client.getPositionInfo({ category: CATEGORY, symbol: SYMBOL });
    if (positions.retCode === 0 && positions.result.list.length > 0) {
      const openPosition = positions.result.list.find(p => parseFloat(p.size) > 0);
      return openPosition ? openPosition.side : 'None';
    }
  } catch (e) { console.error("Erro ao buscar posição:", e.message); }
  return 'None';
}

async function executeTrade(side, leverage) {
  if (isOperating) { console.log("Operação já em andamento."); return; }
  isOperating = true;
  console.log(`\n>>> SINAL DETECTADO. INICIANDO OPERAÇÃO PARA ${side.toUpperCase()} <<<`);

  try {
    // A lógica de fechar primeiro é crucial
    console.log("   - Passo 1: Zerando qualquer posição/ordem existente para garantir um estado limpo...");
    await client.cancelAllOrders({ category: CATEGORY, symbol: SYMBOL });
    await client.submitOrder({ category: CATEGORY, symbol: SYMBOL, side: side === 'Buy' ? 'Sell' : 'Buy', orderType: 'Market', qty: '0', closeOnTrigger: true, reduceOnly: true });
    
    console.log("   - Aguardando 10 segundos para a Bybit processar...");
    await new Promise(resolve => setTimeout(resolve, 10000));

    console.log("   - Passo 2: Abrindo nova posição...");
    const balance = await getAvailableBalance();
    const price = await getCurrentPrice();
    if (!balance || !price || balance < 10) throw new Error("Saldo ou preço indisponível.");
    
    await client.setLeverage({ category: CATEGORY, symbol: SYMBOL, buyLeverage: String(leverage), sellLeverage: String(leverage) });
    const usableBalance = balance * BALANCE_USAGE_PERCENT;
    const positionValue = usableBalance * leverage;
    const finalQty = (positionValue / price).toFixed(QTY_PRECISION);

    if (parseFloat(finalQty) < MIN_ORDER_QTY) throw new Error(`Quantidade calculada (${finalQty}) é menor que o mínimo.`);
    
    console.log(`     - Abrindo ${side} de ${finalQty} BTC...`);
    const res = await client.submitOrder({
        category: CATEGORY, symbol: SYMBOL, side: side, orderType: 'Market', qty: finalQty,
    });

    if (res.retCode === 0) {
        console.log(`>> SUCESSO! Posição ${side.toUpperCase()} aberta.`);
    } else {
        console.error("   - ERRO DE NEGÓCIO DA BYBIT (ABERTURA):", JSON.stringify(res));
    }
  } catch (error) {
    console.error("   - ERRO CRÍTICO na operação:", error.message);
  } finally {
    isOperating = false;
  }
}

async function checkStrategy() {
  if (isOperating) return;
  
  const closes = await getKlineData();
  const price = await getCurrentPrice();
  if (!closes || closes.length < EMA_PERIOD || !price) { console.log("Dados insuficientes para calcular."); return; }
  
  const ema = TA.ema({ period: EMA_PERIOD, values: closes })[0];
  const upperBand = ema * (1 + UPPER_BAND_PERCENT);
  const lowerBand = ema * (1 - LOWER_BAND_PERCENT);
  
  console.log(`------------------ [${new Date().toLocaleString()}] ------------------`);
  console.log(`Preço: ${price.toFixed(2)} | EMA(${EMA_PERIOD}): ${ema.toFixed(2)} | Banda: ${lowerBand.toFixed(2)} (Gatilho Long) - ${upperBand.toFixed(2)} (Gatilho Short)`);
  
  const currentSide = await getCurrentPositionSide();
  console.log(`Posição Atual Detectada: ${currentSide}`);

  // Lógica de Reversão Pura com Bandas Assimétricas
  if (currentSide !== 'Short' && price >= upperBand) {
    await executeTrade('Sell', LEVERAGE_SHORT);
  } else if (currentSide !== 'Long' && price <= lowerBand) {
    await executeTrade('Buy', LEVERAGE_LONG);
  } else {
    console.log("Preço entre as bandas. Nenhuma ação.");
  }
}

console.log("==> BOT DE REVERSÃO EMA (BANDAS ASSIMÉTRICAS) INICIADO <==");
checkStrategy();
setInterval(checkStrategy, 60 * 1000);