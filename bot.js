// =================================================================
// BOT DE REVERSÃO EMA - VERSÃO FINAL COM SÍMBOLO BTCUSDC
// =================================================================

const { RestClientV5 } = require('bybit-api');
const TA = require('technicalindicators');

// --- Configurações do Bot ---
const API_KEY = process.env.API_KEY;
const API_SECRET = process.env.API_SECRET;
const SYMBOL = 'BTCUSDC'; // <-- SÍMBOLO CORRETO CONFORME SUA VERIFICAÇÃO
const CATEGORY = 'linear';
const LEVERAGE_LONG = 10;
const LEVERAGE_SHORT = 5;
const EMA_PERIOD = 3;
const EMA_BAND_PERCENT = 0.001; // Gatilho de teste 0.1%
const KLINE_INTERVAL = '60';
const MIN_ORDER_QTY = 0.001;

// --- Variáveis de Estado ---
let currentPositionSide = 'None'; 
let isChecking = false;

const client = new RestClientV5({ key: API_KEY, secret: API_SECRET, testnet: false });

// --- Funções (permanecem as mesmas) ---
async function getKlineData() {
  try {
    const kline = await client.getKline({ category: CATEGORY, symbol: SYMBOL, interval: KLINE_INTERVAL, limit: EMA_PERIOD + 10 });
    if (kline.retCode !== 0) { console.error("Erro da API ao buscar Kline:", JSON.stringify(kline)); return []; }
    return kline.result.list.map(k => parseFloat(k[4])).reverse();
  } catch (error) { console.error("Erro CRÍTICO na chamada de Kline:", error); return []; }
}
async function getCurrentPrice() {
    try {
        const ticker = await client.getTickers({ category: CATEGORY, symbol: SYMBOL });
        if (ticker.retCode !== 0) { console.error("Erro da API ao buscar Preço:", JSON.stringify(ticker)); return null; }
        return parseFloat(ticker.result.list[0].lastPrice);
    } catch (error) { console.error("Erro CRÍTICO na chamada de Preço:", error); return null; }
}
async function getAvailableBalance() {
  try {
    const response = await client.getWalletBalance({ accountType: 'UNIFIED' });
    if (response.retCode !== 0) { console.error("Erro da API ao buscar Saldo:", JSON.stringify(response)); return 0; }
    if (response.result.list && response.result.list.length > 0) {
      const usdcBalance = response.result.list[0].coin.find(c => c.coin === 'USDC');
      if (usdcBalance && usdcBalance.equity) { 
          const balance = parseFloat(usdcBalance.equity);
          console.log(`>> SALDO DISPONÍVEL (Equity USDC) DETECTADO: $${balance.toFixed(2)}`);
          return balance;
      }
    }
    console.error("Saldo USDC não encontrado na conta unificada.");
    return 0;
  } catch (error) { console.error("Erro CRÍTICO ao buscar saldo:", error); return 0; }
}
async function placeReverseOrder(side, leverage) {
    const balance = await getAvailableBalance();
    const price = await getCurrentPrice();
    if (!balance || !price || balance < 10) { console.error("Saldo ou preço indisponível, ou saldo menor que $10. Abortando ordem."); return; }
    const positionValue = balance * leverage;
    const theoreticalQty = positionValue / price;
    const adjustedQty = Math.floor(theoreticalQty / MIN_ORDER_QTY) * MIN_ORDER_QTY;
    const finalQty = adjustedQty.toFixed(3);
    if (adjustedQty < MIN_ORDER_QTY) { console.error(`Quantidade calculada (${finalQty}) é menor que o mínimo. Abortando.`); return; }
    console.log(`\n>>> EXECUTANDO ORDEM DE REVERSÃO PARA ${side.toUpperCase()} <<<`);
    console.log(`   - Saldo: $${balance.toFixed(2)}, Alavancagem: ${leverage}x`);
    console.log(`   - Valor da Posição: $${positionValue.toFixed(2)}, Qty: ${finalQty} BTC`);
    try {
        await client.setLeverage({ category: CATEGORY, symbol: SYMBOL, buyLeverage: String(leverage), sellLeverage: String(leverage) });
        console.log("   - Passo 1: Cancelando ordens abertas e fechando posição existente (se houver)...");
        await client.cancelAllOrders({ category: CATEGORY, symbol: SYMBOL });
        await client.submitOrder({ category: CATEGORY, symbol: SYMBOL, side: side === 'Long' ? 'Sell' : 'Buy', orderType: 'Market', qty: '0', reduceOnly: true, closeOnTrigger: true });
        await new Promise(resolve => setTimeout(resolve, 5000));
        console.log("   - Passo 2: Abrindo nova posição...");
        const res = await client.submitOrder({ category: CATEGORY, symbol: SYMBOL, side: side === 'Long' ? 'Buy' : 'Sell', orderType: 'Market', qty: finalQty, });
        if (res.retCode === 0) { console.log(`>> SUCESSO! Posição ${side.toUpperCase()} aberta.`); currentPositionSide = side; } 
        else { console.error("ERRO DE NEGÓCIO DA BYBIT (REVERSÃO):", JSON.stringify(res)); }
    } catch (error) { console.error("ERRO CRÍTICO NA CHAMADA DE REVERSÃO:", error); }
}

// --- Lógica Principal do Bot ---
async function checkStrategy() {
  if (isChecking) { return; }
  isChecking = true;
  console.log(`------------------ [${new Date().toLocaleString()}] ------------------`);
  const closes = await getKlineData();
  const price = await getCurrentPrice();
  if (closes.length < EMA_PERIOD || !price) {
    console.log("Dados insuficientes para calcular a estratégia. Verifique os erros acima.");
    isChecking = false;
    return;
  }
  const ema = TA.ema({ period: EMA_PERIOD, values: closes })[0];
  const upperBand = ema * (1 + EMA_BAND_PERCENT);
  const lowerBand = ema * (1 - EMA_BAND_PERCENT);
  console.log(`Preço: ${price.toFixed(2)} | EMA(${EMA_PERIOD}): ${ema.toFixed(2)} | Banda Sup: ${upperBand.toFixed(2)} | Banda Inf: ${lowerBand.toFixed(2)}`);
  console.log(`Posição Atual: ${currentPositionSide}`);
  if (currentPositionSide !== 'Short' && price >= upperBand) { await placeReverseOrder('Short', LEVERAGE_SHORT); } 
  else if (currentPositionSide !== 'Long' && price <= lowerBand) { await placeReverseOrder('Long', LEVERAGE_LONG); } 
  else { console.log("Nenhum sinal de reversão. Mantendo posição."); }
  isChecking = false;
}

// --- Inicialização do Bot ---
console.log("==> BOT DE REVERSÃO EMA INICIADO <==");
console.log(`   - Ativo: ${SYMBOL} | Categoria: ${CATEGORY}`);
console.log(`   - Estratégia: EMA(${EMA_PERIOD}) +/- ${EMA_BAND_PERCENT * 100}% no gráfico de ${KLINE_INTERVAL}m`);
console.log(`   - Long: ${LEVERAGE_LONG}x | Short: ${LEVERAGE_SHORT}x`);
checkStrategy(); 
setInterval(checkStrategy, 60 * 1000);