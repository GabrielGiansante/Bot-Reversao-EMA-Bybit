// =================================================================
// BOT DE REVERSÃO EMA - VERSÃO 1.0
// Estratégia: Reversão baseada na EMA(3) no gráfico de 1h
// =================================================================

const { RestClientV5 } = require('bybit-api');
const TA = require('technicalindicators');

// --- Configurações do Bot ---
const API_KEY = process.env.API_KEY;
const API_SECRET = process.env.API_SECRET;
const SYMBOL = 'BTCUSDC';
const LEVERAGE_LONG = 10;
const LEVERAGE_SHORT = 5;
const EMA_PERIOD = 3;
const EMA_BAND_PERCENT = 0.003; // 0.3%
const KLINE_INTERVAL = '60'; // Gráfico de 1 hora
const MIN_ORDER_QTY = 0.001; // Mínimo para BTC

// --- Variáveis de Estado ---
// 'None', 'Long', ou 'Short'
let currentPositionSide = 'None'; 
let isChecking = false; // Trava para evitar execuções simultâneas

const client = new RestClientV5({ key: API_KEY, secret: API_SECRET, testnet: false });

// --- Funções de API e Indicadores ---
async function getKlineData() {
  try {
    const kline = await client.getKline({
      category: 'linear',
      symbol: SYMBOL,
      interval: KLINE_INTERVAL,
      limit: EMA_PERIOD + 5, // Pega algumas velas a mais para garantir
    });
    // Inverte para ter os dados do mais antigo para o mais recente
    return kline.result.list.map(k => parseFloat(k[4])).reverse();
  } catch (error) {
    console.error("Erro ao buscar dados históricos (Kline):", error.message);
    return [];
  }
}

async function getCurrentPrice() {
    try {
        const ticker = await client.getTickers({ category: 'linear', symbol: SYMBOL });
        return parseFloat(ticker.result.list[0].lastPrice);
    } catch (error) {
        console.error("Erro ao buscar preço atual:", error.message);
        return null;
    }
}

async function getAvailableBalance() {
  try {
    const response = await client.getWalletBalance({ accountType: 'UNIFIED' });
    if (response.retCode === 0 && response.result.list.length > 0) {
      const usdcBalance = response.result.list[0].coin.find(c => c.coin === 'USDC');
      if (usdcBalance && usdcBalance.equity) {
        return parseFloat(usdcBalance.equity);
      }
    }
    return 0;
  } catch (error) { console.error("Erro ao buscar saldo:", error.message); return 0; }
}

async function placeReverseOrder(side, leverage) {
    const balance = await getAvailableBalance();
    const price = await getCurrentPrice();
    if (!balance || !price || balance < 10) { // Trava de segurança de saldo mínimo
        console.error("Saldo ou preço indisponível, ou saldo menor que $10. Abortando ordem.");
        return;
    }
    
    // Calcula o tamanho da posição com base no saldo total e na nova alavancagem
    const positionValue = balance * leverage;
    const theoreticalQty = positionValue / price;
    const adjustedQty = Math.floor(theoreticalQty / MIN_ORDER_QTY) * MIN_ORDER_QTY;
    const finalQty = adjustedQty.toFixed(3);

    if (adjustedQty < MIN_ORDER_QTY) {
        console.error(`Quantidade calculada (${finalQty}) é menor que o mínimo. Abortando.`);
        return;
    }

    console.log(`\n>>> EXECUTANDO ORDEM DE REVERSÃO PARA ${side.toUpperCase()} <<<`);
    console.log(`   - Saldo: $${balance.toFixed(2)}, Alavancagem: ${leverage}x`);
    console.log(`   - Valor da Posição: $${positionValue.toFixed(2)}, Qty: ${finalQty} BTC`);

    try {
        // Define a alavancagem para a nova posição
        await client.setLeverage({ category: 'linear', symbol: SYMBOL, buyLeverage: String(leverage), sellLeverage: String(leverage) });
        
        // Envia a ordem. Para reverter, o tamanho é o DOBRO da posição atual, se houver.
        // Mas como a estratégia é fechar e abrir, vamos fazer em 2 passos para clareza.
        
        // 1. Fecha qualquer posição existente
        console.log("   - Passo 1: Fechando posições existentes (se houver)...");
        await client.submitOrder({ category: 'linear', symbol: SYMBOL, side: side === 'Long' ? 'Sell' : 'Buy', orderType: 'Market', qty: '0', reduceOnly: true, closeOnTrigger: true });
        
        // Pausa para a corretora processar
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // 2. Abre a nova posição
        console.log("   - Passo 2: Abrindo nova posição...");
        const res = await client.submitOrder({
            category: 'linear',
            symbol: SYMBOL,
            side: side === 'Long' ? 'Buy' : 'Sell',
            orderType: 'Market',
            qty: finalQty,
        });

        if (res.retCode === 0) {
            console.log(`>> SUCESSO! Posição ${side.toUpperCase()} aberta.`);
            currentPositionSide = side; // Atualiza nosso estado
        } else {
            console.error("ERRO DE NEGÓCIO DA BYBIT (REVERSÃO):", JSON.stringify(res));
        }

    } catch (error) {
        console.error("ERRO CRÍTICO NA CHAMADA DE REVERSÃO:", error.message);
    }
}

// --- Lógica Principal do Bot ---
async function checkStrategy() {
  if (isChecking) {
    // console.log("Ciclo anterior ainda em execução, pulando.");
    return;
  }
  isChecking = true; // Trava a função
  
  console.log(`------------------ [${new Date().toLocaleString()}] ------------------`);
  
  const closes = await getKlineData();
  const price = await getCurrentPrice();
  
  if (closes.length < EMA_PERIOD || !price) {
    console.log("Dados insuficientes para calcular a estratégia. Aguardando...");
    isChecking = false; // Libera a trava
    return;
  }
  
  const ema = TA.ema({ period: EMA_PERIOD, values: closes })[0];
  const upperBand = ema * (1 + EMA_BAND_PERCENT);
  const lowerBand = ema * (1 - EMA_BAND_PERCENT);
  
  console.log(`Preço: ${price.toFixed(2)} | EMA(${EMA_PERIOD}): ${ema.toFixed(2)} | Banda Superior: ${upperBand.toFixed(2)} | Banda Inferior: ${lowerBand.toFixed(2)}`);
  console.log(`Posição Atual: ${currentPositionSide}`);

  // Lógica de Reversão
  if (currentPositionSide !== 'Short' && price >= upperBand) {
    await placeReverseOrder('Short', LEVERAGE_SHORT);
  } else if (currentPositionSide !== 'Long' && price <= lowerBand) {
    await placeReverseOrder('Long', LEVERAGE_LONG);
  } else {
    console.log("Nenhum sinal de reversão. Mantendo posição.");
  }

  isChecking = false; // Libera a trava
}

// --- Inicialização do Bot ---
console.log("==> BOT DE REVERSÃO EMA INICIADO <==");
console.log(`   - Ativo: ${SYMBOL}`);
console.log(`   - Estratégia: EMA(${EMA_PERIOD}) +/- ${EMA_BAND_PERCENT * 100}% no gráfico de ${KLINE_INTERVAL}m`);
console.log(`   - Long: ${LEVERAGE_LONG}x | Short: ${LEVERAGE_SHORT}x`);

// Roda a primeira verificação e depois a cada 1 minuto
checkStrategy(); 
setInterval(checkStrategy, 60 * 1000); // Roda a cada 60 segundos